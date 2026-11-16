import { z } from 'zod';
import type { ResultadoConsulta } from './cache.js';
import { aplicarDestaques, destaqueSchema, filtrarLinhas, filtroVisualSchema } from './destaques.js';

/* =========================================================
   Definição dos visuais e cálculo dos dados de cada um
   ========================================================= */

const agregacao = z.enum(['soma', 'media', 'minimo', 'maximo', 'contagem']).default('soma');
const formato = z.enum(['numero', 'inteiro', 'moeda', 'percentual']).default('numero');
const coluna = z.string().min(1).max(63);
const cor = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Cor inválida.');
const corOpcional = cor.nullable().default(null);
const tamanho = (min: number, max: number) => z.number().int().min(min).max(max).nullable().default(null);

/** Aparência do título e filtros próprios do visual, comuns a todos os tipos. */
const titulo = {
  tituloCor: corOpcional,
  tituloTamanho: tamanho(10, 48),
  filtrosVisual: z.array(filtroVisualSchema).max(20).default([]),
};
/** Nome exibido e cor de cada série (barras e linhas): { coluna: valor } */
const series = {
  rotulos: z.record(coluna, z.string().trim().max(80)).default({}),
  cores: z.record(coluna, cor).default({}),
};

export const configPorTipo = {
  kpi: z.object({
    medida: coluna,
    agregacao,
    formato,
    meta: coluna.nullable().default(null),
    rotulo: z.string().max(80).nullable().default(null),
    ...titulo,
    valorCor: corOpcional,
    valorTamanho: tamanho(14, 160),
    rotuloCor: corOpcional,
    rotuloTamanho: tamanho(9, 48),
    /** Nome de um ícone CoreUI (cil…) ou "circulo" (bola colorida de situação) */
    icone: z.string().regex(/^(cil[A-Za-z0-9]+|circulo)$/, 'Ícone inválido.').nullable().default(null),
    /** Cor do ícone no tema claro e no escuro; com só uma informada, ela vale para os dois. */
    iconeCor: corOpcional,
    iconeCorEscuro: corOpcional,
    iconeTamanho: z.number().int().min(12).max(240).default(48),
  }),
  barra: z.object({
    categoria: coluna,
    medidas: z.array(coluna).min(1).max(8),
    agregacao,
    formato,
    horizontal: z.boolean().default(false),
    empilhado: z.boolean().default(false),
    ordenar: z.enum(['categoria', 'valor_desc', 'valor_asc']).default('categoria'),
    limite: z.number().int().min(1).max(100).nullable().default(null),
    ...titulo,
    ...series,
  }),
  linha: z.object({
    categoria: coluna,
    medidas: z.array(coluna).min(1).max(8),
    agregacao,
    formato,
    ...titulo,
    ...series,
  }),
  pizza: z.object({
    categoria: coluna,
    medida: coluna,
    agregacao,
    formato,
    rosca: z.boolean().default(true),
    limite: z.number().int().min(2).max(12).default(6),
    ...titulo,
  }),
  tabela: z.object({
    colunas: z.array(coluna).max(50).default([]),
    /** Nome exibido no cabeçalho de cada coluna: { coluna_no_banco: "Nome para o usuário" } */
    rotulos: z.record(coluna, z.string().trim().max(80)).default({}),
    destaques: z.array(destaqueSchema).max(30).default([]),
    formato,
    ...titulo,
  }),
} as const;

export type TipoVisual = keyof typeof configPorTipo;

export const layoutSchema = z.object({
  x: z.number().int().min(0).max(11),
  y: z.number().int().min(0).max(500),
  w: z.number().int().min(1).max(12),
  h: z.number().int().min(1).max(20),
});

