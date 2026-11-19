import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { colunasDaTabela, normalizarTabela } from '../db/biDados.js';
import { pool, query } from '../db/pool.js';
import { somenteAdmin, somenteDesenvolvedor } from '../lib/auth.js';
import { registrarAuditoria } from '../lib/auditoria.js';
import { ehDuplicado, lerId, validar } from '../lib/http.js';
import { converterParametrosLegados, parametrosUsados, type ValorParametro } from '../lib/sqlParametros.js';
import { descreverConsulta, executarConsulta } from '../paineis/consultas.js';
import { invalidarCache } from '../paineis/cache.js';
import { carregarFiltros, opcoesDoFiltro, PADROES, parametrosDoFiltro, valoresParaParametros, type Filtro } from '../paineis/filtros.js';

/* =========================================================
   Catálogo usado na montagem dos painéis:
   consultas (SQL no bi_dados), filtros e listas.
   Escrever: só Desenvolvedor.  Ler: Gestor e Desenvolvedor (para montar painéis).
   ========================================================= */

const textoOpcional = (max: number) =>
  z.string().trim().max(max).nullable().default(null).transform((v) => v || null);

const consultaSchema = z.object({
  nome: z.string().trim().min(1, 'Informe o nome da consulta.').max(120),
  descricao: textoOpcional(255),
  sql: z.string().trim().min(1, 'Escreva o SELECT da consulta.').max(100_000),
});

const testeSchema = z.object({
  sql: z.string().trim().min(1, 'Escreva o SELECT da consulta.').max(100_000),
  filtros: z.record(z.string(), z.unknown()).default({}),
});

const PARAMETRO = /^[A-Za-z][A-Za-z0-9_]{0,40}$/;

const filtroSchema = z
  .object({
    nome: z.string().trim().min(1, 'Informe o nome do filtro.').max(80),
    parametro: z
      .string()
      .trim()
      .regex(PARAMETRO, 'O parâmetro começa com letra e aceita letras, números e _ (sem @ e sem espaços).')
      .transform((v) => v.toUpperCase()),
    tipo: z.enum(['periodo', 'ano', 'mes', 'lista', 'select'], { message: 'Escolha o tipo do filtro.' }),
    multiplo: z.boolean().default(true),
    tipoCodigo: z.enum(['texto', 'numero']).default('texto'),
    listaId: z.number().int().positive().nullable().default(null),
    selectTabela: textoOpcional(130),
    selectColunaCodigo: textoOpcional(63),
    selectColunaDescricao: textoOpcional(63),
    padrao: z.string().default('nenhum'),
    anoInicial: z.number().int().min(1950).max(2100).nullable().default(null),
  })
  .superRefine((f, ctx) => {
    if (!PADROES[f.tipo].includes(f.padrao)) ctx.addIssue({ code: 'custom', message: 'Valor inicial inválido para esse tipo de filtro.' });
    if (f.tipo === 'lista' && !f.listaId) ctx.addIssue({ code: 'custom', message: 'Escolha a lista do filtro.' });
    if (f.tipo === 'select' && (!f.selectTabela || !f.selectColunaCodigo || !f.selectColunaDescricao)) {
      ctx.addIssue({ code: 'custom', message: 'Informe a tabela e as colunas de código e descrição.' });
    }
    if (f.tipo === 'periodo' && /_(INI|FIM)$/.test(f.parametro)) {
      ctx.addIssue({ code: 'custom', message: 'No período, informe o parâmetro sem _INI/_FIM; eles são criados automaticamente.' });
    }
  });

const listaSchema = z.object({
  nome: z.string().trim().min(1, 'Informe o nome da lista.').max(80),
  itens: z
    .array(
      z.object({
        codigo: z.string().trim().min(1, 'Todo item precisa de código.').max(120),
        descricao: z.string().trim().min(1, 'Todo item precisa de descrição.').max(255),
      }),
    )
    .max(2000),
});

/* ---------- Respostas ---------- */

