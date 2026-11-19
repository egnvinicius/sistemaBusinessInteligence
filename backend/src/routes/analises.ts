import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { pool, query } from '../db/pool.js';
import { autenticado, somenteAdmin, somenteDesenvolvedor } from '../lib/auth.js';
import { registrarAuditoria } from '../lib/auditoria.js';
import { ehDuplicado, lerId, validar } from '../lib/http.js';
import { ehExpressao } from '../paineis/expressoes.js';
import { ErroIa, erroParaCliente, montarComIa, textoDoLog } from '../paineis/ia.js';
import { conferirColunas, visualSchema } from '../paineis/visuais.js';
import { colunasDaAcao } from '../paineis/cuboTabela.js';
import { carregarCubos, colunasDoCubo, cubosVisiveis, type CuboLinha } from '../paineis/cubos.js';
import {
  barraDeFiltros,
  calcularAnalise,
  filtroTopoSchema,
  ligacoesParaTela,
  ligacoesSchema,
  MAX_CUBOS,
  MAX_FILTROS_TOPO,
  problemaNoModelo,
  type FiltroTopo,
  type LigacoesCfg,
  type VisualDaAnalise,
} from '../paineis/modeloAnalise.js';
import { SQL_VISIVEIS, usuarioAtivo } from './menu.js';

/* =========================================================
   Análises pessoais com IA, a partir de um ou mais cubos
   ========================================================= */

const visuaisSchema = z.array(z.unknown()).max(30, 'Use no máximo 30 visuais por análise.');

/** O que define uma análise (salva ou ainda em edição). */
const modeloSchema = z.object({
  cubos: z.array(z.number().int().positive()).min(1, 'Escolha um cubo.').max(MAX_CUBOS, `Use no máximo ${MAX_CUBOS} cubos por análise.`),
  filtrosTopo: z.array(filtroTopoSchema).max(MAX_FILTROS_TOPO, `Use no máximo ${MAX_FILTROS_TOPO} filtros no topo.`).default([]),
  ligacoes: ligacoesSchema,
});

/** Aceita também o formato antigo, de um cubo só ({ cuboId }). */
const comCuboUnico = (corpo: unknown) => {
  const b = (corpo ?? {}) as Record<string, unknown>;
  return !Array.isArray(b.cubos) && typeof b.cuboId === 'number' ? { ...b, cubos: [b.cuboId] } : b;
};

const valoresSchema = z.record(z.string(), z.unknown()).default({});

export interface PainelReferencia {
  id: number;
  nome: string;
  descricao: string | null;
  cuboId: number;
  visuais: { tipo: string; titulo: string; config: Record<string, unknown>; layout: { x: number; y: number; w: number; h: number } }[];
  /** Visuais do painel que não funcionam com este cubo (outras colunas ou outra consulta) */
  foraDoCubo: number;
  /** Visuais copiados sem algum filtro ou destaque com exec= (expressões não valem nas análises) */
  semExpressao: string[];
}

/**
 * Painéis que o usuário pode ver, com os visuais que funcionam no cubo:
 * - cubo de consulta: visuais da mesma consulta;
 * - cubo de ação: visuais cujas colunas existem na tabela da ação.
 * Filtros e destaques com exec= são retirados (não valem nas análises).
 */
async function paineisDoCubo(usuarioId: number, c: CuboLinha): Promise<PainelReferencia[]> {
  const u = await usuarioAtivo(usuarioId);
  if (!u) return [];
  const { rows: paineis } = await query(`${SQL_VISIVEIS} AND p.analise_id IS NULL ORDER BY LOWER(p.nome)`, [usuarioId, u.veTudo]);
  if (!paineis.length) return [];
  const { rows: visuais } = await query(
    `SELECT painel_id, tipo, titulo, consulta_id, config, layout FROM painel_visuais WHERE painel_id = ANY($1::int[])
      ORDER BY painel_id, (layout->>'y')::int, (layout->>'x')::int, id`,
    [paineis.map((p) => p.id)],
  );
  const semExec = (lista: any[] | undefined) => (lista ?? []).filter((f) => !ehExpressao(f?.valor));
  return paineis
    .map((p) => {
      const doPainel = visuais.filter((v) => v.painel_id === p.id);
      const servem = doPainel.filter((v) => {
        if (!c.tabela && v.consulta_id !== c.consulta_id) return false;
        const cfg = { ...v.config, filtrosVisual: semExec(v.config?.filtrosVisual), destaques: semExec(v.config?.destaques) };
        const r = visualSchema.safeParse({ tipo: v.tipo, titulo: v.titulo, consultaId: c.consulta_id, config: cfg, layout: v.layout });
        return r.success && !conferirColunas(r.data, c.colunas);
      });
      return {
        id: p.id,
        nome: p.nome,
        descricao: p.descricao,
        cuboId: c.id,
        visuais: servem.map((v) => ({
          tipo: v.tipo,
          titulo: v.titulo,
          config: { ...v.config, filtrosVisual: semExec(v.config?.filtrosVisual), destaques: semExec(v.config?.destaques) },
          layout: v.layout,
        })),
        foraDoCubo: doPainel.length - servem.length,
        semExpressao: servem
          .filter((v) => [...(v.config?.filtrosVisual ?? []), ...(v.config?.destaques ?? [])].some((f: any) => ehExpressao(f?.valor)))
          .map((v) => v.titulo),
      };
    })
    .filter((p) => p.visuais.length);
}

