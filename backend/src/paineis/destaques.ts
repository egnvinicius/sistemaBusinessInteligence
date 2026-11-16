import { z } from 'zod';

/* =========================================================
   Destaques da Tabela: regras do tipo
   "quando <coluna> <condição> <valor>, pintar <linha | célula | marcador>".
   ========================================================= */

const cor = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Cor inválida.');

export const CONDICOES = [
  'igual',
  'diferente',
  'maior',
  'maior_igual',
  'menor',
  'menor_igual',
  'contem',
  'nao_contem',
  'vazio',
  'nao_vazio',
] as const;

export const destaqueSchema = z.object({
  coluna: z.string().min(1).max(63),
  condicao: z.enum(CONDICOES),
  valor: z.string().trim().max(500).default(''),
  /** marcador = coluna de destaque no início da tabela; linha = linha inteira; celula = célula da colunaAlvo */
  alvo: z.enum(['marcador', 'linha', 'celula']).default('marcador'),
  colunaAlvo: z.string().max(63).nullable().default(null),
  corFundo: cor.nullable().default(null),
  corFonte: cor.nullable().default(null),
  piscar: z.boolean().default(false),
  /** Menor número vale primeiro quando várias regras pintam o mesmo lugar. */
  prioridade: z.number().int().min(0).max(99).default(0),
  /** Texto curto que explica o destaque (dica ao passar o mouse e leitor de tela). */
  legenda: z.string().trim().max(60).nullable().default(null),
});

export type Destaque = z.infer<typeof destaqueSchema>;

export interface Estilo {
  fundo?: string;
  fonte?: string;
  piscar?: boolean;
  legenda?: string;
}

export interface EstiloLinha {
  linha?: Estilo;
  marcador?: Estilo;
  /** índice da coluna exibida → estilo */
  celulas?: Record<number, Estilo>;
}

/* ---------- Comparação ---------- */

const DURACAO = /^(?:(\d+)\s*(?:d|days?|dias?)\s*)?(\d{1,3}):(\d{2})(?::(\d{2})(?:\.\d+)?)?h?$/i;
const NUMERO = /^-?\d+(?:[.,]\d+)?$/;

/**
 * Normaliza para comparar: números, durações ("07d 03:10", "01:00" → minutos),
 * datas ISO (comparadas como texto, que mantém a ordem) e textos.
 */
function normalizar(v: unknown): number | string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const s = String(v).trim();
  if (s === '') return null;
  const d = DURACAO.exec(s);
  if (d) return Number(d[1] ?? 0) * 1440 + Number(d[2]) * 60 + Number(d[3]) + Number(d[4] ?? 0) / 60;
  if (NUMERO.test(s)) return Number(s.replace(',', '.'));
  return s.toLocaleLowerCase('pt-BR');
}

const colecao = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });

export function atende(valorCelula: unknown, regra: Pick<Destaque, 'condicao' | 'valor'>): boolean {
  const a = normalizar(valorCelula);
  if (regra.condicao === 'vazio') return a === null;
  if (regra.condicao === 'nao_vazio') return a !== null;
  if (a === null) return false;
  const b = normalizar(regra.valor);
  if (regra.condicao === 'contem' || regra.condicao === 'nao_contem') {
    const tem = String(a).includes(String(b ?? ''));
    return regra.condicao === 'contem' ? tem : !tem;
  }
  if (b === null) return false;
  // Número com número compara como número; o resto, como texto (ordem natural)
  const cmp = typeof a === 'number' && typeof b === 'number' ? a - b : colecao.compare(String(a), String(b));
  switch (regra.condicao) {
    case 'igual':
      return cmp === 0;
    case 'diferente':
      return cmp !== 0;
    case 'maior':
      return cmp > 0;
    case 'maior_igual':
      return cmp >= 0;
    case 'menor':
      return cmp < 0;
    case 'menor_igual':
      return cmp <= 0;
  }
  return false;
}

/* ---------- Aplicação ---------- */

const estiloDa = (d: Destaque): Estilo => ({
  ...(d.corFundo ? { fundo: d.corFundo } : {}),
  ...(d.corFonte ? { fonte: d.corFonte } : {}),
  ...(d.piscar ? { piscar: true } : {}),
  ...(d.legenda ? { legenda: d.legenda } : {}),
});

/**
 * Estilos de cada linha. As regras são avaliadas sobre TODAS as colunas da consulta
 * (inclusive as que não aparecem na tabela). Em cada lugar vale a primeira regra que
 * atender, em ordem de prioridade (menor número primeiro).
 */
export function aplicarDestaques(linhas: Record<string, unknown>[], nomesExibidos: string[], regras: Destaque[]): (EstiloLinha | null)[] {
  if (!regras.length) return linhas.map(() => null);
  const ordenadas = regras.map((r, i) => ({ r, i })).sort((a, b) => a.r.prioridade - b.r.prioridade || a.i - b.i).map((x) => x.r);
  return linhas.map((l) => {
    const e: EstiloLinha = {};
    for (const r of ordenadas) {
      if (!atende(l[r.coluna], r)) continue;
      if (r.alvo === 'linha') e.linha ??= estiloDa(r);
      else if (r.alvo === 'marcador') e.marcador ??= estiloDa(r);
      else {
        const idx = nomesExibidos.indexOf(r.colunaAlvo ?? r.coluna);
        if (idx < 0) continue;
        e.celulas ??= {};
        e.celulas[idx] ??= estiloDa(r);
      }
    }
    return e.linha || e.marcador || e.celulas ? e : null;
  });
}

/* ---------- Filtros do visual ---------- */

export const filtroVisualSchema = z.object({
  coluna: z.string().min(1).max(63),
  condicao: z.enum(CONDICOES),
  valor: z.string().trim().max(500).default(''),
  /** Como esta condição se liga à PRÓXIMA: e / ou. "E" vale antes de "OU". */
  ligacao: z.enum(['e', 'ou']).default('e'),
});

export type FiltroVisual = z.infer<typeof filtroVisualSchema>;

/**
 * Mantém só as linhas que atendem os filtros do visual.
 * "E" vale antes de "OU": A e B ou C = (A e B) ou C.
 */
export function filtrarLinhas<T extends Record<string, unknown>>(linhas: T[], filtros: FiltroVisual[]): T[] {
  if (!filtros.length) return linhas;
  const grupos: FiltroVisual[][] = [[]];
  filtros.forEach((f, i) => {
    grupos.at(-1)!.push(f);
    if (f.ligacao === 'ou' && i < filtros.length - 1) grupos.push([]);
  });
  return linhas.filter((l) => grupos.some((g) => g.every((f) => atende(l[f.coluna], f))));
}
