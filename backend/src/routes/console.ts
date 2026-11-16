import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import type pg from 'pg';
import Cursor from 'pg-cursor';
import { z } from 'zod';
import { consoleComUsuarioRestrito, normalizarTabela, poolConsole } from '../db/biDados.js';
import { query } from '../db/pool.js';
import { somenteDesenvolvedor } from '../lib/auth.js';
import { validar } from '../lib/http.js';
import {
  codigoSemLiterais,
  contarComandos,
  converterValor,
  paraPostgres,
  parametrosUsados,
  tabelasAfetadas,
  tipoDoComando,
  tipoGeral,
  type TipoComando,
  type ValorParametro,
} from '../lib/sqlParametros.js';
import { carregarConexao } from '../etl/comum.js';
import { consultarSomenteLeitura } from '../origens/sqlserver.js';
import { invalidarCache } from '../paineis/cache.js';

/* =========================================================
   Console SQL (somente Desenvolvedor)
   - bi_dados: consultas e comandos, com transação opcional
   - conexões SQL Server: só SELECT, numa transação sempre desfeita
   Tudo fica no console_log, que só aceita inclusões.
   ========================================================= */

const LIMITE_LINHAS = 1000;
const OCIOSIDADE_MAX_MS = 10 * 60_000;
const TEMPO_ORIGEM_MS = 2 * 60_000;

interface Sessao {
  client: pg.PoolClient;
  transacaoId: string;
  iniciadaEm: Date;
  ultimoUso: Date;
  comandos: number;
  usuarioNome: string;
}

const sessoes = new Map<number, Sessao>();

type Evento = 'comando' | 'inicio' | 'commit' | 'rollback' | 'rollback_automatico';

