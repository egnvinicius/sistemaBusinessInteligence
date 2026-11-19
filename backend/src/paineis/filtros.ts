import { aspas, normalizarTabela, poolBiDados } from '../db/biDados.js';
import { query } from '../db/pool.js';
import { config } from '../config.js';
import type { ValorParametro } from '../lib/sqlParametros.js';

export type TipoFiltro = 'periodo' | 'ano' | 'mes' | 'lista' | 'select';

export interface Filtro {
  id: number;
  nome: string;
  parametro: string;
  tipo: TipoFiltro;
  multiplo: boolean;
  tipo_codigo: 'texto' | 'numero';
  lista_id: number | null;
  select_tabela: string | null;
  select_coluna_codigo: string | null;
  select_coluna_descricao: string | null;
  padrao: string;
  ano_inicial: number | null;
}

export const PADROES: Record<TipoFiltro, string[]> = {
  periodo: ['nenhum', 'mes_atual', 'mes_anterior', 'ultimos_30', 'ultimos_90', 'ano_atual'],
  ano: ['nenhum', 'atual'],
  mes: ['nenhum', 'atual'],
  lista: ['nenhum'],
  select: ['nenhum'],
};

export async function carregarFiltros(ids?: number[]): Promise<Filtro[]> {
  const { rows } = ids
    ? await query<Filtro>('SELECT * FROM filtros WHERE id = ANY($1::int[])', [ids])
    : await query<Filtro>('SELECT * FROM filtros ORDER BY LOWER(nome)');
  return rows;
}

/** Nomes dos @parâmetros que um filtro oferece ao SQL, com o tipo no PostgreSQL. */
export function parametrosDoFiltro(f: Filtro): { nome: string; pgTipo: string }[] {
  const base = f.parametro;
  switch (f.tipo) {
    case 'periodo':
      return [
        { nome: `${base}_INI`, pgTipo: 'date' },
        { nome: `${base}_FIM`, pgTipo: 'date' },
      ];
    case 'ano':
    case 'mes':
      return [{ nome: base, pgTipo: 'integer' }];
    default: {
      const t = f.tipo_codigo === 'numero' ? 'numeric' : 'text';
      return [{ nome: base, pgTipo: f.multiplo ? `${t}[]` : t }];
    }
  }
}

/** Todos os @parâmetros disponíveis para as consultas de painel (de todos os filtros cadastrados). */
export async function mapaDeParametros() {
  const mapa = new Map<string, { nome: string; pgTipo: string; filtro: Filtro }>();
  for (const f of await carregarFiltros()) {
    for (const p of parametrosDoFiltro(f)) mapa.set(p.nome.toLowerCase(), { ...p, filtro: f });
  }
  return mapa;
}

/* ---------- Datas no fuso das agendas ---------- */

function hojeNoFuso() {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: config.fusoAgenda, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date())
      .map((x) => [x.type, x.value]),
  );
  return { ano: Number(p.year), mes: Number(p.month), dia: Number(p.day) };
}

const iso = (a: number, m: number, d: number) => {
  const dt = new Date(Date.UTC(a, m - 1, d));
  return dt.toISOString().slice(0, 10);
};

/** Valor inicial de um filtro, conforme o padrão escolhido no cadastro. */
export function valorPadrao(f: Filtro): unknown {
  const h = hojeNoFuso();
  switch (f.tipo) {
    case 'periodo':
      switch (f.padrao) {
        case 'mes_atual':
          return { de: iso(h.ano, h.mes, 1), ate: iso(h.ano, h.mes + 1, 0) };
        case 'mes_anterior':
          return { de: iso(h.ano, h.mes - 1, 1), ate: iso(h.ano, h.mes, 0) };
        case 'ultimos_30':
          return { de: iso(h.ano, h.mes, h.dia - 29), ate: iso(h.ano, h.mes, h.dia) };
        case 'ultimos_90':
          return { de: iso(h.ano, h.mes, h.dia - 89), ate: iso(h.ano, h.mes, h.dia) };
        case 'ano_atual':
          return { de: iso(h.ano, 1, 1), ate: iso(h.ano, 12, 31) };
        default:
          return { de: null, ate: null };
      }
    case 'ano':
      return f.padrao === 'atual' ? h.ano : null;
    case 'mes':
      return f.padrao === 'atual' ? h.mes : null;
    default:
      return f.multiplo ? [] : null;
  }
}

