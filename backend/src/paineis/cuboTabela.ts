import { aspas, colunasDaTabela, normalizarTabela } from '../db/biDados.js';
import type { ResultadoConsulta } from './cache.js';
import { gravarCache, lerCache } from './cache.js';
import { comLeitura, tiposPg } from './consultas.js';
import { condSql, type Cond } from './condicoes.js';
import { formulaSql, prepararCalculadas, type TipoValor } from './formulas.js';
import type { FiltroVisual } from './destaques.js';
import { calcularVisual, type Visual } from './visuais.js';

/* =========================================================
   Cubo a partir de uma AÇÃO: lê direto a tabela que a ação
   carrega no bi_dados. Como essas tabelas costumam ter os dados
   linha a linha (muitas linhas), os totais são calculados no banco:
   cada visual vira um SELECT com WHERE (filtros do visual) e GROUP BY.
   ========================================================= */

export type TipoColunaCubo = 'numero' | 'texto' | 'data';
export interface ColunaTabela {
  nome: string;
  tipo: TipoColunaCubo;
}

const NUMERICOS = new Set(['smallint', 'integer', 'bigint', 'numeric', 'real', 'double precision', 'decimal']);
const DATAS = new Set(['date', 'timestamp without time zone', 'timestamp with time zone']);
const tipoDaColuna = (dataType: string): TipoColunaCubo => (NUMERICOS.has(dataType) ? 'numero' : DATAS.has(dataType) ? 'data' : 'texto');

/** Colunas da tabela de destino de uma ação (vazio se a tabela ainda não foi criada). */
export async function colunasDaAcao(tabelaDestino: string): Promise<{ tabela: string | null; colunas: ColunaTabela[] }> {
  const t = normalizarTabela(tabelaDestino);
  if (!t) return { tabela: null, colunas: [] };
  const cols = await colunasDaTabela(t.schema, t.tabela);
  return { tabela: `${aspas(t.schema)}.${aspas(t.tabela)}`, colunas: cols.map((c) => ({ nome: c.column_name, tipo: tipoDaColuna(c.data_type) })) };
}

/* ---------- Filtros do visual → WHERE ---------- */

const ACENTOS = ['áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'];
const normalizarTexto = (expr: string) => `lower(translate(${expr}, '${ACENTOS[0]}', '${ACENTOS[1]}'))`;
const DURACAO = /^(?:(\d+)\s*(?:d|days?|dias?)\s*)?(\d{1,3}):(\d{2})(?::(\d{2}))?h?$/i;

function condicaoSql(f: FiltroVisual, col: ColunaTabela, p: (v: unknown) => string): string {
  const c = aspas(col.nome);
  const txt = `${c}::text`;
  if (f.condicao === 'vazio') return `(${c} IS NULL OR ${txt} = '')`;
  if (f.condicao === 'nao_vazio') return `(${c} IS NOT NULL AND ${txt} <> '')`;
  const valor = String(f.valor ?? '').trim();
  if (f.condicao === 'contem' || f.condicao === 'nao_contem') {
    const like = `${normalizarTexto(txt)} LIKE '%' || ${normalizarTexto(`${p(valor.replace(/[\\%_]/g, (m) => '\\' + m))}::text`)} || '%'`;
    return f.condicao === 'contem' ? `(${like})` : `(${c} IS NULL OR NOT (${like}))`;
  }
  const op = { igual: '=', diferente: '<>', maior: '>', maior_igual: '>=', menor: '<', menor_igual: '<=' }[f.condicao];
  if (col.tipo === 'numero') {
    const n = Number(valor.replace(',', '.'));
    if (!Number.isFinite(n)) throw new Error(`O filtro em "${col.nome}" espera um número, mas recebeu "${valor}".`);
    return `${c} ${op} ${p(n)}::numeric`;
  }
  if (col.tipo === 'data') {
    if (!/^\d{4}-\d{2}-\d{2}/.test(valor)) throw new Error(`O filtro em "${col.nome}" espera uma data no formato AAAA-MM-DD.`);
    return `${c} ${op} ${p(valor)}::timestamp`;
  }
  // Texto em formato de duração ("07d 03:10") compara como tempo
  if (DURACAO.test(valor)) {
    const d = DURACAO.exec(valor)!;
    const min = Number(d[1] ?? 0) * 1440 + Number(d[2]) * 60 + Number(d[3]);
    const emMin = `(CASE WHEN ${txt} ~* '^\\s*(\\d+\\s*d\\s*)?\\d{1,3}:\\d{2}' THEN
        COALESCE(NULLIF(substring(${txt} from '^\\s*(\\d+)\\s*d'), '')::int, 0) * 1440
      + substring(${txt} from '(\\d{1,3}):\\d{2}')::int * 60
      + substring(${txt} from '\\d{1,3}:(\\d{2})')::int END)`;
    return `${emMin} ${op} ${p(min)}::int`;
  }
  return `${normalizarTexto(txt)} ${op} ${normalizarTexto(`${p(valor)}::text`)}`;
}