export const visualSchema = z
  .object({
    tipo: z.enum(['kpi', 'barra', 'linha', 'pizza', 'tabela']),
    titulo: z.string().trim().min(1, 'Dê um título ao visual.').max(120),
    consultaId: z.number({ message: 'Escolha a consulta do visual.' }).int().positive(),
    config: z.record(z.string(), z.unknown()).default({}),
    layout: layoutSchema,
  })
  .transform((v, ctx) => {
    const r = configPorTipo[v.tipo].safeParse(v.config);
    if (!r.success) {
      const campo = String(r.error.issues[0].path[0] ?? '');
      ctx.addIssue({ code: 'custom', message: `"${v.titulo}": configure ${NOMES_CAMPOS[campo] ?? campo}.` });
      return z.NEVER;
    }
    return { ...v, config: r.data as Record<string, unknown> };
  });

const NOMES_CAMPOS: Record<string, string> = {
  medida: 'o valor',
  medidas: 'pelo menos um valor',
  categoria: 'a categoria',
  colunas: 'as colunas',
};

export type Visual = z.infer<typeof visualSchema>;

/** Confere se as colunas do visual existem na consulta e se os valores são numéricos. */
export function conferirColunas(v: Visual, colunas: { nome: string; tipo: string }[]): string | null {
  const c = v.config as any;
  const existe = (n: string) => colunas.find((x) => x.nome === n);
  const precisaNumero = (n: string, contagemOk: boolean) => {
    const col = existe(n);
    if (!col) return `a coluna "${n}" não existe na consulta`;
    if (col.tipo !== 'numero' && !(contagemOk && c.agregacao === 'contagem')) return `a coluna "${n}" não é numérica`;
    return null;
  };
  const problemas: (string | null)[] = [];
  if (v.tipo === 'kpi') {
    problemas.push(precisaNumero(c.medida, true));
    if (c.meta) problemas.push(precisaNumero(c.meta, false));
  } else if (v.tipo === 'barra' || v.tipo === 'linha') {
    if (!existe(c.categoria)) problemas.push(`a coluna "${c.categoria}" não existe na consulta`);
    for (const m of c.medidas) problemas.push(precisaNumero(m, true));
  } else if (v.tipo === 'pizza') {
    if (!existe(c.categoria)) problemas.push(`a coluna "${c.categoria}" não existe na consulta`);
    problemas.push(precisaNumero(c.medida, true));
  } else {
    for (const n of c.colunas) if (!existe(n)) problemas.push(`a coluna "${n}" não existe na consulta`);
    (c.destaques ?? []).forEach((d: any, i: number) => {
      if (!existe(d.coluna)) problemas.push(`o destaque ${i + 1} usa a coluna "${d.coluna}", que não existe na consulta`);
      if (d.alvo === 'celula') {
        const alvo = d.colunaAlvo ?? d.coluna;
        if (!existe(alvo)) problemas.push(`o destaque ${i + 1} pinta a coluna "${alvo}", que não existe na consulta`);
        else if (c.colunas.length && !c.colunas.includes(alvo)) problemas.push(`o destaque ${i + 1} pinta a coluna "${alvo}", que não está marcada para aparecer na tabela`);
      }
      if (!d.corFundo && !d.corFonte) problemas.push(`escolha uma cor para o destaque ${i + 1}`);
      if (!['vazio', 'nao_vazio'].includes(d.condicao) && !String(d.valor ?? '').trim()) problemas.push(`informe o valor do destaque ${i + 1}`);
    });
  }
  (c.filtrosVisual ?? []).forEach((f: any, i: number) => {
    if (!existe(f.coluna)) problemas.push(`o filtro ${i + 1} usa a coluna "${f.coluna}", que não existe na consulta`);
    else if (!['vazio', 'nao_vazio'].includes(f.condicao) && !String(f.valor ?? '').trim()) problemas.push(`informe o valor do filtro ${i + 1}`);
  });
  const p = problemas.find(Boolean);
  return p ? `"${v.titulo}": ${p}.` : null;
}

/* ---------- Cálculo ---------- */

function agregar(valores: unknown[], tipo: string): number | null {
  if (tipo === 'contagem') return valores.filter((v) => v !== null && v !== undefined).length;
  const nums = valores.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (!nums.length) return null;
  switch (tipo) {
    case 'media':
      return nums.reduce((a, b) => a + b, 0) / nums.length;
    case 'minimo':
      return Math.min(...nums);
    case 'maximo':
      return Math.max(...nums);
    default:
      return nums.reduce((a, b) => a + b, 0);
  }
}