const consultaResposta = (r: any, completo = false) => ({
  id: r.id,
  nome: r.nome,
  descricao: r.descricao,
  colunas: r.colunas,
  parametros: parametrosUsados(r.sql, 'pg'),
  visuais: Number(r.visuais ?? 0),
  paineis: r.paineis ?? [],
  atualizadoEm: r.atualizado_em,
  ...(completo ? { sql: r.sql } : { resumoSql: String(r.sql).replace(/\s+/g, ' ').slice(0, 100) }),
});

const SQL_CONSULTAS = `
  SELECT c.*,
         (SELECT COUNT(*) FROM painel_visuais v WHERE v.consulta_id = c.id) AS visuais,
         COALESCE((SELECT json_agg(DISTINCT jsonb_build_object('id', p.id, 'nome', p.nome))
                     FROM painel_visuais v JOIN paineis p ON p.id = v.painel_id WHERE v.consulta_id = c.id), '[]') AS paineis
    FROM consultas_painel c`;

export const filtroResposta = (f: Filtro & { lista_nome?: string; paineis?: unknown }) => ({
  id: f.id,
  nome: f.nome,
  parametro: f.parametro,
  tipo: f.tipo,
  multiplo: f.multiplo,
  tipoCodigo: f.tipo_codigo,
  listaId: f.lista_id,
  listaNome: f.lista_nome ?? null,
  selectTabela: f.select_tabela,
  selectColunaCodigo: f.select_coluna_codigo,
  selectColunaDescricao: f.select_coluna_descricao,
  padrao: f.padrao,
  anoInicial: f.ano_inicial,
  parametrosSql: parametrosDoFiltro(f).map((p) => p.nome),
  paineis: f.paineis ?? [],
});

/** Mensagem amigável quando o SELECT de uma consulta falha. */
const erroSql = (e: unknown) => {
  const pg = e as { message?: string; position?: string };
  return pg.message ?? 'Erro ao executar a consulta.';
};

