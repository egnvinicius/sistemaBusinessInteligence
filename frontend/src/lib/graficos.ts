import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  DoughnutController,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PieController,
  PointElement,
  Tooltip,
} from 'chart.js';

Chart.register(
  BarController,
  BarElement,
  LineController,
  LineElement,
  PointElement,
  PieController,
  DoughnutController,
  ArcElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  Filler,
);

/* =========================================================
   Paleta dos gráficos (validada para daltonismo nos dois temas).
   A ordem das cores é fixa: a série 1 sempre recebe a cor 1.
   ========================================================= */

export interface PaletaGrafico {
  series: string[];
  superficie: string;
  texto: string;
  textoSecundario: string;
  grade: string;
  eixo: string;
}

const CLARO: PaletaGrafico = {
  series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
  superficie: '#ffffff',
  texto: '#1f2328',
  textoSecundario: '#5c636a',
  grade: 'rgba(31, 35, 40, 0.08)',
  eixo: 'rgba(31, 35, 40, 0.22)',
};

const ESCURO: PaletaGrafico = {
  series: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
  superficie: '#212631',
  texto: '#e8eaed',
  textoSecundario: '#a6abb3',
  grade: 'rgba(232, 234, 237, 0.08)',
  eixo: 'rgba(232, 234, 237, 0.24)',
};

export const paletaDoTema = (tema: string) => (tema === 'escuro' ? ESCURO : CLARO);

/* ---------- Formatação ---------- */

export type Formato = 'numero' | 'inteiro' | 'moeda' | 'percentual';

const fmt = {
  numero: new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }),
  inteiro: new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }),
  moeda: new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }),
  percentual: new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }),
};
const compacto = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumSignificantDigits: 3 });
const moedaInteira = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

/** Valor completo (tooltips, tabelas). */
export function formatar(v: number | null | undefined, formato: Formato = 'numero') {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  if (formato === 'percentual') return `${fmt.percentual.format(v)}%`;
  return fmt[formato].format(v);
}

/** Valor curto (eixos e números grandes dos indicadores). */
export function formatarCurto(v: number | null | undefined, formato: Formato = 'numero') {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  if (Math.abs(v) < 10_000) return formato === 'moeda' && Number.isInteger(v) ? moedaInteira.format(v) : formatar(v, formato);
  const c = compacto.format(v);
  if (formato === 'moeda') return `R$ ${c}`;
  if (formato === 'percentual') return `${c}%`;
  return c;
}

/** Rótulo legível para nomes de coluna (faturado_total → Faturado total). */
export const rotuloColuna = (n: string) => {
  const t = n.replace(/_/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** Categorias no formato AAAA-MM viram "jan/26"; datas AAAA-MM-DD viram "05/01/26". */
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export function rotuloCategoria(c: string) {
  let m = /^(\d{4})-(\d{2})$/.exec(c);
  if (m) return `${MESES[Number(m[2]) - 1] ?? m[2]}/${m[1].slice(2)}`;
  m = /^(\d{4})(\d{2})$/.exec(c);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return `${MESES[Number(m[2]) - 1]}/${m[1].slice(2)}`;
  m = /^(\d{4})-(\d{2})-(\d{2})( 00:00:00)?$/.exec(c);
  if (m) return `${m[3]}/${m[2]}/${m[1].slice(2)}`;
  return c;
}

export const NOMES_AGREGACAO: Record<string, string> = {
  soma: 'Soma',
  media: 'Média',
  minimo: 'Mínimo',
  maximo: 'Máximo',
  contagem: 'Contagem',
};

export const NOMES_FORMATO: Record<Formato, string> = {
  numero: 'Número',
  inteiro: 'Inteiro',
  moeda: 'Moeda (R$)',
  percentual: 'Percentual (%)',
};