/**
 * Valida os visuais de uma análise: cada um num dos cubos dela (sem cubo = o primeiro),
 * colunas existentes e sem exec= (expressões SQL ficam só nos painéis oficiais).
 */
function validarVisuais(brutos: unknown[], cubos: Map<number, CuboLinha>, principal: number) {
  const visuais: VisualDaAnalise[] = [];
  for (const b of brutos) {
    const bruto = (b ?? {}) as Record<string, unknown>;
    const cuboId = typeof bruto.cuboId === 'number' ? bruto.cuboId : principal;
    const c = cubos.get(cuboId);
    if (!c) return { erro: `"${String(bruto.titulo ?? 'Visual')}": o cubo deste visual não está na análise.` };
    const r = visualSchema.safeParse({ ...bruto, consultaId: c.consulta_id });
    if (!r.success) return { erro: r.error.issues[0].message };
    const cfg = r.data.config as any;
    if ([...(cfg.filtrosVisual ?? []), ...(cfg.destaques ?? [])].some((f: any) => ehExpressao(f?.valor))) {
      return { erro: `"${r.data.titulo}": valores com exec= não são permitidos nas análises.` };
    }
    const problema = conferirColunas(r.data, c.colunas);
    if (problema) return { erro: problema };
    visuais.push({ ...r.data, cuboId });
  }
  return { visuais };
}

/** Cubos de uma análise que o usuário pode usar, com o modelo conferido. */
async function abrirModelo(usuarioId: number, d: { cubos: number[]; filtrosTopo: FiltroTopo[]; ligacoes: LigacoesCfg }) {
  const ids = [...new Set(d.cubos)];
  const { cubos, faltando } = await carregarCubos(ids, usuarioId);
  if (faltando) return { status: 404, erro: 'Um dos cubos da análise não existe mais, está inativo ou não está liberado para você.' };
  const problema = problemaNoModelo(cubos, d.filtrosTopo, d.ligacoes);
  if (problema) return { status: 400, erro: problema };
  return { cubos, principal: ids[0] };
}

/** Análise salva, para o dono (edição) ou para quem vê o painel publicado (sem conferir os cubos). */
export async function carregarAnalise(id: number, usuarioId?: number) {
  const { rows } = await query(
    `SELECT a.id, a.usuario_id AS "usuarioId", a.nome, a.cubos, a.visuais, a.filtros, a.filtros_topo AS "filtrosTopo", a.ligacoes, a.atualizado_em AS "atualizadoEm"
       FROM analises a WHERE a.id = $1 ${usuarioId ? 'AND a.usuario_id = $2' : ''}`,
    usuarioId ? [id, usuarioId] : [id],
  );
  return rows[0] ?? null;
}

/** Dados de uma análise salva (tela Visualizar e painel publicado). */
export async function dadosDaAnaliseSalva(a: any, valores: Record<string, unknown>, usuarioId?: number) {
  const { cubos, faltando } = await carregarCubos(a.cubos, usuarioId);
  if (faltando) throw new Error('Um dos cubos desta análise não existe mais, está inativo ou não está liberado.');
  const v = validarVisuais(a.visuais, cubos, a.cubos[0]);
  if (v.erro) throw new Error(v.erro);
  const filtrosTopo = z.array(filtroTopoSchema).catch([]).parse(a.filtrosTopo);
  const ligacoes = ligacoesSchema.catch({ manuais: [], desligadas: [] }).parse(a.ligacoes);
  return calcularAnalise(cubos, v.visuais!, filtrosTopo, ligacoes, valores);
}

/** Definição de uma análise salva para quem só vai ver (filtros com opções e visuais). */
export async function definicaoDaAnaliseSalva(a: any, usuarioId?: number) {
  const { cubos, faltando } = await carregarCubos(a.cubos, usuarioId);
  if (faltando) throw new Error('Um dos cubos desta análise não existe mais, está inativo ou não está liberado.');
  const filtrosTopo = z.array(filtroTopoSchema).catch([]).parse(a.filtrosTopo);
  const filtros = await barraDeFiltros(cubos, filtrosTopo, a.filtros ?? {});
  // Valores salvos na análise viram o ponto de partida de quem vê
  const salvos = a.filtros ?? {};
  return {
    filtros: filtros.map((f) => (f.parametro in salvos ? { ...f, padrao: salvos[f.parametro] } : f)),
    visuais: (a.visuais as any[]).map((v, i) => ({ id: i, tipo: v.tipo, titulo: v.titulo, config: v.config, layout: v.layout })),
  };
}

