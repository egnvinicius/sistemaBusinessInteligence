import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { config } from '../config.js';
import { somenteAdmin } from '../lib/auth.js';
import { registrarAuditoria } from '../lib/auditoria.js';

const cor = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Cor inválida (use o formato #RRGGBB).');

const aparenciaSchema = z.object({
  nomeSistema: z.string().trim().min(1).max(60),
  tituloLogin: z.string().trim().min(1).max(80),
  subtituloLogin: z.string().trim().max(160),
  corPrimaria: cor,
  corFundoLogin: cor,
  corFundoLoginEscuro: cor,
  layoutLogin: z.enum(['dividido', 'centralizado']),
  temaPadrao: z.enum(['claro', 'escuro', 'sistema']),
});

const COLUNA_IMAGEM = { logo: 'logo_url', logoEscuro: 'logo_escuro_url', fundo: 'imagem_fundo_url', favicon: 'favicon_url' } as const;
type TipoImagem = keyof typeof COLUNA_IMAGEM;

// Assinaturas binárias aceitas (SVG fica de fora por poder conter scripts)
function detectarExtensao(buf: Buffer, tipo: TipoImagem): string | null {
  // .ico (cabeçalho 00 00 01 00) só para o ícone da aba
  if (tipo === 'favicon' && buf.length >= 6 && buf.readUInt32LE(0) === 0x00010000) return 'ico';
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

function paraResposta(r: any) {
  return {
    nomeSistema: r.nome_sistema,
    tituloLogin: r.titulo_login,
    subtituloLogin: r.subtitulo_login,
    corPrimaria: r.cor_primaria,
    corFundoLogin: r.cor_fundo_login,
    corFundoLoginEscuro: r.cor_fundo_login_escuro,
    layoutLogin: r.layout_login,
    logoUrl: r.logo_url,
    logoEscuroUrl: r.logo_escuro_url ?? null,
    faviconUrl: r.favicon_url ?? null,
    imagemFundoUrl: r.imagem_fundo_url,
    temaPadrao: r.tema_padrao,
    atualizadoEm: r.atualizado_em,
  };
}

async function apagarArquivo(url: string | null) {
  if (!url?.startsWith('/uploads/')) return;
  const nome = path.basename(url);
  await fs.unlink(path.join(config.uploadDir, nome)).catch(() => undefined);
}

export async function rotasAparencia(app: FastifyInstance) {
  // Público: a tela de login precisa disso antes de o usuário entrar
  app.get('/', async (_request, reply) => {
    const { rows } = await query('SELECT * FROM config_aparencia WHERE id = 1');
    reply.header('Cache-Control', 'no-cache');
    return paraResposta(rows[0]);
  });

  app.put('/', { preHandler: somenteAdmin }, async (request, reply) => {
    const corpo = aparenciaSchema.safeParse(request.body);
    if (!corpo.success) return reply.code(400).send({ erro: corpo.error.issues[0].message });
    const d = corpo.data;
    const { rows } = await query(
      `UPDATE config_aparencia SET
         nome_sistema = $1, titulo_login = $2, subtitulo_login = $3, cor_primaria = $4,
         cor_fundo_login = $5, cor_fundo_login_escuro = $6, layout_login = $7, tema_padrao = $8,
         atualizado_em = NOW(), atualizado_por = $9
       WHERE id = 1 RETURNING *`,
      [
        d.nomeSistema,
        d.tituloLogin,
        d.subtituloLogin,
        d.corPrimaria.toUpperCase(),
        d.corFundoLogin.toUpperCase(),
        d.corFundoLoginEscuro.toUpperCase(),
        d.layoutLogin,
        d.temaPadrao,
        request.user.sub,
      ],
    );
    await registrarAuditoria({ usuarioId: request.user.sub, acao: 'aparencia_alterada', entidade: 'config_aparencia', detalhes: d, ip: request.ip });
    return paraResposta(rows[0]);
  });

  app.post<{ Params: { tipo: string } }>('/imagem/:tipo', { preHandler: somenteAdmin }, async (request, reply) => {
    const tipo = request.params.tipo as TipoImagem;
    if (!(tipo in COLUNA_IMAGEM)) return reply.code(404).send({ erro: 'Tipo de imagem inválido.' });

    const arquivo = await request.file();
    if (!arquivo) return reply.code(400).send({ erro: 'Nenhum arquivo enviado.' });

    let buffer: Buffer;
    try {
      buffer = await arquivo.toBuffer();
    } catch {
      return reply.code(413).send({ erro: `Arquivo maior que ${config.uploadMaxMB} MB.` });
    }
    const ext = detectarExtensao(buffer, tipo);
    if (!ext) return reply.code(415).send({ erro: tipo === 'favicon' ? 'Formato não suportado. Use ICO, PNG, JPG ou WEBP.' : 'Formato não suportado. Use PNG, JPG ou WEBP.' });

    await fs.mkdir(config.uploadDir, { recursive: true });
    const nome = `${tipo}-${crypto.randomBytes(8).toString('hex')}.${ext}`;
    await fs.writeFile(path.join(config.uploadDir, nome), buffer);

    const coluna = COLUNA_IMAGEM[tipo];
    const { rows: antes } = await query(`SELECT ${coluna} AS url FROM config_aparencia WHERE id = 1`);
    const { rows } = await query(
      `UPDATE config_aparencia SET ${coluna} = $1, atualizado_em = NOW(), atualizado_por = $2 WHERE id = 1 RETURNING *`,
      [`/uploads/${nome}`, request.user.sub],
    );
    await apagarArquivo(antes[0]?.url);
    await registrarAuditoria({ usuarioId: request.user.sub, acao: `imagem_${tipo}_alterada`, entidade: 'config_aparencia', ip: request.ip });
    return paraResposta(rows[0]);
  });

  app.delete<{ Params: { tipo: string } }>('/imagem/:tipo', { preHandler: somenteAdmin }, async (request, reply) => {
    const tipo = request.params.tipo as TipoImagem;
    if (!(tipo in COLUNA_IMAGEM)) return reply.code(404).send({ erro: 'Tipo de imagem inválido.' });
    const coluna = COLUNA_IMAGEM[tipo];
    const { rows: antes } = await query(`SELECT ${coluna} AS url FROM config_aparencia WHERE id = 1`);
    const { rows } = await query(
      `UPDATE config_aparencia SET ${coluna} = NULL, atualizado_em = NOW(), atualizado_por = $1 WHERE id = 1 RETURNING *`,
      [request.user.sub],
    );
    await apagarArquivo(antes[0]?.url);
    await registrarAuditoria({ usuarioId: request.user.sub, acao: `imagem_${tipo}_removida`, entidade: 'config_aparencia', ip: request.ip });
    return paraResposta(rows[0]);
  });

  app.post('/restaurar', { preHandler: somenteAdmin }, async (request) => {
    const { rows: antes } = await query('SELECT logo_url, logo_escuro_url, imagem_fundo_url, favicon_url FROM config_aparencia WHERE id = 1');
    await query('DELETE FROM config_aparencia WHERE id = 1');
    const { rows } = await query('INSERT INTO config_aparencia (id, atualizado_por) VALUES (1, $1) RETURNING *', [
      request.user.sub,
    ]);
    await apagarArquivo(antes[0]?.logo_url);
    await apagarArquivo(antes[0]?.imagem_fundo_url);
    await apagarArquivo(antes[0]?.logo_escuro_url);
    await apagarArquivo(antes[0]?.favicon_url);
    await registrarAuditoria({ usuarioId: request.user.sub, acao: 'aparencia_restaurada', entidade: 'config_aparencia', ip: request.ip });
    return paraResposta(rows[0]);
  });
}