/* ---------- Opções exibidas na barra de filtros ---------- */

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

export async function opcoesDoFiltro(f: Filtro): Promise<{ codigo: string | number; descricao: string }[] | null> {
  switch (f.tipo) {
    case 'periodo':
      return null;
    case 'ano': {
      const atual = hojeNoFuso().ano;
      const inicio = Math.min(f.ano_inicial ?? atual - 5, atual);
      return Array.from({ length: atual - inicio + 1 }, (_, i) => atual - i).map((a) => ({ codigo: a, descricao: String(a) }));
    }
    case 'mes':
      return MESES.map((m, i) => ({ codigo: i + 1, descricao: m }));
    case 'lista': {
      const { rows } = await query<{ codigo: string; descricao: string }>(
        'SELECT codigo, descricao FROM lista_itens WHERE lista_id = $1 ORDER BY ordem, descricao',
        [f.lista_id],
      );
      return rows;
    }
    case 'select': {
      const t = normalizarTabela(f.select_tabela ?? '');
      if (!t) throw new Error(`Tabela inválida no filtro ${f.nome}.`);
      const cod = aspas(f.select_coluna_codigo!.toLowerCase());
      const desc = aspas(f.select_coluna_descricao!.toLowerCase());
      const client = await poolBiDados.connect();
      try {
        await client.query('BEGIN READ ONLY');
        await client.query(`SET LOCAL statement_timeout = 20000`);
        const { rows } = await client.query(
          `SELECT DISTINCT ${cod}::text AS codigo, ${desc}::text AS descricao
             FROM ${aspas(t.schema)}.${aspas(t.tabela)}
            WHERE ${cod} IS NOT NULL
            ORDER BY 2 LIMIT 5000`,
        );
        return rows;
      } finally {
        await client.query('COMMIT').catch(() => undefined);
        client.release();
      }
    }
  }
}

/* ---------- Valores escolhidos → parâmetros do SQL ---------- */

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Converte o que o usuário escolheu na barra de filtros em valores tipados.
 * Filtro em branco (ou sem nada marcado) vira NULL, que nas consultas significa "todos".
 */
export function valoresParaParametros(filtros: Filtro[], escolhidos: Record<string, unknown>): Record<string, ValorParametro> {
  const valores: Record<string, ValorParametro> = {};
  const porParam = new Map(Object.entries(escolhidos ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  for (const f of filtros) {
    const bruto = porParam.has(f.parametro.toLowerCase()) ? porParam.get(f.parametro.toLowerCase()) : valorPadrao(f);
    const params = parametrosDoFiltro(f);
    if (f.tipo === 'periodo') {
      const v = (bruto ?? {}) as { de?: string | null; ate?: string | null };
      const de = typeof v.de === 'string' && DATA.test(v.de) ? v.de : null;
      const ate = typeof v.ate === 'string' && DATA.test(v.ate) ? v.ate : null;
      valores[params[0].nome] = { tipo: 'data', valor: de, pgTipo: 'date' };
      valores[params[1].nome] = { tipo: 'data', valor: ate, pgTipo: 'date' };
      continue;
    }
    const p = params[0];
    if (f.tipo === 'ano' || f.tipo === 'mes') {
      const n = Number(bruto);
      const valido = bruto !== null && bruto !== '' && Number.isInteger(n) && (f.tipo === 'ano' ? n > 1900 && n < 2200 : n >= 1 && n <= 12);
      valores[p.nome] = { tipo: 'numero', valor: valido ? n : null, pgTipo: p.pgTipo };
      continue;
    }
    // lista / select
    const lista = (Array.isArray(bruto) ? bruto : bruto === null || bruto === undefined || bruto === '' ? [] : [bruto])
      .slice(0, 1000)
      .map((x) => (f.tipo_codigo === 'numero' ? Number(x) : String(x)))
      .filter((x) => (typeof x === 'number' ? Number.isFinite(x) : x.length <= 200));
    const valor = !lista.length ? null : f.multiplo ? lista : lista[0];
    valores[p.nome] = { tipo: f.tipo_codigo === 'numero' ? 'numero' : 'texto', valor, pgTipo: p.pgTipo };
  }
  return valores;
}
