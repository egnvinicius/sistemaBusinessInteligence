/* =========================================================
   Condições dos filtros do topo das análises. Valem igual nos
   dois tipos de cubo: viram WHERE nas tabelas de ação e são
   testadas linha a linha nos cubos de consulta.
   ========================================================= */

export type Cond =
  | { coluna: string; tipo: 'periodo'; de: string | null; ate: string | null }
  | { coluna: string; tipo: 'ano'; valor: number }
  | { coluna: string; tipo: 'mes'; valor: number }
  /** Valores aceitos (lista do filtro ou chaves vindas de outro cubo pela ligação) */
  | { coluna: string; tipo: 'em'; valores: (string | number)[] };

type TipoCol = 'numero' | 'texto' | 'data';

/** Normaliza uma chave para comparar entre cubos: números sem zeros à toa, textos sem espaços e caixa. */
export function chave(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : null;
  if (typeof v === 'boolean') return v ? '1' : '0';
  const s = String(v).trim();
  if (s === '') return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) return String(Number(s));
  return s.toLocaleLowerCase('pt-BR');
}

const dataIso = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = v instanceof Date ? v.toISOString() : String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};

/** Testa uma linha (cubos de consulta). */
export function atendeCond(valor: unknown, c: Cond, conjunto?: Set<string>): boolean {
  if (c.tipo === 'em') {
    const k = chave(valor);
    return k !== null && (conjunto ?? new Set(c.valores.map(chave))).has(k);
  }
  const d = dataIso(valor);
  if (!d) return false;
  if (c.tipo === 'periodo') return (!c.de || d >= c.de) && (!c.ate || d <= c.ate);
  if (c.tipo === 'ano') return Number(d.slice(0, 4)) === c.valor;
  return Number(d.slice(5, 7)) === c.valor;
}

export function filtrarPorConds<T extends Record<string, unknown>>(linhas: T[], conds: Cond[]): T[] {
  if (!conds.length) return linhas;
  const conjuntos = conds.map((c) => (c.tipo === 'em' ? new Set(c.valores.map(chave).filter((x): x is string => x !== null)) : undefined));
  return linhas.filter((l) => conds.every((c, i) => atendeCond(l[c.coluna], c, conjuntos[i])));
}

/** Condição em SQL (cubos de ação). `aspas` protege o nome da coluna; `p` cria um parâmetro. */
export function condSql(c: Cond, tipoCol: TipoCol, aspas: (n: string) => string, p: (v: unknown) => string): string {
  const col = aspas(c.coluna);
  if (c.tipo === 'em') {
    const chaves = [...new Set(c.valores.map(chave).filter((x): x is string => x !== null))];
    if (!chaves.length) return 'FALSE';
    if (tipoCol === 'numero') {
      const nums = chaves.map(Number).filter(Number.isFinite);
      return nums.length ? `${col} = ANY(${p(nums)}::numeric[])` : 'FALSE';
    }
    return `lower(btrim(${col}::text)) = ANY(${p(chaves)}::text[])`;
  }
  if (tipoCol !== 'data') throw new Error(`O filtro de data não pode ser usado na coluna "${c.coluna}", que não é uma data.`);
  if (c.tipo === 'periodo') {
    const partes: string[] = [];
    if (c.de) partes.push(`${col} >= ${p(c.de)}::date`);
    // Até o fim do dia escolhido, também para colunas com hora
    if (c.ate) partes.push(`${col} < ${p(c.ate)}::date + 1`);
    return partes.length ? `(${partes.join(' AND ')})` : 'TRUE';
  }
  return `EXTRACT(${c.tipo === 'ano' ? 'YEAR' : 'MONTH'} FROM ${col}) = ${p(c.valor)}::int`;
}