export async function rotasCatalogoPaineis(app: FastifyInstance) {
  const auditar = (request: any, acao: string, entidade: string, detalhes: Record<string, unknown>) =>
    registrarAuditoria({ usuarioId: request.user.sub, acao, entidade, detalhes, ip: request.ip });

  /* ================= Consultas ================= */

  app.get('/consultas', { preHandler: somenteAdmin }, async () => {
    const { rows } = await query(`${SQL_CONSULTAS} ORDER BY LOWER(c.nome)`);
    return rows.map((r) => consultaResposta(r));
  });

  app.get('/consultas/:id', { preHandler: somenteDesenvolvedor }, async (request, reply) => {
    const id = lerId(request.params, reply);
    if (!id) return;
    const { rows } = await query(`${SQL_CONSULTAS} WHERE c.id = $1`, [id]);
    if (!rows[0]) return reply.code(404).send({ erro: 'Consulta não encontrada.' });
    return consultaResposta(rows[0], true);
  });

  /** Executa um SELECT ainda não salvo, com os valores de filtro informados (ou os padrões). */
  app.post('/consultas/testar', { preHandler: somenteDesenvolvedor }, async (request, reply) => {
    const d = validar(testeSchema, request.body, reply);
    if (!d) return;
    const sql = converterParametrosLegados(d.sql).texto;
    try {
      const usados = parametrosUsados(sql, 'pg').map((p) => p.toLowerCase());
      const filtros = (await carregarFiltros()).filter((f) =>
        parametrosDoFiltro(f).some((p) => usados.includes(p.nome.toLowerCase())),
      );
      const valores = valoresParaParametros(filtros, d.filtros);
      const inicio = Date.now();
      const r = await executarConsulta({ id: null, sql }, valores, 500);
      return {
        ...r,
        duracaoMs: Date.now() - inicio,
        filtros: filtros.map((f) => ({ parametro: f.parametro, nome: f.nome, tipo: f.tipo })),
        valores: Object.fromEntries(Object.entries(valores).map(([k, v]) => [k, v.valor])),
      };
    } catch (e) {
      return reply.code(400).send({ erro: erroSql(e) });
    }
  });

  const salvarConsulta = async (request: any, reply: any, id: number | null) => {
    const d = validar(consultaSchema, request.body, reply);
    if (!d) return;
    const sql = converterParametrosLegados(d.sql).texto;
    let colunas;
    try {
      colunas = await descreverConsulta(sql);
    } catch (e) {
      return reply.code(400).send({ erro: erroSql(e) });
    }
    // Ao alterar, os visuais que já usam a consulta precisam continuar achando suas colunas
    if (id) {
      const { rows: vis } = await query('SELECT titulo, tipo, config FROM painel_visuais WHERE consulta_id = $1', [id]);
      const nomes = new Set(colunas.map((c) => c.nome));
      for (const v of vis) {
        const cfg = v.config ?? {};
        const usadas = [cfg.medida, cfg.meta, cfg.categoria, ...(cfg.medidas ?? []), ...(cfg.colunas ?? []), ...(cfg.destaques ?? []).flatMap((d: any) => [d.coluna, d.colunaAlvo]), ...(cfg.filtrosVisual ?? []).map((f: any) => f.coluna)].filter(Boolean);
        const falta = usadas.find((n: string) => !nomes.has(n));
        if (falta) {
          return reply.code(409).send({
            erro: `O visual "${v.titulo}" usa a coluna "${falta}", que a nova versão da consulta não retorna. Ajuste o visual ou mantenha a coluna.`,
          });
        }
      }
    }
    try {
      let novoId = id;
      if (id) {
        const { rowCount } = await query(
          `UPDATE consultas_painel SET nome = $2, descricao = $3, sql = $4, colunas = $5, atualizado_em = NOW() WHERE id = $1`,
          [id, d.nome, d.descricao, sql, JSON.stringify(colunas)],
        );
        if (!rowCount) return reply.code(404).send({ erro: 'Consulta não encontrada.' });
        invalidarCache(id);
      } else {
        const { rows } = await query(
          'INSERT INTO consultas_painel (nome, descricao, sql, colunas) VALUES ($1, $2, $3, $4) RETURNING id',
          [d.nome, d.descricao, sql, JSON.stringify(colunas)],
        );
        novoId = rows[0].id;
      }
      await auditar(request, id ? 'consulta_painel_alterada' : 'consulta_painel_criada', 'consultas_painel', { id: novoId, nome: d.nome });
      const { rows } = await query(`${SQL_CONSULTAS} WHERE c.id = $1`, [novoId]);
      return reply.code(id ? 200 : 201).send(consultaResposta(rows[0], true));
    } catch (e) {
      if (ehDuplicado(e)) return reply.code(409).send({ erro: 'Já existe uma consulta com esse nome.' });
      throw e;
    }
  };

  app.post('/consultas', { preHandler: somenteDesenvolvedor }, (request, reply) => salvarConsulta(request, reply, null));
  app.put('/consultas/:id', { preHandler: somenteDesenvolvedor }, (request, reply) => {
    const id = lerId(request.params, reply);
    if (!id) return;
    return salvarConsulta(request, reply, id);
  });

  app.delete('/consultas/:id', { preHandler: somenteDesenvolvedor }, async (request, reply) => {
    const id = lerId(request.params, reply);
    if (!id) return;
    const { rows: uso } = await query(
      'SELECT DISTINCT p.nome FROM painel_visuais v JOIN paineis p ON p.id = v.painel_id WHERE v.consulta_id = $1 ORDER BY 1',
      [id],
    );
    if (uso.length) {
      return reply.code(409).send({ erro: `Esta consulta é usada nos painéis: ${uso.map((u) => u.nome).join(', ')}. Tire os visuais que a usam antes de excluir.` });
    }
    const { rows: cubos } = await query('SELECT nome FROM cubos WHERE consulta_id = $1 ORDER BY nome', [id]);
    if (cubos.length) return reply.code(409).send({ erro: `Esta consulta é usada nos cubos: ${cubos.map((c) => c.nome).join(', ')}.` });
    const { rows } = await query('DELETE FROM consultas_painel WHERE id = $1 RETURNING nome', [id]);
    if (!rows[0]) return reply.code(404).send({ erro: 'Consulta não encontrada.' });
    invalidarCache(id);
    await auditar(request, 'consulta_painel_excluida', 'consultas_painel', { id, nome: rows[0].nome });
    return reply.code(204).send();
  });

  /* ================= Filtros ================= */

  const SQL_FILTROS = `
    SELECT f.*, l.nome AS lista_nome,
           COALESCE((SELECT json_agg(json_build_object('id', p.id, 'nome', p.nome) ORDER BY p.nome)
                       FROM painel_filtros pf JOIN paineis p ON p.id = pf.painel_id WHERE pf.filtro_id = f.id), '[]') AS paineis
      FROM filtros f LEFT JOIN listas l ON l.id = f.lista_id`;

  app.get('/filtros', { preHandler: somenteAdmin }, async () => {
    const { rows } = await query(`${SQL_FILTROS} ORDER BY LOWER(f.nome)`);
    return rows.map(filtroResposta);
  });

  /** Opções do filtro (para conferir o cadastro). */
  app.get('/filtros/:id/opcoes', { preHandler: somenteAdmin }, async (request, reply) => {
    const id = lerId(request.params, reply);
    if (!id) return;
    const [f] = await carregarFiltros([id]);
    if (!f) return reply.code(404).send({ erro: 'Filtro não encontrado.' });
    try {
      return { opcoes: await opcoesDoFiltro(f) };
    } catch (e) {
      return reply.code(400).send({ erro: erroSql(e) });
    }
  });

  const salvarFiltro = async (request: any, reply: any, id: number | null) => {
    const d = validar(filtroSchema, request.body, reply);
    if (!d) return;
    let tabela: string | null = null;
    if (d.tipo === 'select') {
      const t = normalizarTabela(d.selectTabela!);
      if (!t) return reply.code(400).send({ erro: 'Tabela inválida. Use "tabela" ou "schema.tabela".' });
      const cols = (await colunasDaTabela(t.schema, t.tabela)).map((c) => c.column_name);
      if (!cols.length) return reply.code(400).send({ erro: `A tabela ${t.completo} não existe no bi_dados.` });
      for (const c of [d.selectColunaCodigo!, d.selectColunaDescricao!]) {
        if (!cols.includes(c.toLowerCase())) return reply.code(400).send({ erro: `A coluna "${c}" não existe em ${t.completo}.` });
      }
      tabela = t.completo;
    }
    // Nenhum @parâmetro gerado pode colidir com o de outro filtro (ex.: período DATA gera DATA_INI)
    const gerados = parametrosDoFiltro({ parametro: d.parametro, tipo: d.tipo, multiplo: d.multiplo, tipo_codigo: d.tipoCodigo } as Filtro).map((p) => p.nome.toLowerCase());
    const outros = (await carregarFiltros()).filter((f) => f.id !== id);
    const colide = outros.find((f) => parametrosDoFiltro(f).some((p) => gerados.includes(p.nome.toLowerCase())));
    if (colide) return reply.code(409).send({ erro: `O filtro "${colide.nome}" já usa esse nome de parâmetro.` });

    const ehLista = d.tipo === 'lista' || d.tipo === 'select';
    const valores = [
      d.nome,
      d.parametro,
      d.tipo,
      ehLista ? d.multiplo : false,
      ehLista ? d.tipoCodigo : 'texto',
      d.tipo === 'lista' ? d.listaId : null,
      tabela,
      d.tipo === 'select' ? d.selectColunaCodigo!.toLowerCase() : null,
      d.tipo === 'select' ? d.selectColunaDescricao!.toLowerCase() : null,
      d.padrao,
      d.tipo === 'ano' ? d.anoInicial : null,
    ];
    try {
      let novoId = id;
      if (id) {
        const { rows: antes } = await query('SELECT parametro, tipo FROM filtros WHERE id = $1', [id]);
        if (!antes[0]) return reply.code(404).send({ erro: 'Filtro não encontrado.' });
        // Mudar parâmetro/tipo quebraria consultas que já o usam
        if (antes[0].parametro !== d.parametro || antes[0].tipo !== d.tipo) {
          const velhos = parametrosDoFiltro(antes[0] as Filtro).map((p) => p.nome.toLowerCase());
          const { rows: cons } = await query('SELECT nome, sql FROM consultas_painel');
          const quebra = cons.find((c) => parametrosUsados(c.sql, 'pg').some((p) => velhos.includes(p.toLowerCase())));
          if (quebra) {
            return reply.code(409).send({ erro: `A consulta "${quebra.nome}" usa o parâmetro deste filtro. Ajuste a consulta antes de mudar o parâmetro ou o tipo.` });
          }
        }
        await query(
          `UPDATE filtros SET nome = $2, parametro = $3, tipo = $4, multiplo = $5, tipo_codigo = $6, lista_id = $7,
                  select_tabela = $8, select_coluna_codigo = $9, select_coluna_descricao = $10, padrao = $11, ano_inicial = $12
            WHERE id = $1`,
          [id, ...valores],
        );
        invalidarCache();
      } else {
        const { rows } = await query(
          `INSERT INTO filtros (nome, parametro, tipo, multiplo, tipo_codigo, lista_id, select_tabela,
                                select_coluna_codigo, select_coluna_descricao, padrao, ano_inicial)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
          valores,
        );
        novoId = rows[0].id;
      }
      await auditar(request, id ? 'filtro_alterado' : 'filtro_criado', 'filtros', { id: novoId, nome: d.nome });
      const { rows } = await query(`${SQL_FILTROS} WHERE f.id = $1`, [novoId]);
      return reply.code(id ? 200 : 201).send(filtroResposta(rows[0]));
    } catch (e) {
      if (ehDuplicado(e)) return reply.code(409).send({ erro: 'Já existe um filtro com esse parâmetro.' });
      if ((e as any)?.code === '23503') return reply.code(400).send({ erro: 'Lista não encontrada.' });
      throw e;
    }
  };

  app.post('/filtros', { preHandler: somenteDesenvolvedor }, (request, reply) => salvarFiltro(request, reply, null));
  app.put('/filtros/:id', { preHandler: somenteDesenvolvedor }, (request, reply) => {
    const id = lerId(request.params, reply);
    if (!id) return;
    return salvarFiltro(request, reply, id);
  });

  app.delete('/filtros/:id', { preHandler: somenteDesenvolvedor }, async (request, reply) => {
    const id = lerId(request.params, reply);
    if (!id) return;
    const [f] = await carregarFiltros([id]);
    if (!f) return reply.code(404).send({ erro: 'Filtro não encontrado.' });
    const { rows: pain } = await query(
      'SELECT p.nome FROM painel_filtros pf JOIN paineis p ON p.id = pf.painel_id WHERE pf.filtro_id = $1 ORDER BY 1',
      [id],
    );
    if (pain.length) return reply.code(409).send({ erro: `Este filtro está nos painéis: ${pain.map((p) => p.nome).join(', ')}. Tire-o desses painéis antes de excluir.` });
    const meus = parametrosDoFiltro(f).map((p) => p.nome.toLowerCase());
    const { rows: cons } = await query('SELECT nome, sql FROM consultas_painel ORDER BY nome');
    const usam = cons.filter((c) => parametrosUsados(c.sql, 'pg').some((p) => meus.includes(p.toLowerCase())));
    if (usam.length) return reply.code(409).send({ erro: `O parâmetro deste filtro é usado nas consultas: ${usam.map((c) => c.nome).join(', ')}.` });
    await query('DELETE FROM filtros WHERE id = $1', [id]);
    await auditar(request, 'filtro_excluido', 'filtros', { id, nome: f.nome });
    return reply.code(204).send();
  });

  /* ================= Listas ================= */

  app.get('/listas', { preHandler: somenteAdmin }, async () => {
    const { rows } = await query(
      `SELECT l.id, l.nome,
              COALESCE((SELECT json_agg(json_build_object('codigo', i.codigo, 'descricao', i.descricao) ORDER BY i.ordem, i.id)
                          FROM lista_itens i WHERE i.lista_id = l.id), '[]') AS itens,
              COALESCE((SELECT json_agg(f.nome ORDER BY f.nome) FROM filtros f WHERE f.lista_id = l.id), '[]') AS filtros
         FROM listas l ORDER BY LOWER(l.nome)`,
    );
    return rows;
  });

  const salvarLista = async (request: any, reply: any, id: number | null) => {
    const d = validar(listaSchema, request.body, reply);
    if (!d) return;
    const codigos = d.itens.map((i) => i.codigo);
    const rep = codigos.find((c, i) => codigos.indexOf(c) !== i);
    if (rep) return reply.code(400).send({ erro: `O código "${rep}" aparece mais de uma vez.` });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      let novoId = id;
      if (id) {
        const { rowCount } = await client.query('UPDATE listas SET nome = $2 WHERE id = $1', [id, d.nome]);
        if (!rowCount) {
          await client.query('ROLLBACK');
          return reply.code(404).send({ erro: 'Lista não encontrada.' });
        }
        await client.query('DELETE FROM lista_itens WHERE lista_id = $1', [id]);
      } else {
        const { rows } = await client.query('INSERT INTO listas (nome) VALUES ($1) RETURNING id', [d.nome]);
        novoId = rows[0].id;
      }
      if (d.itens.length) {
        await client.query(
          `INSERT INTO lista_itens (lista_id, codigo, descricao, ordem)
           SELECT $1, i.codigo, i.descricao, i.ordem
             FROM unnest($2::text[], $3::text[]) WITH ORDINALITY AS i(codigo, descricao, ordem)`,
          [novoId, codigos, d.itens.map((i) => i.descricao)],
        );
      }
      await client.query('COMMIT');
      invalidarCache();
      await auditar(request, id ? 'lista_alterada' : 'lista_criada', 'listas', { id: novoId, nome: d.nome, itens: d.itens.length });
      return reply.code(id ? 200 : 201).send({ id: novoId, nome: d.nome, itens: d.itens });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (ehDuplicado(e)) return reply.code(409).send({ erro: 'Já existe uma lista com esse nome.' });
      throw e;
    } finally {
      client.release();
    }
  };

  app.post('/listas', { preHandler: somenteDesenvolvedor }, (request, reply) => salvarLista(request, reply, null));
  app.put('/listas/:id', { preHandler: somenteDesenvolvedor }, (request, reply) => {
    const id = lerId(request.params, reply);
    if (!id) return;
    return salvarLista(request, reply, id);
  });

  app.delete('/listas/:id', { preHandler: somenteDesenvolvedor }, async (request, reply) => {
    const id = lerId(request.params, reply);
    if (!id) return;
    const { rows: uso } = await query('SELECT nome FROM filtros WHERE lista_id = $1 ORDER BY nome', [id]);
    if (uso.length) return reply.code(409).send({ erro: `Esta lista é usada nos filtros: ${uso.map((u) => u.nome).join(', ')}.` });
    const { rows } = await query('DELETE FROM listas WHERE id = $1 RETURNING nome', [id]);
    if (!rows[0]) return reply.code(404).send({ erro: 'Lista não encontrada.' });
    await auditar(request, 'lista_excluida', 'listas', { id, nome: rows[0].nome });
    return reply.code(204).send();
  });
}

export type { ValorParametro };