export async function rotasAnalises(app: FastifyInstance) {
  app.addHook('preHandler', autenticado);

  /* ---------- Cubos disponíveis ---------- */

  app.get('/cubos', async (request, reply) => {
    const u = await usuarioAtivo(request.user.sub);
    if (!u) return reply.code(401).send({ erro: 'Usuário inativo.' });
    const rows = await cubosVisiveis(request.user.sub, u.veTudo);
    return rows.filter((c) => c.colunas.length).map((c) => ({ id: c.id, nome: c.nome, descricao: c.descricao, colunas: colunasDoCubo(c) }));
  });

  /** Um cubo (formato antigo, de uma análise de um cubo só). */
  app.get('/cubos/:id', async (request, reply) => {
    const id = lerId(request.params, reply);
    if (!id) return;
    const { cubos, faltando } = await carregarCubos([id], request.user.sub);
    if (faltando) return reply.code(404).send({ erro: 'Cubo não encontrado ou sem permissão de acesso.' });
    const c = cubos.get(id)!;
    return { id: c.id, nome: c.nome, descricao: c.descricao, colunas: colunasDoCubo(c), filtros: await barraDeFiltros(cubos, []), iaDisponivel: !!config.anthropicApiKey };
  });

  app.get('/cubos/:id/paineis', async (request, reply) => {
    const id = lerId(request.params, reply);
    if (!id) return;
    const { cubos, faltando } = await carregarCubos([id], request.user.sub);
    if (faltando) return reply.code(404).send({ erro: 'Cubo não encontrado ou sem permissão de acesso.' });
    return paineisDoCubo(request.user.sub, cubos.get(id)!);
  });

  /** Cubos, ligações em vigor e barra de filtros de uma análise (salva ou em edição). */
  app.post('/modelo', async (request, reply) => {
    const d = validar(modeloSchema.extend({ filtros: valoresSchema }), comCuboUnico(request.body), reply);
    if (!d) return;
    const m = await abrirModelo(request.user.sub, d);
    if (m.erro) return reply.code(m.status!).send({ erro: m.erro });
    const cubos = m.cubos!;
    return {
      cubos: [...cubos.values()].map((c) => ({ id: c.id, nome: c.nome, descricao: c.descricao, colunas: colunasDoCubo(c) })),
      ligacoes: ligacoesParaTela(cubos, d.ligacoes),
      filtros: await barraDeFiltros(cubos, d.filtrosTopo, d.filtros),
      iaDisponivel: !!config.anthropicApiKey,
    };
  });

  /** Painéis prontos que servem de ponto de partida (ou de referência para a IA) nos cubos. */
  app.post('/paineis-prontos', async (request, reply) => {
    const d = validar(z.object({ cubos: modeloSchema.shape.cubos }), request.body, reply);
    if (!d) return;
    const { cubos, faltando } = await carregarCubos(d.cubos, request.user.sub);
    if (faltando) return reply.code(404).send({ erro: 'Cubo não encontrado ou sem permissão de acesso.' });
    return (await Promise.all([...cubos.values()].map((c) => paineisDoCubo(request.user.sub, c)))).flat();
  });

  /* ---------- Dados ---------- */

  app.post('/dados', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (request, reply) => {
    const d = validar(modeloSchema.extend({ visuais: visuaisSchema, filtros: valoresSchema }), comCuboUnico(request.body), reply);
    if (!d) return;
    const m = await abrirModelo(request.user.sub, d);
    if (m.erro) return reply.code(m.status!).send({ erro: m.erro });
    const v = validarVisuais(d.visuais, m.cubos!, m.principal!);
    if (v.erro) return reply.code(400).send({ erro: v.erro });
    return { visuais: await calcularAnalise(m.cubos!, v.visuais!, d.filtrosTopo, d.ligacoes, d.filtros) };
  });

  /* ---------- IA ---------- */

  app.post('/ia', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const d = validar(
      modeloSchema.extend({
        pedido: z.string().trim().min(3, 'Descreva o que você quer ver.').max(2000),
        visuais: visuaisSchema.default([]),
      }),
      comCuboUnico(request.body),
      reply,
    );
    if (!d) return;
    const m = await abrirModelo(request.user.sub, d);
    if (m.erro) return reply.code(m.status!).send({ erro: m.erro });
    const cubos = m.cubos!;
    const atuais = validarVisuais(d.visuais, cubos, m.principal!);
    if (atuais.erro) return reply.code(400).send({ erro: atuais.erro });

    const { rows: uso } = await query<{ n: string }>(
      `SELECT COUNT(*) AS n FROM ia_log WHERE usuario_id = $1 AND criado_em >= date_trunc('day', NOW())`,
      [request.user.sub],
    );
    if (Number(uso[0].n) >= config.iaLimiteDiario) {
      return reply.code(429).send({ erro: `Você atingiu o limite de ${config.iaLimiteDiario} pedidos à IA hoje. O limite volta amanhã.` });
    }

    const inicio = Date.now();
    const registrar = (sucesso: boolean, extra: { erro?: string; tokens?: { entrada: number | null; saida: number | null }; modelo?: string }) =>
      query(
        `INSERT INTO ia_log (usuario_id, cubo_id, pedido, sucesso, erro, modelo, tokens_entrada, tokens_saida, duracao_ms)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [request.user.sub, m.principal, d.pedido, sucesso, extra.erro ?? null, extra.modelo ?? config.anthropicModelo, extra.tokens?.entrada ?? null, extra.tokens?.saida ?? null, Date.now() - inicio],
      ).catch(() => undefined);

    try {
      const lista = [...cubos.values()];
      const ligacoes = ligacoesParaTela(cubos, d.ligacoes).map((l) => `- ${l.aNome}.${l.a.coluna} = ${l.bNome}.${l.b.coluna}`);
      const paineis = (await Promise.all(lista.map((c) => paineisDoCubo(request.user.sub, c)))).flat();
      const r = await montarComIa(
        lista.map((c) => ({ id: c.id, nome: c.nome, descricao: c.descricao, consultaId: c.consulta_id, colunas: colunasDoCubo(c) })),
        ligacoes,
        d.pedido,
        atuais.visuais!.map((v) => ({ cuboId: v.cuboId, tipo: v.tipo, titulo: v.titulo, config: v.config, layout: v.layout })),
        d.filtrosTopo,
        paineis,
      );
      await registrar(true, { tokens: r.tokens, modelo: r.modelo });
      // A IA não monta imagens: as que já estavam continuam na análise
      const imagens = atuais.visuais!.filter((v) => v.tipo === 'imagem' && !r.visuais.some((x) => x.titulo === v.titulo));
      return {
        visuais: [...imagens, ...r.visuais].map(({ consultaId: _c, ...v }) => v),
        filtrosTopo: r.filtros,
        mensagem: r.mensagem,
        avisos: r.avisos,
      };
    } catch (e) {
      if (e instanceof ErroIa) {
        await registrar(false, { erro: textoDoLog(e) });
        // Usuário vê a mensagem; Gestor e Desenvolvedor também o motivo técnico
        return reply.code(e.status).send(erroParaCliente(e, request.user.perfil));
      }
      await registrar(false, { erro: (e as Error).message });
      throw e;
    }
  });

  /**
   * Visuais das próprias análises, para incluir uma cópia em outra ("Incluir existente").
   * Só os de cubos que a pessoa ainda pode usar; imagens valem sempre.
   */
  app.get('/objetos', async (request, reply) => {
    const q = request.query as { busca?: string; tipo?: string; analiseId?: string };
    const busca = String(q.busca ?? '').trim().slice(0, 120);
    const tipo = ['kpi', 'barra', 'linha', 'pizza', 'tabela', 'imagem'].includes(String(q.tipo)) ? String(q.tipo) : null;
    const u = await usuarioAtivo(request.user.sub);
    if (!u) return reply.code(401).send({ erro: 'Usuário inativo.' });
    const cubos = new Map((await cubosVisiveis(request.user.sub, u.veTudo)).map((c) => [c.id, c]));
    const { rows } = await query(
      `SELECT a.id AS "analiseId", a.nome AS "analiseNome", x.v AS visual, x.o AS ordem
         FROM analises a, jsonb_array_elements(a.visuais) WITH ORDINALITY AS x(v, o)
        WHERE a.usuario_id = $1
        ORDER BY (a.id = $2) DESC, a.atualizado_em DESC`,
      [request.user.sub, Number(q.analiseId) || 0],
    );
    const normal = (t: string) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const termo = normal(busca);
    const saida = [];
    for (const r of rows) {
      const v = r.visual ?? {};
      if (tipo && v.tipo !== tipo) continue;
      const cubo = cubos.get(v.cuboId);
      if (v.tipo !== 'imagem' && !cubo) continue;
      if (termo && ![v.titulo, r.analiseNome, cubo?.nome ?? ''].some((t) => normal(String(t ?? '')).includes(termo))) continue;
      saida.push({
        id: `${r.analiseId}-${r.ordem}`,
        tipo: v.tipo,
        titulo: v.titulo,
        cuboId: v.cuboId,
        cuboNome: cubo?.nome ?? null,
        config: v.config ?? {},
        layout: v.layout,
        analiseId: r.analiseId,
        analiseNome: r.analiseNome,
      });
      if (saida.length >= 60) break;
    }
    return saida;
  });

  /* ---------- Análises pessoais ---------- */

  app.get('/', async (request, reply) => {
    // ?de=outros: o Desenvolvedor vê as análises de todos os usuários (só para ver)
    const outros = (request.query as { de?: string }).de === 'outros';
    if (outros && request.user.perfil !== 'desenvolvedor') return reply.code(403).send({ erro: 'Só o Desenvolvedor vê as análises de outros usuários.' });
    const { rows } = await query(
      `SELECT a.id, a.nome, a.cubos, u.nome AS "donoNome", p.visibilidade,
              (SELECT string_agg(c.nome, ' + ' ORDER BY x.o) FROM jsonb_array_elements_text(a.cubos) WITH ORDINALITY AS x(id, o)
                 JOIN cubos c ON c.id = x.id::int) AS "cuboNome",
              jsonb_array_length(a.visuais) AS visuais, a.atualizado_em AS "atualizadoEm",
              p.id AS "painelId", p.nome AS "painelNome"
         FROM analises a
         JOIN usuarios u ON u.id = a.usuario_id
         LEFT JOIN paineis p ON p.analise_id = a.id
        WHERE ${outros ? 'a.usuario_id <> $1' : 'a.usuario_id = $1'}
        ORDER BY ${outros ? 'LOWER(u.nome), ' : ''}a.atualizado_em DESC`,
      [request.user.sub],
    );
    return rows;
  });

  app.get('/:id', async (request, reply) => {
    const id = lerId(request.params, reply);
    if (!id) return;
    const a = await carregarAnalise(id, request.user.sub);
    if (!a) return reply.code(404).send({ erro: 'Análise não encontrada.' });
    const { faltando } = await carregarCubos(a.cubos, request.user.sub);
    if (faltando) return reply.code(403).send({ erro: 'Você não tem mais acesso a um dos cubos desta análise.' });
    const { rows: p } = await query(
      `SELECT p.id, p.nome, p.descricao, p.menu_subgrupo_id AS "menuSubgrupoId", p.ativo, p.visibilidade,
              COALESCE(array_agg(pp.grupo_usuario_id) FILTER (WHERE pp.grupo_usuario_id IS NOT NULL), '{}') AS grupos
         FROM paineis p LEFT JOIN painel_permissao pp ON pp.painel_id = p.id
        WHERE p.analise_id = $1 GROUP BY p.id`,
      [id],
    );
    const { usuarioId: _u, ...resto } = a;
    return { ...resto, painel: p[0] ?? null };
  });

  /** Visualizar: definição e dados de uma análise salva, sem a parte de montagem. */
  app.get('/:id/definicao', async (request, reply) => {
    const id = lerId(request.params, reply);
    if (!id) return;
    const dev = request.user.perfil === 'desenvolvedor';
    const a = await carregarAnalise(id, dev ? undefined : request.user.sub);
    if (!a) return reply.code(404).send({ erro: 'Análise não encontrada.' });
    try {
      const { rows: p } = await query('SELECT id FROM paineis WHERE analise_id = $1', [id]);
      const { rows: dono } = await query('SELECT nome FROM usuarios WHERE id = $1', [a.usuarioId]);
      await registrarAuditoria({ usuarioId: request.user.sub, acao: 'analise_acessada', entidade: 'analises', detalhes: { id }, ip: request.ip });
      return {
        id: a.id,
        nome: a.nome,
        painelId: p[0]?.id ?? null,
        doUsuario: a.usuarioId === request.user.sub,
        donoNome: dono[0]?.nome ?? null,
        ...(await definicaoDaAnaliseSalva(a, request.user.sub)),
      };
    } catch (e) {
      return reply.code(403).send({ erro: (e as Error).message });
    }
  });

  app.post('/:id/dados', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (request, reply) => {
    const id = lerId(request.params, reply);
    if (!id) return;
    const d = validar(z.object({ filtros: valoresSchema }), request.body, reply);
    if (!d) return;
    const a = await carregarAnalise(id, request.user.perfil === 'desenvolvedor' ? undefined : request.user.sub);
    if (!a) return reply.code(404).send({ erro: 'Análise não encontrada.' });
    try {
      return { visuais: await dadosDaAnaliseSalva(a, d.filtros, request.user.sub) };
    } catch (e) {
      return reply.code(403).send({ erro: (e as Error).message });
    }
  });

  const salvar = async (request: any, reply: any, id: number | null) => {
    const d = validar(
      modeloSchema.extend({
        nome: z.string().trim().min(1, 'Dê um nome à análise.').max(120),
        visuais: visuaisSchema,
        filtros: valoresSchema,
      }),
      comCuboUnico(request.body),
      reply,
    );
    if (!d) return;
    const m = await abrirModelo(request.user.sub, d);
    if (m.erro) return reply.code(m.status!).send({ erro: m.erro });
    const v = validarVisuais(d.visuais, m.cubos!, m.principal!);
    if (v.erro) return reply.code(400).send({ erro: v.erro });
    const visuais = JSON.stringify(v.visuais!.map(({ tipo, titulo, config: cfg, layout, cuboId }) => ({ cuboId, tipo, titulo, config: cfg, layout })));
    const cubos = JSON.stringify([...new Set(d.cubos)]);
    const params = [request.user.sub, d.nome, m.principal, cubos, visuais, JSON.stringify(d.filtros), JSON.stringify(d.filtrosTopo), JSON.stringify(d.ligacoes)];
    if (id) {
      const { rowCount } = await query(
        `UPDATE analises SET nome = $2, cubo_id = $3, cubos = $4, visuais = $5, filtros = $6, filtros_topo = $7, ligacoes = $8, atualizado_em = NOW()
          WHERE id = $9 AND usuario_id = $1`,
        [...params, id],
      );
      if (!rowCount) return reply.code(404).send({ erro: 'Análise não encontrada.' });
      return { id };
    }
    const { rows } = await query(
      `INSERT INTO analises (usuario_id, nome, cubo_id, cubos, visuais, filtros, filtros_topo, ligacoes) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      params,
    );
    return reply.code(201).send({ id: rows[0].id });
  };

  app.post('/', (request, reply) => salvar(request, reply, null));
  app.put('/:id', (request, reply) => {
    const id = lerId(request.params, reply);
    if (!id) return;
    return salvar(request, reply, id);
  });

  /* ---------- Publicar como painel (qualquer perfil, na análise própria) ---------- */

  /** Grupos e subgrupos do menu onde o usuário pode publicar (inclusive vazios). */
  app.get('/locais-menu', async (request, reply) => {
    const u = await usuarioAtivo(request.user.sub);
    if (!u) return reply.code(401).send({ erro: 'Usuário inativo.' });
    const { rows } = await query(
      `WITH RECURSIVE arv AS (
         SELECT s.id, s.menu_grupo_id, s.subgrupo_pai_id, s.nome::text AS caminho, s.ordem, ARRAY[s.ordem] AS chave
           FROM menu_subgrupos s WHERE s.subgrupo_pai_id IS NULL
         UNION ALL
         SELECT s.id, s.menu_grupo_id, s.subgrupo_pai_id, a.caminho || ' › ' || s.nome, s.ordem, a.chave || s.ordem
           FROM menu_subgrupos s JOIN arv a ON s.subgrupo_pai_id = a.id
       )
       SELECT a.id, g.nome AS grupo, a.caminho,
              (SELECT COUNT(*) FROM paineis p WHERE p.menu_subgrupo_id = a.id)::int AS paineis
         FROM arv a JOIN menu_grupos g ON g.id = a.menu_grupo_id
        WHERE $2::boolean OR usuario_acessa_subgrupo($1, a.id)
        ORDER BY g.ordem, LOWER(g.nome), a.chave, LOWER(a.caminho)`,
      [request.user.sub, u.veTudo],
    );
    return rows;
  });

  app.put('/:id/publicacao', async (request, reply) => {
    const id = lerId(request.params, reply);
    if (!id) return;
    const d = validar(
      z.object({
        nome: z.string().trim().min(1, 'Dê um nome ao painel.').max(120),
        descricao: z.string().trim().max(255).nullable().default(null).transform((v) => v || null),
        menuSubgrupoId: z.number().int().positive(),
        visibilidade: z.enum(['subgrupo', 'privado']),
        ativo: z.boolean().default(true),
      }),
      request.body,
      reply,
    );
    if (!d) return;
    const a = await carregarAnalise(id, request.user.sub);
    if (!a) return reply.code(404).send({ erro: 'Análise não encontrada. Só o dono publica a análise.' });
    const u = await usuarioAtivo(request.user.sub);
    if (!u) return reply.code(401).send({ erro: 'Usuário inativo.' });
    const { rows: acesso } = await query('SELECT usuario_acessa_subgrupo($1, $2) AS ok, EXISTS (SELECT 1 FROM menu_subgrupos WHERE id = $2) AS existe', [
      request.user.sub,
      d.menuSubgrupoId,
    ]);
    if (!acesso[0].existe) return reply.code(400).send({ erro: 'Local do menu não encontrado.' });
    if (!u.veTudo && !acesso[0].ok) return reply.code(403).send({ erro: 'Você não tem acesso a esse local do menu. Escolha outro.' });
    try {
      const { rows: atual } = await query('SELECT id FROM paineis WHERE analise_id = $1', [id]);
      let painelId = atual[0]?.id as number | undefined;
      if (painelId) {
        await query(
          `UPDATE paineis SET nome = $2, descricao = $3, visibilidade = $4, ativo = $5, atualizado_em = NOW(),
                  ordem = CASE WHEN menu_subgrupo_id <> $6 THEN (SELECT COALESCE(MAX(ordem), -1) + 1 FROM paineis WHERE menu_subgrupo_id = $6) ELSE ordem END,
                  menu_subgrupo_id = $6
            WHERE id = $1`,
          [painelId, d.nome, d.descricao, d.visibilidade, d.ativo, d.menuSubgrupoId],
        );
      } else {
        const { rows } = await query(
          `INSERT INTO paineis (menu_subgrupo_id, nome, descricao, ativo, ordem, analise_id, dono_id, visibilidade)
           VALUES ($1, $2, $3, $4, (SELECT COALESCE(MAX(ordem), -1) + 1 FROM paineis WHERE menu_subgrupo_id = $1), $5, $6, $7)
           RETURNING id`,
          [d.menuSubgrupoId, d.nome, d.descricao, d.ativo, id, request.user.sub, d.visibilidade],
        );
        painelId = rows[0].id;
      }
      await registrarAuditoria({
        usuarioId: request.user.sub,
        acao: atual[0] ? 'analise_publicacao_alterada' : 'analise_publicada',
        entidade: 'paineis',
        detalhes: { id: painelId, analiseId: id, visibilidade: d.visibilidade },
        ip: request.ip,
      });
      return { id: painelId, ...d };
    } catch (e) {
      if (ehDuplicado(e)) return reply.code(409).send({ erro: 'Já existe um painel com esse nome neste local do menu.' });
      throw e;
    }
  });

  app.delete('/:id/publicacao', async (request, reply) => {
    const id = lerId(request.params, reply);
    if (!id) return;
    const a = await carregarAnalise(id, request.user.sub);
    if (!a) return reply.code(404).send({ erro: 'Análise não encontrada.' });
    const { rows } = await query('DELETE FROM paineis WHERE analise_id = $1 RETURNING id', [id]);
    if (rows[0]) await registrarAuditoria({ usuarioId: request.user.sub, acao: 'analise_despublicada', entidade: 'paineis', detalhes: { id: rows[0].id, analiseId: id }, ip: request.ip });
    return reply.code(204).send();
  });

  app.delete('/:id', async (request, reply) => {
    const id = lerId(request.params, reply);
    if (!id) return;
    const { rows: p } = await query('SELECT p.nome FROM paineis p JOIN analises a ON a.id = p.analise_id WHERE a.id = $1 AND a.usuario_id = $2', [id, request.user.sub]);
    if (p[0]) {
      return reply.code(409).send({ erro: `Esta análise está publicada como o painel "${p[0].nome}". Despublique o painel antes de excluir a análise.` });
    }
    const { rowCount } = await query('DELETE FROM analises WHERE id = $1 AND usuario_id = $2', [id, request.user.sub]);
    if (!rowCount) return reply.code(404).send({ erro: 'Análise não encontrada.' });
    return reply.code(204).send();
  });
}

