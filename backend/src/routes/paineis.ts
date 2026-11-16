import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool, query } from '../db/pool.js';
import { autenticado, somenteAdmin } from '../lib/auth.js';
import { registrarAuditoria } from '../lib/auditoria.js';
import { lerId, validar } from '../lib/http.js';
import { executarConsulta } from '../paineis/consultas.js';
import { carregarFiltros, opcoesDoFiltro, valorPadrao, valoresParaParametros, type Filtro } from '../paineis/filtros.js';
import { calcularVisual, conferirColunas, visualSchema, type Visual } from '../paineis/visuais.js';
import { filtroResposta } from './catalogoPaineis.js';
import { aplicarExpressoes, avaliarExpressoes, expressoesDoConfig, problemaNaExpressao } from '../paineis/expressoes.js';

/**
 * exec= é SQL: só o Desenvolvedor cria ou altera. O Gestor pode mexer no resto do painel
 * mantendo as expressões que já estavam salvas.
 */
async function conferirExpressoes(perfil: string, painelId: number | null, configs: any[]): Promise<string | null> {
  const novas = new Set(configs.flatMap(expressoesDoConfig));
  for (const e of novas) {
    const p = problemaNaExpressao(`exec=${e}`);
    if (p) return p;
  }
  if (perfil === 'desenvolvedor' || !novas.size) return null;
  const { rows } = painelId ? await query('SELECT config FROM painel_visuais WHERE painel_id = $1', [painelId]) : { rows: [] as any[] };
  const salvas = new Set(rows.flatMap((r: any) => expressoesDoConfig(r.config)));
  const nova = [...novas].find((e) => !salvas.has(e));
  return nova ? 'Valores com exec= são expressões SQL: só um Desenvolvedor pode criá-los ou alterá-los.' : null;
}
import { SQL_VISIVEIS, usuarioAtivo } from './menu.js';
import { carregarAnalise, dadosDaAnaliseSalva, definicaoDaAnaliseSalva } from './analises.js';

/* =========================================================
   Painéis: definição, dados (com filtros) e montagem
   ========================================================= */

const dadosSchema = z.object({ filtros: z.record(z.string(), z.unknown()).default({}) });

const corFundo = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Cor inválida.').nullable().default(null);

const montagemSchema = z.object({
  fundoClaro: corFundo,
  fundoEscuro: corFundo,
  filtros: z.array(z.number().int().positive()).max(12, 'Use no máximo 12 filtros por painel.').default([]),
  visuais: z.array(visualSchema).max(40, 'Use no máximo 40 visuais por painel.'),
});

const previaSchema = z.object({
  visual: visualSchema,
  /** Filtros do painel: a prévia usa os valores iniciais deles. */
  filtrosIds: z.array(z.number().int().positive()).max(12).default([]),
  painelId: z.number().int().positive().nullable().default(null),
});

/** Painel visível para o usuário logado (mesma regra do menu). */
async function painelVisivel(usuarioId: number, painelId: number) {
  const u = await usuarioAtivo(usuarioId);
  if (!u) return null;
  const { rows } = await query(`${SQL_VISIVEIS} AND p.id = $3`, [usuarioId, u.veTudo, painelId]);
  return rows[0] ?? null;
}

export async function filtrosDoPainel(painelId: number): Promise<Filtro[]> {
  const { rows } = await query<Filtro>(
    `SELECT f.* FROM painel_filtros pf JOIN filtros f ON f.id = pf.filtro_id WHERE pf.painel_id = $1 ORDER BY pf.ordem, f.id`,
    [painelId],
  );
  return rows;
}

export async function visuaisDoPainel(painelId: number) {
  const { rows } = await query(
    `SELECT v.id, v.tipo, v.titulo, v.consulta_id, v.config, v.layout, c.sql, c.nome AS consulta_nome
       FROM painel_visuais v JOIN consultas_painel c ON c.id = v.consulta_id
      WHERE v.painel_id = $1
      ORDER BY (v.layout->>'y')::int, (v.layout->>'x')::int, v.id`,
    [painelId],
  );
  return rows;
}

/** Filtros com suas opções e valor inicial, prontos para a barra de filtros. */
export async function filtrosComOpcoes(filtros: Filtro[]) {
  return Promise.all(
    filtros.map(async (f) => {
      let opcoes = null;
      let erro = null;
      try {
        opcoes = await opcoesDoFiltro(f);
      } catch (e) {
        erro = `Não foi possível carregar as opções: ${(e as Error).message}`;
      }
      return {
        id: f.id,
        nome: f.nome,
        parametro: f.parametro,
        tipo: f.tipo,
        multiplo: f.multiplo,
        padrao: valorPadrao(f),
        opcoes,
        erro,
      };
    }),
  );
}

/**
 * Calcula os visuais com os filtros escolhidos. Cada consulta roda uma vez só,
 * mesmo que vários visuais a usem; o erro de um visual não derruba os outros.
 */