const colecao = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });
const textoCategoria = (v: unknown) => (v === null || v === undefined || v === '' ? '(vazio)' : String(v));

/** Agrupa as linhas pela categoria, mantendo a ordem natural (números, datas e texto). */
function agrupar(linhas: Record<string, unknown>[], categoria: string) {
  const grupos = new Map<string, Record<string, unknown>[]>();
  for (const l of linhas) {
    const k = textoCategoria(l[categoria]);
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k)!.push(l);
  }
  return [...grupos.entries()].sort((a, b) => colecao.compare(a[0], b[0]));
}

export function calcularVisual(v: Visual, r: ResultadoConsulta) {
  const c = v.config as any;
  const L = filtrarLinhas(r.linhas, c.filtrosVisual ?? []);
  const aviso = r.truncado ? 'A consulta trouxe mais linhas do que o limite; o visual usa só uma parte delas.' : null;

  switch (v.tipo) {
    case 'kpi': {
      const valor = agregar(L.map((l) => l[c.medida]), c.agregacao);
      const meta = c.meta ? agregar(L.map((l) => l[c.meta]), c.agregacao === 'contagem' ? 'soma' : c.agregacao) : null;
      return { valor, meta, percentualMeta: meta ? (valor ?? 0) / meta * 100 : null, linhas: L.length, aviso };
    }
    case 'barra':
    case 'linha': {
      let grupos = agrupar(L, c.categoria).map(([cat, ls]) => ({
        cat,
        valores: (c.medidas as string[]).map((m) => agregar(ls.map((l) => l[m]), c.agregacao)),
      }));
      if (v.tipo === 'barra' && c.ordenar !== 'categoria') {
        const total = (g: (typeof grupos)[number]) => g.valores.reduce<number>((a, b) => a + (b ?? 0), 0);
        grupos.sort((a, b) => (c.ordenar === 'valor_desc' ? total(b) - total(a) : total(a) - total(b)));
      }
      const omitidas = v.tipo === 'barra' && c.limite && grupos.length > c.limite ? grupos.length - c.limite : 0;
      if (omitidas) grupos = grupos.slice(0, c.limite);
      return {
        categorias: grupos.map((g) => g.cat),
        series: (c.medidas as string[]).map((m, i) => ({ nome: m, valores: grupos.map((g) => g.valores[i]) })),
        omitidas,
        aviso,
      };
    }
    case 'pizza': {
      const grupos = agrupar(L, c.categoria)
        .map(([cat, ls]) => ({ cat, valor: agregar(ls.map((l) => l[c.medida]), c.agregacao) ?? 0 }))
        .filter((g) => g.valor > 0)
        .sort((a, b) => b.valor - a.valor);
      const principais = grupos.slice(0, c.limite - 1);
      const resto = grupos.slice(c.limite - 1);
      const fatias =
        resto.length > 1
          ? [...principais, { cat: 'Outros', valor: resto.reduce((a, b) => a + b.valor, 0) }]
          : grupos.slice(0, c.limite);
      return { fatias: fatias.map((f) => ({ nome: f.cat, valor: f.valor })), aviso };
    }
    case 'tabela': {
      const nomes: string[] = c.colunas.length ? c.colunas : r.colunas.map((x) => x.nome);
      const colunas = nomes.map((n) => r.colunas.find((x) => x.nome === n) ?? { nome: n, tipo: 'texto' as const });
      const visiveis = L.slice(0, 1000);
      const estilos = aplicarDestaques(visiveis, nomes, c.destaques ?? []);
      return {
        colunas,
        linhas: visiveis.map((l) => nomes.map((n) => l[n] ?? null)),
        estilos: estilos.some(Boolean) ? estilos : undefined,
        marcador: (c.destaques ?? []).some((d: any) => d.alvo === 'marcador'),
        total: L.length,
        aviso: L.length > 1000 ? 'Mostrando as primeiras 1.000 linhas.' : aviso,
      };
    }
  }
}
