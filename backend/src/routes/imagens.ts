import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { autenticado, somenteAdmin } from '../lib/auth.js';
import { registrarAuditoria } from '../lib/auditoria.js';
import { ehDuplicado, lerId, validar } from '../lib/http.js';

/* =========================================================
   Biblioteca de imagens do visual "Imagem" (logos, ícones, fotos).
   Gestor e Desenvolvedor incluem, renomeiam, trocam e excluem;
   qualquer usuário logado lista (para montar análises).
   O arquivo é servido por uma chave aleatória, sem login, para
   aparecer nos painéis e em tela cheia.
   ========================================================= */

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };

/** Formato pelo conteúdo do arquivo (SVG fica de fora: pode conter scripts). */
function detectar(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buf.toString('ascii', 0, 4) === 'GIF8') return 'gif';
  return null;
}

/** Largura e altura lidas do cabeçalho (sem bibliotecas); null se não der. */
function dimensoes(buf: Buffer, formato: string): { largura: number; altura: number } | null {
  try {
    if (formato === 'png') return { largura: buf.readUInt32BE(16), altura: buf.readUInt32BE(20) };
    if (formato === 'gif') return { largura: buf.readUInt16LE(6), altura: buf.readUInt16LE(8) };
    if (formato === 'webp') {
      const tipo = buf.toString('ascii', 12, 16);
      if (tipo === 'VP8 ') return { largura: buf.readUInt16LE(26) & 0x3fff, altura: buf.readUInt16LE(28) & 0x3fff };
      if (tipo === 'VP8L') {
        const b = buf.readUInt32LE(21);
        return { largura: (b & 0x3fff) + 1, altura: ((b >> 14) & 0x3fff) + 1 };
      }
      if (tipo === 'VP8X') return { largura: buf.readUIntLE(24, 3) + 1, altura: buf.readUIntLE(27, 3) + 1 };
      return null;
    }
    // JPEG: procura o marcador SOF (início do quadro)
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) return null;
      const marca = buf[i + 1];
      const tam = buf.readUInt16BE(i + 2);
      if (marca >= 0xc0 && marca <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marca)) {
        return { altura: buf.readUInt16BE(i + 5), largura: buf.readUInt16BE(i + 7) };
      }
      i += 2 + tam;
    }
  } catch {
    /* cabeçalho incompleto */
  }
  return null;
}

const nomeSchema = z.string().trim().min(1, 'Dê um nome à imagem.').max(120);
const DUPLICADO = 'Já existe uma imagem com esse nome.';

const paraResposta = (r: any) => ({
  id: r.id,
  nome: r.nome,
  chave: r.chave,
  url: `/api/imagens/arquivo/${r.chave}`,
  formato: r.formato,
  tamanho: r.tamanho,
  largura: r.largura,
  altura: r.altura,
  usos: r.usos ?? 0,
  criadoPor: r.criado_por_nome ?? null,
  atualizadoEm: r.atualizado_em,
});

/** Onde a imagem aparece: visuais de painéis e de análises. */
async function usosDa(chave: string) {
  const padrao = `%${chave}%`;
  const { rows: p } = await query(
    `SELECT DISTINCT p.id, p.nome FROM painel_visuais v JOIN paineis p ON p.id = v.painel_id
      WHERE v.tipo = 'imagem' AND v.config::text LIKE $1 ORDER BY p.nome`,
    [padrao],
  );
  const { rows: a } = await query(
    `SELECT a.id, a.nome, u.nome AS dono FROM analises a JOIN usuarios u ON u.id = a.usuario_id
      WHERE a.visuais::text LIKE $1 ORDER BY a.nome`,
    [padrao],
  );
  return { paineis: p, analises: a };
}

/** Lê o arquivo enviado e confere formato e tamanho. */
async function lerEnvio(request: any): Promise<{ buffer: Buffer; formato: string; nome: string | null } | { status: number; erro: string }> {
  const arquivo = await request.file();
  if (!arquivo) return { status: 400, erro: 'Nenhum arquivo enviado.' };
  let buffer: Buffer;
  try {
    buffer = await arquivo.toBuffer();
  } catch {
    return { status: 413, erro: `Arquivo maior que ${config.uploadMaxMB} MB.` };
  }
  const formato = detectar(buffer);
  if (!formato) return { status: 415, erro: 'Formato não suportado. Use PNG, JPG, WEBP ou GIF.' };
  const campoNome = arquivo.fields?.nome as { value?: string } | undefined;
  const nomeArquivo = String(arquivo.filename ?? '').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  return { buffer, formato, nome: (campoNome?.value ?? '').trim() || nomeArquivo || null };
}