export async function calcular(
  visuais: { id: number | string; tipo: string; titulo: string; consulta_id: number; config: any; layout: any; sql: string }[],
  filtros: Filtro[],
  escolhidos: Record<string, unknown>,
) {
  const valores = valoresParaParametros(filtros, escolhidos);
  const porConsulta = new Map<number, ReturnType<typeof executarConsulta>>();
  return Promise.all(
    visuais.map(async (v) => {
      try {
        if (!porConsulta.has(v.consulta_id)) porConsulta.set(v.consulta_id, executarConsulta({ id: v.consulta_id, sql: v.sql }, valores));
        const r = await porConsulta.get(v.consulta_id)!;
        const exprs = expressoesDoConfig(v.config);
        const config = exprs.length ? aplicarExpressoes(v.config, await avaliarExpressoes(exprs)) : v.config;
        const visual = { tipo: v.tipo, titulo: v.titulo, consultaId: v.consulta_id, config, layout: v.layout } as Visual;
        const problema = conferirColunas(visual, r.colunas);
        if (problema) return { id: v.id, erro: problema };
        return { id: v.id, dados: calcularVisual(visual, r), geradoEm: r.geradoEm };
      } catch (e) {
        return { id: v.id, erro: (e as Error).message };
      }
    }),
  );
}