/**
 * WHERE com os filtros do topo da análise (sempre "E") e os filtros do visual.
 * Nos do visual, "E" vale antes de "OU": A e B ou C = (A e B) ou C — igual aos painéis.
 */
function whereDosFiltros(filtros: FiltroVisual[], colunas: ColunaTabela[], p: (v: unknown) => string, extras: Cond[] = []) {
  const partes: string[] = extras.map((c) => {
    const col = colunas.find((x) => x.nome === c.coluna);
    if (!col) throw new Error(`A coluna "${c.coluna}" não existe na tabela.`);
    return condSql(c, col.tipo, aspas, p);
  });
  if (filtros.length) {
    const grupos: string[][] = [[]];
    filtros.forEach((f, i) => {
      const col = colunas.find((c) => c.nome === f.coluna);
      if (!col) throw new Error(`A coluna "${f.coluna}" não existe na tabela.`);
      grupos.at(-1)!.push(condicaoSql(f, col, p));
      if (f.ligacao === 'ou' && i < filtros.length - 1) grupos.push([]);
    });
    partes.push(`(${grupos.map((g) => `(${g.join(' AND ')})`).join(' OR ')})`);
  }
  return partes.length ? `WHERE ${partes.join(' AND ')}` : '';
}

/** Leitura rápida na tabela de um cubo de ação, com cache. */
async function lerTabela(sql: string, valores: unknown[], colunas: ColunaTabela[]) {
  const chave = `tabela|${sql}|${JSON.stringify(valores)}`;
  const em = lerCache(chave);
  if (em) return em;
  const r = await comLeitura(async (cliente) => {
    const q = await cliente.query({ text: sql, values: valores, types: tiposPg } as any);
    return {
      colunas: q.fields.map((f: { name: string }) => ({ nome: f.name, tipo: colunas.find((x) => x.nome === f.name)?.tipo ?? 'numero' })),
      linhas: q.rows,
      truncado: false,
      geradoEm: new Date().toISOString(),
    } as ResultadoConsulta;
  });
  gravarCache(chave, r);
  return r;
}

const parametros = () => {
  const valores: unknown[] = [];
  const p = (x: unknown) => {
    valores.push(x);
    return `$${valores.length}`;
  };
  return { valores, p };
};

/** Valores distintos de uma coluna, com condições (opções do filtro e chaves que atravessam uma ligação). */
export async function distintosDaTabela(tabela: string, colunas: ColunaTabela[], coluna: string, conds: Cond[], limite: number) {
  const col = colunas.find((x) => x.nome === coluna);
  if (!col) throw new Error(`A coluna "${coluna}" não existe na tabela.`);
  const { valores, p } = parametros();
  const where = whereDosFiltros([], colunas, p, conds);
  const sql = `SELECT DISTINCT ${aspas(coluna)} AS v FROM ${tabela} ${where ? `${where} AND` : 'WHERE'} ${aspas(coluna)} IS NOT NULL ORDER BY 1 LIMIT ${limite + 1}`;
  const r = await lerTabela(sql, valores, colunas);
  return r.linhas.map((l) => l.v);
}

/** Anos que existem numa coluna de data (opções do filtro de ano). */
export async function anosDaTabela(tabela: string, coluna: string) {
  const sql = `SELECT DISTINCT EXTRACT(YEAR FROM ${aspas(coluna)})::int AS v FROM ${tabela} WHERE ${aspas(coluna)} IS NOT NULL ORDER BY 1 DESC LIMIT 100`;
  const r = await lerTabela(sql, [], []);
  return r.linhas.map((l) => Number(l.v));
}

/* ---------- Visual → SELECT ---------- */

function agregacaoSql(agregacao: string, col: string) {
  const c = aspas(col);
  switch (agregacao) {
    case 'contagem':
      return `COUNT(${c})`;
    case 'media':
      return `AVG(${c})`;
    case 'minimo':
      return `MIN(${c})`;
    case 'maximo':
      return `MAX(${c})`;
    default:
      return `SUM(${c})`;
  }
}

const categoriaSql = (col: ColunaTabela) =>
  col.tipo === 'data' ? `to_char(${aspas(col.nome)}, 'YYYY-MM-DD')` : `${aspas(col.nome)}::text`;

const LIMITE_CATEGORIAS = 5000;
const LIMITE_TABELA = 1000;

/**
 * Calcula um visual de um cubo de ação. Os totais vêm prontos do banco;
 * o resultado passa pelo mesmo cálculo dos painéis (ordenação, "Outros", destaques),
 * que nessa hora só reagrupa linhas já agregadas.
 */
