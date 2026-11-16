import type pg from 'pg';
import Cursor from 'pg-cursor';
import { poolBiDados } from '../db/biDados.js';
import { paraPostgres, parametrosUsados, type ValorParametro } from '../lib/sqlParametros.js';
import { gravarCache, lerCache, type ResultadoConsulta } from './cache.js';
import { mapaDeParametros } from './filtros.js';

export const LIMITE_LINHAS_CONSULTA = 20_000;
const TEMPO_MAXIMO_MS = 60_000;

type TipoColuna = ResultadoConsulta['colunas'][number]['tipo'];

const OID_NUMERO = new Set([20, 21, 23, 26, 700, 701, 1700, 790]);
const OID_DATA = new Set([1082, 1114, 1184]);
export const tipoDoOid = (oid: number): TipoColuna => (OID_NUMERO.has(oid) ? 'numero' : OID_DATA.has(oid) ? 'data' : 'texto');

/**
 * Números chegam como número; datas chegam como texto (AAAA-MM-DD ou AAAA-MM-DD HH:MM:SS),
 * sem conversão de fuso, para o gráfico mostrar exatamente o que está no banco.
 */
export const tiposPg = {
  getTypeParser(oid: number) {
    if (OID_NUMERO.has(oid)) return (v: string) => (v === null ? null : Number(v));
    if (oid === 1082) return (v: string) => v;
    if (oid === 1114 || oid === 1184) return (v: string) => (v === null ? null : v.slice(0, 19).replace('T', ' '));
    if (oid === 16) return (v: string) => v === 't';
    return (v: string) => v;
  },
};

/** Remove o ";" final, que impediria rodar a consulta dentro de outra. */
export const limparSql = (sql: string) => sql.trim().replace(/;\s*$/, '');

/**
 * Valores para TODOS os @parâmetros da consulta:
 * os escolhidos nos filtros do painel e NULL (= todos) para os que o painel não tem.
 */
export async function valoresDaConsulta(sql: string, escolhidos: Record<string, ValorParametro>) {
  const mapa = await mapaDeParametros();
  const porNome = new Map(Object.entries(escolhidos).map(([k, v]) => [k.toLowerCase(), v]));
  const valores: Record<string, ValorParametro> = {};
  for (const nome of parametrosUsados(sql, 'pg')) {
    const chave = nome.toLowerCase();
    const def = mapa.get(chave);
    if (!def) {
      throw new Error(`O parâmetro @${nome} não corresponde a nenhum filtro cadastrado. Cadastre o filtro ou corrija o nome.`);
    }
    valores[nome] = porNome.get(chave) ?? { tipo: 'texto', valor: null, pgTipo: def.pgTipo };
  }
  return valores;
}

export async function comLeitura<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await poolBiDados.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query(`SET LOCAL statement_timeout = ${TEMPO_MAXIMO_MS}`);
    return await fn(client);
  } catch (e) {
    const pgErro = e as { code?: string; message?: string };
    if (pgErro.code === '57014') throw new Error(`A consulta passou de ${TEMPO_MAXIMO_MS / 1000} s e foi interrompida.`);
    throw e;
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
  }
}

/** Colunas que a consulta retorna, sem trazer dados (todos os parâmetros como NULL). */
export async function descreverConsulta(sql: string) {
  const valores = await valoresDaConsulta(sql, {});
  const { texto, params } = paraPostgres(`SELECT * FROM (${limparSql(sql)}) AS consulta LIMIT 0`, valores);
  const r = await comLeitura((c) => c.query({ text: texto, values: params }));
  const nomes = r.fields.map((f) => f.name);
  const repetida = nomes.find((n, i) => nomes.indexOf(n) !== i);
  if (repetida) throw new Error(`A coluna "${repetida}" aparece mais de uma vez. Use apelidos diferentes (AS).`);
  if (!nomes.length) throw new Error('A consulta não retorna nenhuma coluna.');
  return r.fields.map((f) => ({ nome: f.name, tipo: tipoDoOid(f.dataTypeID) }));
}

/** Executa uma consulta de painel, com cache por consulta + valores dos filtros. */
export async function executarConsulta(
  consulta: { id: number | null; sql: string },
  escolhidos: Record<string, ValorParametro>,
  limite = LIMITE_LINHAS_CONSULTA,
): Promise<ResultadoConsulta> {
  const valores = await valoresDaConsulta(consulta.sql, escolhidos);
  const chave = consulta.id
    ? `${consulta.id}|${limite}|${JSON.stringify(Object.entries(valores).map(([k, v]) => [k.toLowerCase(), v.valor]).sort())}`
    : null;
  if (chave) {
    const em = lerCache(chave);
    if (em) return em;
  }
  const { texto, params } = paraPostgres(limparSql(consulta.sql), valores);
  const resultado = await comLeitura(async (c) => {
    const cursor = c.query(new Cursor(texto, params, { types: tiposPg } as any));
    try {
      const { linhas, campos } = await new Promise<{ linhas: Record<string, unknown>[]; campos: pg.FieldDef[] }>((ok, falha) =>
        cursor.read(limite + 1, (err: Error | undefined, rows: Record<string, unknown>[], r: pg.QueryResult) =>
          err ? falha(err) : ok({ linhas: rows, campos: r?.fields ?? [] }),
        ),
      );
      return {
        colunas: campos.map((f) => ({ nome: f.name, tipo: tipoDoOid(f.dataTypeID) })),
        linhas: linhas.slice(0, limite),
        truncado: linhas.length > limite,
        geradoEm: new Date().toISOString(),
      };
    } finally {
      await cursor.close().catch(() => undefined);
    }
  });
  if (chave) gravarCache(chave, resultado);
  return resultado;
}