export async function rotasPaineis(app: FastifyInstance) {
  /* ---------- Visualização (qualquer usuário com acesso ao painel) ---------- */

  app.get('/:id/definicao', { preHandler: autenticado }, async (request, reply) => {
    const id = lerId(request.params, reply);
    if (!id) return;
    const p = await painelVisivel(request.user.sub, id);
    if (!p) return reply.code(404).send({ erro: 'Painel não encontrado ou sem permissão de acesso.' });
    if (p.analise_id) {
      // Painel que mostra uma análise publicada: quem tem acesso ao painel vê, mesmo sem acesso aos cubos
      const a = await carregarAnalise(p.analise_id);
      if (!a) return reply.code(404).send({ erro: 'A análise deste painel não existe mais.' });
      try {
        return {
          id: p.id,
          nome: p.nome,
          descricao: p.descricao,
          fundoClaro: p.fundo_claro,
          fundoEscuro: p.fundo_escuro,
          analiseId: a.id,
          analiseDoUsuario: a.usuarioId === request.user.sub,
          ...(await definicaoDaAnaliseSalva(a)),
        };
      } catch (e) {
        return reply.code(409).send({ erro: (e as Error).message });
      }
    }
    const [filtros, visuais] = await Promise.all([filtrosDoPainel(id), visuaisDoPainel(id)]);
    return {
      id: p.id,
      analiseId: null,
      nome: p.nome,
      descricao: p.descricao,
      fundoClaro: p.fundo_claro,
      fundoEscuro: p.fundo_escuro,
      filtros: await filtrosComOpcoes(filtros),
      visuais: visuais.map((v) => ({ id: v.id, tipo: v.tipo, titulo: v.titulo, config: v.config, layout: v.layout })),
    };
  });

  app.post('/:id/dados', { preHandler: autenticado, config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (request, reply) => {
    const id = lerId(request.params, reply);
    if (!id) return;
    const d = validar(dadosSchema, request.body, reply);
    if (!d) return;
    const p = await painelVisivel(request.user.sub, id);
    if (!p) return reply.code(404).send({ erro: 'Painel não encontrado ou sem permissão de acesso.' });
    if (p.analise_id) {
      const a = await carregarAnalise(p.analise_id);
      if (!a) return reply.code(404).send({ erro: 'A análise deste painel não existe mais.' });
      try {
        return { visuais: await dadosDaAnaliseSalva(a, d.filtros) };
      } catch (e) {
        return reply.code(409).send({ erro: (e as Error).message });
      }
    }
    const [filtros, visuais] = await Promise.all([filtrosDoPainel(id), visuaisDoPainel(id)]);
    return { visuais: await calcular(visuais, filtros, d.filtros) };
  });

  /* ---------- Montagem (Gestor e Desenvolvedor) ---------- */

  app.get('/:id/montagem', { preHandler: somenteAdmin }, async (request, reply) => {
    const id = lerId(request.params, reply);
    if (!id) return;
    const { rows } = await query(
      `SELECT p.id, p.nome, p.descricao, p.ativo, p.fundo_claro AS "fundoClaro", p.fundo_escuro AS "fundoEscuro",
              p.analise_id AS "analiseId", a.nome AS "analiseNome", u.nome AS "analiseDono", (a.usuario_id = $2) AS "analiseDoUsuario"
         FROM paineis p LEFT JOIN analises a ON a.id = p.analise_id LEFT JOIN usuarios u ON u.id = a.usuario_id
        WHERE p.id = $1`,
      [id, request.user.sub],
    );
    if (!rows[0]) return reply.code(404).send({ erro: 'Painel não encontrado.' });
    const [filtros, visuais] = await Promise.all([filtrosDoPainel(id), visuaisDoPainel(id)]);
    return {
      ...rows[0],
      filtros: filtros.map((f) => filtroResposta(f)),
      visuais: visuais.map((v) => ({
        id: v.id,
        tipo: v.tipo,
        titulo: v.titulo,
        consultaId: v.consulta_id,
        consultaNome: v.consulta_nome,
        config: v.config,
        layout: v.layout,
      })),
    };
  });

  app.put('/:id/montagem', { preHandler: somenteAdmin }, async (request, reply) => {
    const id = lerId(request.params, reply);
    if (!id) return;
    const d = validar(montagemSchema, request.body, reply);
    if (!d) return;
    const { rows: existe } = await query('SELECT nome, analise_id FROM paineis WHERE id = $1', [id]);
    if (!existe[0]) return reply.code(404).send({ erro: 'Painel não encontrado.' });
    if (existe[0].analise_id) {
      return reply.code(409).send({ erro: 'Este painel mostra uma análise publicada: os gráficos são alterados na própria análise, pelo dono dela.' });
    }
    const semPermissao = await conferirExpressoes(request.user.perfil, id, d.visuais.map((v) => v.config));
    if (semPermissao) return reply.code(403).send({ erro: semPermissao });

    // As colunas usadas em cada visual precisam existir na consulta escolhida
    const ids = [...new Set(d.visuais.map((v) => v.consultaId))];
    const { rows: consultas } = await query('SELECT id, colunas FROM consultas_painel WHERE id = ANY($1::int[])', [ids]);
    for (const v of d.visuais) {
      const c = consultas.find((x) => x.id === v.consultaId);
      if (!c) return reply.code(400).send({ erro: `"${v.titulo}": consulta não encontrada.` });
      const problema = conferirColunas(v, c.colunas);
      if (problema) return reply.code(400).send({ erro: problema });
    }
    const filtrosIds = [...new Set(d.filtros)];
    if ((await carregarFiltros(filtrosIds)).length !== filtrosIds.length) return reply.code(400).send({ erro: 'Filtro não encontrado.' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM painel_filtros WHERE painel_id = $1', [id]);
      await client.query('DELETE FROM painel_visuais WHERE painel_id = $1', [id]);
      if (filtrosIds.length) {
        await client.query(
          `INSERT INTO painel_filtros (painel_id, filtro_id, ordem)
           SELECT $1, f, o FROM unnest($2::int[]) WITH ORDINALITY AS t(f, o)`,
          [id, filtrosIds],
        );
      }
      for (const v of d.visuais) {
        await client.query(
          'INSERT INTO painel_visuais (painel_id, tipo, titulo, consulta_id, config, layout) VALUES ($1, $2, $3, $4, $5, $6)',
          [id, v.tipo, v.titulo, v.consultaId, JSON.stringify(v.config), JSON.stringify(v.layout)],
        );
      }
      await client.query('UPDATE paineis SET fundo_claro = $2, fundo_escuro = $3, atualizado_em = NOW() WHERE id = $1', [id, d.fundoClaro, d.fundoEscuro]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
    await registrarAuditoria({
      usuarioId: request.user.sub,
      acao: 'painel_montado',
      entidade: 'paineis',
      detalhes: { id, nome: existe[0].nome, visuais: d.visuais.length, filtros: filtrosIds.length },
      ip: request.ip,
    });
    return { ok: true };
  });

  /** Opções e valores iniciais de filtros escolhidos no montador (antes de salvar). */
  app.post('/montagem/filtros', { preHandler: somenteAdmin }, async (request, reply) => {
    const d = validar(z.object({ ids: z.array(z.number().int().positive()).max(12) }), request.body, reply);
    if (!d) return;
    const filtros = await carregarFiltros(d.ids);
    const ordem = new Map(d.ids.map((x, i) => [x, i]));
    filtros.sort((a, b) => ordem.get(a.id)! - ordem.get(b.id)!);
    return filtrosComOpcoes(filtros);
  });

  /** Calcula um visual ainda não salvo (pré-visualização no montador). */
  app.post('/montagem/previa', { preHandler: somenteAdmin }, async (request, reply) => {
    const d = validar(previaSchema, request.body, reply);
    if (!d) return;
    const semPermissao = await conferirExpressoes(request.user.perfil, d.painelId, [d.visual.config]);
    if (semPermissao) return reply.code(403).send({ erro: semPermissao });
    const { rows } = await query('SELECT id, sql FROM consultas_painel WHERE id = $1', [d.visual.consultaId]);
    if (!rows[0]) return reply.code(400).send({ erro: 'Consulta não encontrada.' });
    const filtros = d.filtrosIds.length ? await carregarFiltros(d.filtrosIds) : [];
    const [r] = await calcular(
      [{ id: 'previa', tipo: d.visual.tipo, titulo: d.visual.titulo, consulta_id: rows[0].id, config: d.visual.config, layout: d.visual.layout, sql: rows[0].sql }],
      filtros,
      {},
    );
    return r;
  });
}