export async function calcularVisualDaTabela(tabela: string, colunasTabela: ColunaTabela[], v: Visual, extras: Cond[] = []) {
  const c = v.config as any;
  const { valores, p } = parametros();

  // Colunas calculadas: as por linha entram numa subconsulta (viram colunas comuns para
  // filtros, categorias e tabela); as agregadas viram a expressão da medida no SELECT
  const calc = prepararCalculadas(c.calculadas, colunasTabela);
  const porLinha = calc.filter((x) => !x.agregada);
  const agregadas = new Map(calc.filter((x) => x.agregada).map((x) => [x.nome, x]));
  const colunas: ColunaTabela[] = [...colunasTabela, ...porLinha.map((x) => ({ nome: x.nome, tipo: x.tipo as TipoColunaCubo }))];
  const tipoDe = (n: string) => (colunas.find((k) => k.nome === n)?.tipo ?? 'texto') as TipoValor;
  let fonte = tabela;
  if (porLinha.length) {
    const exprs = new Map<string, string>();
    const colLinha = (n: string) => exprs.get(n) ?? aspas(n);
    for (const x of porLinha) exprs.set(x.nome, `(${formulaSql(x.arvore, colLinha, p, tipoDe)})`);
    fonte = `(SELECT *, ${porLinha.map((x) => `${exprs.get(x.nome)} AS ${aspas(x.nome)}`).join(', ')} FROM ${tabela}) AS base`;
  }
  tabela = fonte;
  /** Expressão da medida: a fórmula agregada, ou a coluna com a agregação escolhida */
  const medidaSql = (m: string, agregacao: string) => {
    const x = agregadas.get(m);
    return x ? `(${formulaSql(x.arvore, aspas, p, tipoDe)})::float8` : agregacaoSql(agregacao, m);
  };

  const where = whereDosFiltros(c.filtrosVisual ?? [], colunas, p, extras);
  const col = (n: string) => {
    const x = colunas.find((k) => k.nome === n);
    if (!x) throw new Error(`A coluna "${n}" não existe na tabela.`);
    return x;
  };
  // A agregação já foi feita no banco: no reagrupamento, contagem vira soma das contagens
  const reagregar = c.agregacao === 'contagem' ? 'soma' : c.agregacao;

  let sql: string;
  let configCalculo: Record<string, unknown>;
  switch (v.tipo) {
    case 'kpi': {
      const partes = [`${medidaSql(c.medida, c.agregacao)} AS ${aspas(c.medida)}`];
      if (c.meta && c.meta !== c.medida) partes.push(`${medidaSql(c.meta, c.agregacao === 'contagem' ? 'soma' : c.agregacao)} AS ${aspas(c.meta)}`);
      sql = `SELECT ${partes.join(', ')} FROM ${tabela} ${where}`;
      configCalculo = { ...c, agregacao: reagregar, filtrosVisual: [], calculadas: [] };
      break;
    }
    case 'barra':
    case 'linha':
    case 'pizza': {
      const cat = col(c.categoria);
      const medidas: string[] = v.tipo === 'pizza' ? [c.medida] : c.medidas;
      const unicas = [...new Set(medidas)];
      sql = `SELECT ${categoriaSql(cat)} AS ${aspas(cat.nome)}, ${unicas.map((m) => `${medidaSql(m, c.agregacao)} AS ${aspas(m)}`).join(', ')}
               FROM ${tabela} ${where} GROUP BY 1 LIMIT ${LIMITE_CATEGORIAS + 1}`;
      configCalculo = { ...c, agregacao: reagregar, filtrosVisual: [], calculadas: [] };
      break;
    }
    default: {
      // Tabela: linhas de detalhe (sem agregar), com as colunas dos destaques também
      const exibidas: string[] = c.colunas?.length ? c.colunas : colunas.map((x) => x.nome);
      const colunasDestaque = (c.destaques ?? []).map((d: any) => d.coluna);
      const todas = [...new Set([...exibidas, ...colunasDestaque])].map((n) => col(n));
      sql = `SELECT ${todas.map((x) => aspas(x.nome)).join(', ')} FROM ${tabela} ${where} LIMIT ${LIMITE_TABELA + 1}`;
      configCalculo = { ...c, colunas: exibidas, filtrosVisual: [], calculadas: [] };
    }
  }

  const chave = `tabela|${sql}|${JSON.stringify(valores)}`;
  let r = lerCache(chave);
  if (!r) {
    r = await comLeitura(async (cliente) => {
      const q = await cliente.query({ text: sql, values: valores, types: tiposPg } as any);
      const limite = v.tipo === 'tabela' ? LIMITE_TABELA : LIMITE_CATEGORIAS;
      return {
        colunas: q.fields.map((f: { name: string }) => ({ nome: f.name, tipo: colunas.find((x) => x.nome === f.name)?.tipo ?? 'numero' })),
        linhas: q.rows.slice(0, limite),
        truncado: q.rows.length > limite,
        geradoEm: new Date().toISOString(),
      } as ResultadoConsulta;
    });
    gravarCache(chave, r);
  }
  const dados = calcularVisual({ ...v, config: configCalculo } as Visual, r);
  if (r.truncado && dados && 'aviso' in dados) {
    (dados as any).aviso =
      v.tipo === 'tabela' ? 'Mostrando as primeiras 1.000 linhas. Use filtros para ver o restante.' : 'Há categorias demais; só as primeiras 5.000 entraram no gráfico.';
  }
  return { dados, geradoEm: r.geradoEm };
}