async function gravar(buffer: Buffer, formato: string) {
  const pasta = path.join(config.uploadDir, 'imagens');
  await fs.mkdir(pasta, { recursive: true });
  const arquivo = `img-${crypto.randomBytes(10).toString('hex')}.${formato}`;
  await fs.writeFile(path.join(pasta, arquivo), buffer);
  return arquivo;
}

const apagar = (arquivo: string) => fs.unlink(path.join(config.uploadDir, 'imagens', path.basename(arquivo))).catch(() => undefined);

const SQL_LISTA = `
  SELECT i.*, u.nome AS criado_por_nome,
         (SELECT COUNT(*) FROM painel_visuais v WHERE v.tipo = 'imagem' AND v.config::text LIKE '%' || i.chave::text || '%')::int
       + (SELECT COUNT(*) FROM analises a WHERE a.visuais::text LIKE '%' || i.chave::text || '%')::int AS usos
    FROM imagens i LEFT JOIN usuarios u ON u.id = i.criado_por`;

export async function rotasImagens(app: FastifyInstance) {
  /** O arquivo em si: público, pela chave aleatória (painéis em tela cheia, torres de controle). */
  app.get<{ Params: { chave: string } }>('/arquivo/:chave', async (request, reply) => {
    if (!/^[0-9a-f-]{36}$/i.test(request.params.chave)) return reply.code(404).send({ erro: 'Imagem não encontrada.' });
    const { rows } = await query('SELECT arquivo, formato, atualizado_em FROM imagens WHERE chave = $1', [request.params.chave]);
    if (!rows[0]) return reply.code(404).send({ erro: 'Imagem não encontrada.' });
    try {
      const dados = await fs.readFile(path.join(config.uploadDir, 'imagens', path.basename(rows[0].arquivo)));
      return reply
        .header('Content-Type', MIME[rows[0].formato] ?? 'application/octet-stream')
        .header('Cache-Control', 'public, max-age=300')
        .header('X-Content-Type-Options', 'nosniff')
        .header('Last-Modified', new Date(rows[0].atualizado_em).toUTCString())
        .send(dados);
    } catch {
      return reply.code(404).send({ erro: 'O arquivo desta imagem não foi encontrado no servidor.' });
    }
  });

  app.get('/', { preHandler: autenticado }, async () => {
    const { rows } = await query(`${SQL_LISTA} ORDER BY LOWER(i.nome)`);
    return rows.map(paraResposta);
  });

  app.get('/:id/usos', { preHandler: somenteAdmin }, async (request, reply) => {
    const id = lerId(request.params, reply);
    if (!id) return;
    const { rows } = await query('SELECT chave FROM imagens WHERE id = $1', [id]);
    if (!rows[0]) return reply.code(404).send({ erro: 'Imagem não encontrada.' });
    return usosDa(rows[0].chave);
  });

  /** Nova imagem (multipart: campo "arquivo" e, opcional, "nome" antes dele). */
  app.post('/', { preHandler: somenteAdmin }, async (request, reply) => {
    const e = await lerEnvio(request);
    if ('erro' in e) return reply.code(e.status).send({ erro: e.erro });
    const nome = nomeSchema.safeParse(e.nome ?? '');
    if (!nome.success) return reply.code(400).send({ erro: nome.error.issues[0].message });
    const arquivo = await gravar(e.buffer, e.formato);
    const dim = dimensoes(e.buffer, e.formato);
    try {
      const { rows } = await query(
        `INSERT INTO imagens (nome, arquivo, formato, tamanho, largura, altura, criado_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [nome.data, arquivo, e.formato, e.buffer.length, dim?.largura ?? null, dim?.altura ?? null, request.user.sub],
      );
      await registrarAuditoria({ usuarioId: request.user.sub, acao: 'imagem_incluida', entidade: 'imagens', detalhes: { id: rows[0].id, nome: nome.data }, ip: request.ip });
      const { rows: r } = await query(`${SQL_LISTA} WHERE i.id = $1`, [rows[0].id]);
      return reply.code(201).send(paraResposta(r[0]));
    } catch (err) {
      await apagar(arquivo);
      if (ehDuplicado(err)) return reply.code(409).send({ erro: DUPLICADO });
      throw err;
    }
  });

  app.put('/:id', { preHandler: somenteAdmin }, async (request, reply) => {
    const id = lerId(request.params, reply);
    if (!id) return;
    const d = validar(z.object({ nome: nomeSchema }), request.body, reply);
    if (!d) return;
    try {
      const { rowCount } = await query('UPDATE imagens SET nome = $2, atualizado_em = NOW() WHERE id = $1', [id, d.nome]);
      if (!rowCount) return reply.code(404).send({ erro: 'Imagem não encontrada.' });
    } catch (err) {
      if (ehDuplicado(err)) return reply.code(409).send({ erro: DUPLICADO });
      throw err;
    }
    await registrarAuditoria({ usuarioId: request.user.sub, acao: 'imagem_renomeada', entidade: 'imagens', detalhes: { id, nome: d.nome }, ip: request.ip });
    const { rows } = await query(`${SQL_LISTA} WHERE i.id = $1`, [id]);
    return paraResposta(rows[0]);
  });

  /** Troca o arquivo mantendo a chave: os visuais que usam a imagem passam a mostrar a nova. */
  app.post('/:id/arquivo', { preHandler: somenteAdmin }, async (request, reply) => {
    const id = lerId(request.params, reply);
    if (!id) return;
    const { rows: antes } = await query('SELECT arquivo FROM imagens WHERE id = $1', [id]);
    if (!antes[0]) return reply.code(404).send({ erro: 'Imagem não encontrada.' });
    const e = await lerEnvio(request);
    if ('erro' in e) return reply.code(e.status).send({ erro: e.erro });
    const arquivo = await gravar(e.buffer, e.formato);
    const dim = dimensoes(e.buffer, e.formato);
    await query('UPDATE imagens SET arquivo = $2, formato = $3, tamanho = $4, largura = $5, altura = $6, atualizado_em = NOW() WHERE id = $1', [
      id,
      arquivo,
      e.formato,
      e.buffer.length,
      dim?.largura ?? null,
      dim?.altura ?? null,
    ]);
    await apagar(antes[0].arquivo);
    await registrarAuditoria({ usuarioId: request.user.sub, acao: 'imagem_substituida', entidade: 'imagens', detalhes: { id }, ip: request.ip });
    const { rows } = await query(`${SQL_LISTA} WHERE i.id = $1`, [id]);
    return paraResposta(rows[0]);
  });

  app.delete('/:id', { preHandler: somenteAdmin }, async (request, reply) => {
    const id = lerId(request.params, reply);
    if (!id) return;
    const { rows } = await query('SELECT nome, chave, arquivo FROM imagens WHERE id = $1', [id]);
    if (!rows[0]) return reply.code(404).send({ erro: 'Imagem não encontrada.' });
    const usos = await usosDa(rows[0].chave);
    if (usos.paineis.length || usos.analises.length) {
      const onde = [
        ...usos.paineis.map((p: any) => `painel "${p.nome}"`),
        ...usos.analises.map((a: any) => `análise "${a.nome}" (de ${a.dono})`),
      ];
      return reply.code(409).send({
        erro: `A imagem está em uso: ${onde.slice(0, 5).join(', ')}${onde.length > 5 ? ` e mais ${onde.length - 5}` : ''}. Tire-a desses visuais antes de excluir.`,
        usos,
      });
    }
    await query('DELETE FROM imagens WHERE id = $1', [id]);
    await apagar(rows[0].arquivo);
    await registrarAuditoria({ usuarioId: request.user.sub, acao: 'imagem_excluida', entidade: 'imagens', detalhes: { id, nome: rows[0].nome }, ip: request.ip });
    return reply.code(204).send();
  });
}