/* =========================================================
   Cadastro de cubos (Desenvolvedor) e uso da IA (Gestor e Desenvolvedor)
   ========================================================= */

const cuboSchema = z.object({
  nome: z.string().trim().min(1, 'Informe o nome do cubo.').max(120),
  descricao: z.string().trim().max(500).nullable().default(null).transform((v) => v || null),
  /** Origem: a ação (tabela que ela carrega) ou, nos cubos antigos, uma consulta de painel */
  acaoId: z.number().int().positive().nullable().default(null),
  consultaId: z.number().int().positive().nullable().default(null),
  colunasDescricao: z.record(z.string().max(63), z.string().trim().max(200)).default({}),
  grupos: z.array(z.number().int().positive()).max(200).default([]),
  ativo: z.boolean().default(true),
});

export async function rotasCubosAdmin(app: FastifyInstance) {
  const lista = async (id?: number) => {
    const { rows } = await query(
      `SELECT c.id, c.nome, c.descricao, c.consulta_id AS "consultaId", q.nome AS "consultaNome", q.colunas AS "colunasConsulta",
              c.acao_id AS "acaoId", a.nome AS "acaoNome", a.tabela_destino AS "tabelaDestino",
              c.colunas_descricao AS "colunasDescricao", c.ativo,
              COALESCE((SELECT json_agg(json_build_object('id', g.id, 'nome', g.nome) ORDER BY g.nome)
                          FROM cubo_grupos cg JOIN grupos_usuarios g ON g.id = cg.grupo_usuario_id WHERE cg.cubo_id = c.id), '[]') AS grupos,
              (SELECT COUNT(*) FROM analises x WHERE x.cubos @> to_jsonb(c.id))::int AS analises
         FROM cubos c
         LEFT JOIN consultas_painel q ON q.id = c.consulta_id
         LEFT JOIN acoes a ON a.id = c.acao_id
        ${id ? 'WHERE c.id = $1' : ''}
        ORDER BY LOWER(c.nome)`,
      id ? [id] : [],
    );
    return Promise.all(
      rows.map(async ({ colunasConsulta, ...r }) => ({
        ...r,
        colunas: r.acaoId ? (await colunasDaAcao(r.tabelaDestino ?? '')).colunas : (colunasConsulta ?? []),
      })),
    );
  };

  /** Colunas da tabela que uma ação carrega (para o cadastro do cubo). */
  app.get('/colunas-acao/:id', { preHandler: somenteDesenvolvedor }, async (request, reply) => {
    const id = lerId(request.params, reply);
    if (!id) return;
    const { rows } = await query('SELECT tabela_destino FROM acoes WHERE id = $1', [id]);
    if (!rows[0]) return reply.code(404).send({ erro: 'Ação não encontrada.' });
    const r = await colunasDaAcao(rows[0].tabela_destino);
    return { tabelaDestino: rows[0].tabela_destino, colunas: r.colunas };
  });

  app.get('/', { preHandler: somenteAdmin }, () => lista());

  const salvar = async (request: any, reply: any, id: number | null) => {
    const d = validar(cuboSchema, request.body, reply);
    if (!d) return;
    if (!d.acaoId && !d.consultaId) return reply.code(400).send({ erro: 'Escolha a ação do cubo.' });
    if (d.acaoId) d.consultaId = null;
    let colunasOrigem: { nome: string }[];
    if (d.acaoId) {
      const { rows: a } = await query('SELECT tabela_destino FROM acoes WHERE id = $1', [d.acaoId]);
      if (!a[0]) return reply.code(400).send({ erro: 'Ação não encontrada.' });
      colunasOrigem = (await colunasDaAcao(a[0].tabela_destino)).colunas;
      if (!colunasOrigem.length) {
        return reply.code(400).send({ erro: `A tabela ${a[0].tabela_destino} ainda não existe no bi_dados. Rode a tarefa dessa ação uma vez (ou crie a tabela na tela da ação) antes de criar o cubo.` });
      }
    } else {
      const { rows: q } = await query('SELECT colunas FROM consultas_painel WHERE id = $1', [d.consultaId]);
      if (!q[0]) return reply.code(400).send({ erro: 'Consulta não encontrada.' });
      colunasOrigem = q[0].colunas ?? [];
    }
    const nomes = new Set(colunasOrigem.map((c) => c.nome));
    const descricoes = Object.fromEntries(Object.entries(d.colunasDescricao).filter(([k, v]) => nomes.has(k) && v));
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      let novoId = id;
      if (id) {
        const { rowCount } = await client.query(
          `UPDATE cubos SET nome = $2, descricao = $3, consulta_id = $4, acao_id = $7, colunas_descricao = $5, ativo = $6, atualizado_em = NOW() WHERE id = $1`,
          [id, d.nome, d.descricao, d.consultaId, JSON.stringify(descricoes), d.ativo, d.acaoId],
        );
        if (!rowCount) {
          await client.query('ROLLBACK');
          return reply.code(404).send({ erro: 'Cubo não encontrado.' });
        }
        await client.query('DELETE FROM cubo_grupos WHERE cubo_id = $1', [id]);
      } else {
        const { rows } = await client.query(
          `INSERT INTO cubos (nome, descricao, consulta_id, acao_id, colunas_descricao, ativo) VALUES ($1, $2, $3, $6, $4, $5) RETURNING id`,
          [d.nome, d.descricao, d.consultaId, JSON.stringify(descricoes), d.ativo, d.acaoId],
        );
        novoId = rows[0].id;
      }
      if (d.grupos.length) {
        await client.query('INSERT INTO cubo_grupos (cubo_id, grupo_usuario_id) SELECT $1, unnest($2::int[]) ON CONFLICT DO NOTHING', [novoId, d.grupos]);
      }
      await client.query('COMMIT');
      await registrarAuditoria({ usuarioId: request.user.sub, acao: id ? 'cubo_alterado' : 'cubo_criado', entidade: 'cubos', detalhes: { id: novoId, nome: d.nome }, ip: request.ip });
      return reply.code(id ? 200 : 201).send((await lista(novoId!))[0]);
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (ehDuplicado(e)) return reply.code(409).send({ erro: 'Já existe um cubo com esse nome.' });
      if ((e as any)?.code === '23503') return reply.code(400).send({ erro: 'Grupo de acesso não encontrado.' });
      throw e;
    } finally {
      client.release();
    }
  };

  app.post('/', { preHandler: somenteDesenvolvedor }, (request, reply) => salvar(request, reply, null));
  app.put('/:id', { preHandler: somenteDesenvolvedor }, (request, reply) => {
    const id = lerId(request.params, reply);
    if (!id) return;
    return salvar(request, reply, id);
  });

  app.delete('/:id', { preHandler: somenteDesenvolvedor }, async (request, reply) => {
    const id = lerId(request.params, reply);
    if (!id) return;
    const { rows: publicadas } = await query(
      `SELECT p.nome FROM paineis p JOIN analises a ON a.id = p.analise_id WHERE a.cubos @> to_jsonb($1::int) LIMIT 1`,
      [id],
    );
    if (publicadas[0]) {
      return reply.code(409).send({ erro: `O cubo é usado pela análise publicada como o painel "${publicadas[0].nome}". Despublique o painel antes de excluir o cubo.` });
    }
    const { rows } = await query('DELETE FROM cubos WHERE id = $1 RETURNING nome', [id]);
    if (!rows[0]) return reply.code(404).send({ erro: 'Cubo não encontrado.' });
    // Análises que usavam este cubo como secundário: some o cubo e os visuais dele
    await query(
      `UPDATE analises SET cubos = (SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) FROM jsonb_array_elements(cubos) x WHERE x::text::int <> $1),
              visuais = COALESCE((SELECT jsonb_agg(v) FROM jsonb_array_elements(visuais) v WHERE (v->>'cuboId')::int IS DISTINCT FROM $1), '[]'::jsonb),
              filtros_topo = COALESCE((SELECT jsonb_agg(f) FROM jsonb_array_elements(filtros_topo) f WHERE (f->>'cuboId')::int <> $1), '[]'::jsonb)
        WHERE cubos @> to_jsonb($1::int)`,
      [id],
    );
    await registrarAuditoria({ usuarioId: request.user.sub, acao: 'cubo_excluido', entidade: 'cubos', detalhes: { id, nome: rows[0].nome }, ip: request.ip });
    return reply.code(204).send();
  });

  /** Uso da IA nos últimos 30 dias, para acompanhar custo. */
  app.get('/uso-ia', { preHandler: somenteAdmin }, async () => {
    const { rows } = await query(
      `SELECT u.nome AS usuario, COUNT(*)::int AS pedidos, COUNT(*) FILTER (WHERE NOT l.sucesso)::int AS falhas,
              COALESCE(SUM(l.tokens_entrada), 0)::int AS "tokensEntrada", COALESCE(SUM(l.tokens_saida), 0)::int AS "tokensSaida",
              MAX(l.criado_em) AS "ultimoPedido",
              (array_agg(l.erro ORDER BY l.criado_em DESC) FILTER (WHERE NOT l.sucesso))[1] AS "ultimoErro",
              MAX(l.criado_em) FILTER (WHERE NOT l.sucesso) AS "ultimoErroEm"
         FROM ia_log l LEFT JOIN usuarios u ON u.id = l.usuario_id
        WHERE l.criado_em >= NOW() - interval '30 days'
        GROUP BY u.nome ORDER BY pedidos DESC`,
    );
    return { configurada: !!config.anthropicApiKey, modelo: config.anthropicModelo, limiteDiario: config.iaLimiteDiario, uso: rows };
  });
}