async function registrar(dados: {
  usuarioId: number;
  usuarioNome: string;
  destino: string;
  conexaoId?: number | null;
  evento: Evento;
  transacaoId?: string | null;
  tipo?: TipoComando | null;
  comando?: string | null;
  linhas?: number | null;
  duracaoMs?: number | null;
  sucesso?: boolean;
  erro?: string | null;
  observacao?: string | null;
}) {
  await query(
    `INSERT INTO console_log (usuario_id, usuario_nome, destino, conexao_id, evento, transacao_id, tipo, comando,
                              linhas, duracao_ms, sucesso, erro, observacao)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      dados.usuarioId,
      dados.usuarioNome,
      dados.destino,
      dados.conexaoId ?? null,
      dados.evento,
      dados.transacaoId ?? null,
      dados.tipo ?? null,
      dados.comando ?? null,
      dados.linhas ?? null,
      dados.duracaoMs ?? null,
      dados.sucesso ?? true,
      dados.erro ?? null,
      dados.observacao ?? null,
    ],
  );
}

/** Desfaz e encerra a transação aberta de um usuário (sair, ociosidade, erro, logout). */
export async function encerrarSessaoConsole(usuarioId: number, evento: 'rollback' | 'rollback_automatico', observacao: string) {
  const s = sessoes.get(usuarioId);
  if (!s) return false;
  sessoes.delete(usuarioId);
  await s.client.query('ROLLBACK').catch(() => undefined);
  s.client.release();
  await registrar({
    usuarioId,
    usuarioNome: s.usuarioNome,
    destino: 'bi_dados',
    evento,
    transacaoId: s.transacaoId,
    observacao,
  }).catch(() => undefined);
  return true;
}

// Transações paradas por mais de 10 minutos são desfeitas sozinhas (para não travar as tarefas)
setInterval(() => {
  const agora = Date.now();
  for (const [usuarioId, s] of sessoes) {
    if (agora - s.ultimoUso.getTime() > OCIOSIDADE_MAX_MS) {
      encerrarSessaoConsole(usuarioId, 'rollback_automatico', 'Desfeita após 10 minutos sem uso.').catch(() => undefined);
    }
  }
}, 30_000).unref();

/* ---------- Regras de segurança ---------- */

const CONTROLE_TRANSACAO = /^(BEGIN|START|COMMIT|ROLLBACK|END|ABORT|SAVEPOINT|RELEASE|PREPARE TRANSACTION)\b/;
const PROIBIDOS_BI_DADOS: [RegExp, string][] = [
  [/\b(CREATE|ALTER|DROP)\s+(ROLE|USER|GROUP|DATABASE|TABLESPACE|SUBSCRIPTION|SERVER|EXTENSION)\b/, 'Comandos sobre usuários, bancos e extensões não são permitidos no console.'],
  [/\bSET\s+(SESSION\s+|LOCAL\s+)?(ROLE|SESSION\s+AUTHORIZATION)\b|\bRESET\s+(ROLE|SESSION\s+AUTHORIZATION)\b/, 'Trocar o usuário da sessão não é permitido no console.'],
  [/\bCOPY\b[^;]*\b(PROGRAM|TO\s+'|FROM\s+')/, 'COPY de/para arquivos ou programas do servidor não é permitido no console.'],
];

const PROIBIDOS_ORIGEM =
  /\b(INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|CREATE|TRUNCATE|EXEC|EXECUTE|GRANT|REVOKE|DENY|INTO|BULK|OPENROWSET|OPENQUERY|OPENDATASOURCE|SHUTDOWN|KILL|DBCC|BACKUP|RESTORE|USE|SET|DECLARE|WAITFOR|RECONFIGURE)\b/;

function verificarBiDados(sql: string): string | null {
  const comandos = contarComandos(sql, 'pg');
  if (!comandos.length) return 'Escreva um comando para executar.';
  if (comandos.some((c) => CONTROLE_TRANSACAO.test(c))) {
    return 'Para controlar transações, use os botões "Iniciar transação", "Confirmar" e "Desfazer".';
  }
  const codigo = codigoSemLiterais(sql, 'pg');
  for (const [re, msg] of PROIBIDOS_BI_DADOS) if (re.test(codigo)) return msg;
  return null;
}

function verificarOrigem(sql: string): string | null {
  const comandos = contarComandos(sql, 'tsql');
  if (!comandos.length) return 'Escreva um comando para executar.';
  if (comandos.length > 1) return 'Nas conexões de origem, execute um único SELECT por vez.';
  if (!/^(SELECT|WITH)\b/.test(comandos[0])) return 'Nas conexões de origem, o console só executa consultas (SELECT).';
  const m = PROIBIDOS_ORIGEM.exec(comandos[0]);
  if (m) return `Nas conexões de origem, o console é somente leitura: "${m[1]}" não é permitido.`;
  return null;
}

/** Ações e consultas de painel que usam cada tabela que o comando apaga, esvazia ou altera. */
async function usosDasTabelas(sql: string) {
  const afetadas = tabelasAfetadas(sql);
  if (!afetadas.length) return [];
  const [{ rows: acoes }, { rows: consultas }] = await Promise.all([
    query<{ nome: string; tabela_destino: string }>('SELECT nome, tabela_destino FROM acoes'),
    query<{ nome: string; sql: string }>('SELECT nome, sql FROM consultas_painel'),
  ]);
  const usos: { tabela: string; comando: string; usadoPor: { tipo: string; nome: string }[] }[] = [];
  for (const a of afetadas) {
    const [schema, tabela] = a.tabela.split('.');
    const usadoPor: { tipo: string; nome: string }[] = [];
    for (const ac of acoes) {
      if (normalizarTabela(ac.tabela_destino)?.completo === a.tabela) usadoPor.push({ tipo: 'Ação', nome: ac.nome });
    }
    const re =
      schema === 'public'
        ? new RegExp(String.raw`(^|[^\w.])("?public"?\s*\.\s*)?"?${tabela}"?(?![\w])`, 'i')
        : new RegExp(String.raw`(^|[^\w.])"?${schema}"?\s*\.\s*"?${tabela}"?(?![\w])`, 'i');
    for (const cp of consultas) {
      if (re.test(codigoSemLiterais(cp.sql, 'pg').toLowerCase())) usadoPor.push({ tipo: 'Consulta de painel', nome: cp.nome });
    }
    if (usadoPor.length) usos.push({ tabela: a.tabela, comando: a.acao, usadoPor });
  }
  return usos;
}

/* ---------- Execução ---------- */

const executarSchema = z.object({
  destino: z.union([z.literal('bi_dados'), z.number().int().positive()]),
  sql: z.string().min(1, 'Escreva um comando para executar.').max(500_000),
  parametros: z
    .record(z.string(), z.object({ tipo: z.enum(['texto', 'numero', 'data']), valor: z.string().nullable() }))
    .optional(),
  confirmado: z.boolean().default(false),
});

interface Resultado {
  comando: string;
  tipo: TipoComando;
  linhasAfetadas: number | null;
  colunas: { nome: string; tipo: 'numero' | 'texto' | 'data' | 'outro' }[];
  linhas: unknown[][];
  truncado: boolean;
}

// OIDs do PostgreSQL para alinhar e formatar a grade
const OID_NUMERO = new Set([20, 21, 23, 26, 700, 701, 1700, 790]);
const OID_DATA = new Set([1082, 1083, 1114, 1184, 1266]);
const tipoDoOid = (oid: number) => (OID_NUMERO.has(oid) ? 'numero' : OID_DATA.has(oid) ? 'data' : oid === 25 || oid === 1043 || oid === 1042 ? 'texto' : 'outro');

function paraResultado(r: pg.QueryResult<any>): Resultado {
  const comando = (r.command ?? '').toUpperCase();
  const tipo = tipoDoComando(comando || 'OUTRO');
  const temLinhas = Array.isArray(r.fields) && r.fields.length > 0;
  return {
    comando,
    tipo,
    linhasAfetadas: tipo === 'consulta' ? null : (r.rowCount ?? null),
    colunas: temLinhas ? r.fields.map((f) => ({ nome: f.name, tipo: tipoDoOid(f.dataTypeID) as Resultado['colunas'][number]['tipo'] })) : [],
    linhas: temLinhas ? (r.rows as unknown[][]).slice(0, LIMITE_LINHAS) : [],
    truncado: temLinhas && r.rows.length > LIMITE_LINHAS,
  };
}

/** Um SELECT sozinho é lido por cursor, para não carregar milhões de linhas na memória. */
async function lerComCursor(client: pg.PoolClient, texto: string, params: unknown[]): Promise<Resultado> {
  const cursor = client.query(new Cursor(texto, params, { rowMode: 'array' }));
  try {
    const { linhas, campos } = await new Promise<{ linhas: unknown[][]; campos: pg.FieldDef[] }>((resolve, reject) =>
      cursor.read(LIMITE_LINHAS + 1, (err: Error | undefined, rows: unknown[][], result: pg.QueryResult) =>
        err ? reject(err) : resolve({ linhas: rows, campos: result?.fields ?? [] }),
      ),
    );
    return {
      comando: 'SELECT',
      tipo: 'consulta',
      linhasAfetadas: null,
      colunas: campos.map((f) => ({ nome: f.name, tipo: tipoDoOid(f.dataTypeID) as Resultado['colunas'][number]['tipo'] })),
      linhas: linhas.slice(0, LIMITE_LINHAS),
      truncado: linhas.length > LIMITE_LINHAS,
    };
  } finally {
    await cursor.close().catch(() => undefined);
  }
}

function converterParametros(nomes: string[], recebidos: Record<string, { tipo: 'texto' | 'numero' | 'data'; valor: string | null }> | undefined) {
  const valores: Record<string, ValorParametro> = {};
  const faltando: string[] = [];
  const porNome = new Map(Object.entries(recebidos ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  for (const nome of nomes) {
    const v = porNome.get(nome.toLowerCase());
    if (!v) {
      faltando.push(nome);
      continue;
    }
    valores[nome] = { tipo: v.tipo, valor: converterValor(v.tipo, v.valor) as ValorParametro['valor'] };
  }
  return { valores, faltando };
}

async function nomeDoUsuario(id: number) {
  const { rows } = await query<{ nome: string }>('SELECT nome FROM usuarios WHERE id = $1', [id]);
  return rows[0]?.nome ?? `#${id}`;
}

function estadoSessao(s: Sessao | undefined) {
  if (!s) return null;
  return {
    id: s.transacaoId,
    iniciadaEm: s.iniciadaEm,
    ultimoUso: s.ultimoUso,
    comandos: s.comandos,
    desfeitaAutomaticamenteEm: new Date(s.ultimoUso.getTime() + OCIOSIDADE_MAX_MS),
  };
}

export async function rotasConsole(app: FastifyInstance) {
  app.addHook('preHandler', somenteDesenvolvedor);

  app.get('/estado', async (request) => {
    const { rows: conexoes } = await query('SELECT id, nome, banco FROM conexoes WHERE ativo ORDER BY LOWER(nome)');
    return {
      transacao: estadoSessao(sessoes.get(request.user.sub)),
      usuarioRestrito: consoleComUsuarioRestrito(),
      limiteLinhas: LIMITE_LINHAS,
      conexoes,
    };
  });

  app.post('/executar', async (request, reply) => {
    const d = validar(executarSchema, request.body, reply);
    if (!d) return;
    const usuarioId = request.user.sub;
    const usuarioNome = await nomeDoUsuario(usuarioId);

    /* ---------- Conexão de origem (SQL Server): somente leitura ---------- */
    if (d.destino !== 'bi_dados') {
      const problema = verificarOrigem(d.sql);
      if (problema) return reply.code(400).send({ erro: problema });
      let conexao;
      try {
        conexao = await carregarConexao(d.destino);
      } catch (e) {
        return reply.code(400).send({ erro: (e as Error).message });
      }
      const nomes = parametrosUsados(d.sql, 'tsql');
      let conv;
      try {
        conv = converterParametros(nomes, d.parametros);
      } catch (e) {
        return reply.code(400).send({ erro: (e as Error).message });
      }
      if (conv.faltando.length) {
        return reply.code(400).send({ erro: 'Informe os valores dos parâmetros.', parametrosFaltando: conv.faltando });
      }
      const inicio = Date.now();
      try {
        const r = await consultarSomenteLeitura(conexao, d.sql, conv.valores, LIMITE_LINHAS, TEMPO_ORIGEM_MS);
        const duracao = Date.now() - inicio;
        await registrar({ usuarioId, usuarioNome, destino: conexao.nome, conexaoId: conexao.id, evento: 'comando', tipo: 'consulta', comando: d.sql, linhas: r.linhas.length, duracaoMs: duracao });
        return {
          duracaoMs: duracao,
          resultados: [
            {
              comando: 'SELECT',
              tipo: 'consulta',
              linhasAfetadas: null,
              colunas: r.colunas.map((c) => ({
                nome: c.nome,
                tipo: /int|decimal|numeric|money|float|real/i.test(c.tipo) ? 'numero' : /date|time/i.test(c.tipo) ? 'data' : 'texto',
              })),
              linhas: r.linhas,
              truncado: r.truncado,
            },
          ],
          transacao: null,
        };
      } catch (e) {
        const msg = (e as Error).message;
        await registrar({ usuarioId, usuarioNome, destino: conexao.nome, conexaoId: conexao.id, evento: 'comando', tipo: 'consulta', comando: d.sql, duracaoMs: Date.now() - inicio, sucesso: false, erro: msg });
        return reply.code(400).send({ erro: msg });
      }
    }

    /* ---------- bi_dados ---------- */
    const problema = verificarBiDados(d.sql);
    if (problema) return reply.code(400).send({ erro: problema });

    const nomes = parametrosUsados(d.sql, 'pg');
    let conv;
    try {
      conv = converterParametros(nomes, d.parametros);
    } catch (e) {
      return reply.code(400).send({ erro: (e as Error).message });
    }
    if (conv.faltando.length) {
      return reply.code(400).send({ erro: 'Informe os valores dos parâmetros.', parametrosFaltando: conv.faltando });
    }
    const comandos = contarComandos(d.sql, 'pg');
    if (nomes.length && comandos.length > 1) {
      return reply.code(400).send({ erro: 'Com @parâmetros, execute um comando por vez.' });
    }

    // Aviso (sem bloquear) quando o comando mexe numa tabela usada por ações ou painéis
    if (!d.confirmado) {
      const usos = await usosDasTabelas(d.sql);
      if (usos.length) return reply.code(409).send({ aviso: true, usos });
    }

    const sessao = sessoes.get(usuarioId);
    const client = sessao?.client ?? (await poolConsole.connect());
    const inicio = Date.now();
    let resultados: Resultado[];
    try {
      const { texto, params } = nomes.length ? paraPostgres(d.sql, conv.valores) : { texto: d.sql, params: [] as unknown[] };
      const consultaUnica = comandos.length === 1 && /^(SELECT|WITH|TABLE|VALUES)\b/.test(comandos[0]);
      if (consultaUnica) {
        // Dentro de uma transação já aberta, o cursor roda nela; fora, num bloco só de leitura
        if (!sessao) await client.query('BEGIN READ ONLY');
        try {
          resultados = [await lerComCursor(client, texto, params)];
        } finally {
          if (!sessao) await client.query('COMMIT').catch(() => undefined);
        }
      } else {
        const r = await client.query({ text: texto, values: params.length ? params : undefined, rowMode: 'array' });
        resultados = (Array.isArray(r) ? r : [r]).map(paraResultado);
      }
    } catch (e) {
      const msg = (e as Error).message;
      const duracao = Date.now() - inicio;
      await registrar({
        usuarioId,
        usuarioNome,
        destino: 'bi_dados',
        evento: 'comando',
        transacaoId: sessao?.transacaoId,
        tipo: tipoGeral(comandos.map((c) => tipoDoComando(c.split(' ')[0]))),
        comando: d.sql,
        duracaoMs: duracao,
        sucesso: false,
        erro: msg,
      });
      if (sessao) {
        // No PostgreSQL, uma transação com erro não aceita mais comandos: ela é desfeita
        await encerrarSessaoConsole(usuarioId, 'rollback', 'Desfeita porque um comando dentro dela deu erro.');
        return reply.code(400).send({
          erro: `${msg}. A transação foi desfeita: nada do que foi executado nela foi gravado.`,
          transacaoEncerrada: true,
        });
      }
      client.release();
      return reply.code(400).send({ erro: msg });
    }
    if (!sessao) client.release();

    const duracao = Date.now() - inicio;
    const tipo = tipoGeral(resultados.map((r) => r.tipo));
    const linhas =
      tipo === 'consulta'
        ? resultados.reduce((t, r) => t + r.linhas.length, 0)
        : resultados.reduce((t, r) => t + (r.linhasAfetadas ?? 0), 0);
    await registrar({ usuarioId, usuarioNome, destino: 'bi_dados', evento: 'comando', transacaoId: sessao?.transacaoId, tipo, comando: d.sql, linhas, duracaoMs: duracao });
    if (sessao) {
      sessao.ultimoUso = new Date();
      sessao.comandos++;
    } else if (tipo !== 'consulta') {
      invalidarCache();
    }
    return { duracaoMs: duracao, resultados, transacao: estadoSessao(sessao) };
  });

  /* ---------- Transação ---------- */
  app.post('/transacao/iniciar', async (request, reply) => {
    const usuarioId = request.user.sub;
    if (sessoes.has(usuarioId)) return reply.code(409).send({ erro: 'Você já tem uma transação aberta.' });
    const client = await poolConsole.connect();
    try {
      await client.query('BEGIN');
    } catch (e) {
      client.release();
      throw e;
    }
    const s: Sessao = {
      client,
      transacaoId: crypto.randomUUID(),
      iniciadaEm: new Date(),
      ultimoUso: new Date(),
      comandos: 0,
      usuarioNome: await nomeDoUsuario(usuarioId),
    };
    sessoes.set(usuarioId, s);
    await registrar({ usuarioId, usuarioNome: s.usuarioNome, destino: 'bi_dados', evento: 'inicio', transacaoId: s.transacaoId });
    return { transacao: estadoSessao(s) };
  });

  app.post('/transacao/confirmar', async (request, reply) => {
    const usuarioId = request.user.sub;
    const s = sessoes.get(usuarioId);
    if (!s) return reply.code(409).send({ erro: 'Não há transação aberta.' });
    sessoes.delete(usuarioId);
    try {
      await s.client.query('COMMIT');
    } catch (e) {
      await s.client.query('ROLLBACK').catch(() => undefined);
      s.client.release();
      await registrar({ usuarioId, usuarioNome: s.usuarioNome, destino: 'bi_dados', evento: 'rollback', transacaoId: s.transacaoId, observacao: `Falha ao confirmar: ${(e as Error).message}` });
      return reply.code(400).send({ erro: `Não foi possível confirmar: ${(e as Error).message}. Nada foi gravado.` });
    }
    s.client.release();
    await registrar({ usuarioId, usuarioNome: s.usuarioNome, destino: 'bi_dados', evento: 'commit', transacaoId: s.transacaoId, observacao: `${s.comandos} comando(s) confirmado(s).` });
    invalidarCache();
    return { ok: true, comandos: s.comandos };
  });

  app.post('/transacao/desfazer', async (request, reply) => {
    const ok = await encerrarSessaoConsole(request.user.sub, 'rollback', 'Desfeita pelo usuário.');
    if (!ok) return reply.code(409).send({ erro: 'Não há transação aberta.' });
    return { ok: true };
  });

  /** Chamado ao sair da tela do console (inclusive ao fechar o navegador). */
  app.post('/transacao/sair', async (request) => {
    const ok = await encerrarSessaoConsole(request.user.sub, 'rollback', 'Desfeita ao sair do console.');
    return { desfeita: ok };
  });

  /* ---------- Log ---------- */
  const logSchema = z.object({
    usuarioId: z.coerce.number().int().positive().optional(),
    tipo: z.enum(['consulta', 'insercao', 'alteracao', 'exclusao', 'estrutura', 'outro']).optional(),
    destino: z.string().max(80).optional(),
    de: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    texto: z.string().max(200).optional(),
    pagina: z.coerce.number().int().min(1).default(1),
  });

  app.get('/log', async (request, reply) => {
    const f = validar(logSchema, request.query, reply);
    if (!f) return;
    const where = [`l.evento = 'comando'`];
    const params: unknown[] = [];
    const add = (cond: string, v: unknown) => {
      params.push(v);
      where.push(cond.replace('?', `$${params.length}`));
    };
    if (f.usuarioId) add('l.usuario_id = ?', f.usuarioId);
    if (f.tipo) add('l.tipo = ?', f.tipo);
    if (f.destino) add('l.destino = ?', f.destino);
    if (f.de) add(`l.data_hora >= (?::date)::timestamp AT TIME ZONE 'America/Sao_Paulo'`, f.de);
    if (f.ate) add(`l.data_hora < ((?::date) + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo'`, f.ate);
    if (f.texto) add(`l.comando ILIKE '%' || ? || '%'`, f.texto);
    const porPagina = 50;
    params.push(porPagina + 1, (f.pagina - 1) * porPagina);
    const { rows } = await query(
      `SELECT l.*, fim.evento AS evento_fim
         FROM console_log l
         LEFT JOIN LATERAL (
           SELECT t.evento FROM console_log t
            WHERE t.transacao_id = l.transacao_id AND t.evento IN ('commit', 'rollback', 'rollback_automatico')
            ORDER BY t.id LIMIT 1) fim ON TRUE
        WHERE ${where.join(' AND ')}
        ORDER BY l.id DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    const itens = rows.slice(0, porPagina).map((r) => ({
      id: Number(r.id),
      dataHora: r.data_hora,
      usuario: r.usuario_nome,
      destino: r.destino,
      tipo: r.tipo,
      comando: r.comando,
      linhas: r.linhas === null ? null : Number(r.linhas),
      duracaoMs: r.duracao_ms,
      sucesso: r.sucesso,
      erro: r.erro,
      // Onde foi parar: só faz sentido para comandos que gravam
      gravacao: !r.sucesso
        ? null
        : r.tipo === 'consulta'
          ? null
          : !r.transacao_id
            ? 'direto'
            : r.evento_fim === 'commit'
              ? 'confirmada'
              : r.evento_fim
                ? 'desfeita'
                : 'pendente',
    }));
    const { rows: usuarios } = await query(
      `SELECT DISTINCT usuario_id AS id, usuario_nome AS nome FROM console_log WHERE usuario_id IS NOT NULL ORDER BY usuario_nome`,
    );
    const { rows: destinos } = await query(`SELECT DISTINCT destino FROM console_log ORDER BY destino`);
    return { itens, temMais: rows.length > porPagina, usuarios, destinos: destinos.map((x) => x.destino) };
  });
}
