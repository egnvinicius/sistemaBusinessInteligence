import type { FiltroPainel } from '../../components/paineis/BarraFiltros';

/* Tipos e regras do modelo de uma análise com vários cubos (iguais aos do servidor). */

export interface Coluna {
  nome: string;
  tipo: 'numero' | 'texto' | 'data';
  descricao: string | null;
}

export interface CuboInfo {
  id: number;
  nome: string;
  descricao: string | null;
  colunas: Coluna[];
}

export type TipoFiltroTopo = 'periodo' | 'ano' | 'mes' | 'valores';

export interface FiltroTopo {
  id: string;
  nome: string;
  cuboId: number;
  coluna: string;
  tipo: TipoFiltroTopo;
  multiplo: boolean;
  padrao: string;
}

export interface Ponta {
  cuboId: number;
  coluna: string;
}

export interface LigacoesCfg {
  manuais: { a: Ponta; b: Ponta }[];
  desligadas: [number, number][];
}

export interface LigacaoTela {
  a: Ponta;
  b: Ponta;
  origem: 'auto' | 'manual';
  alternativas: string[];
  aNome?: string;
  bNome?: string;
}

export interface Modelo {
  cubos: CuboInfo[];
  ligacoes: LigacaoTela[];
  filtros: FiltroPainel[];
  iaDisponivel: boolean;
}

export const LIGACOES_VAZIAS: LigacoesCfg = { manuais: [], desligadas: [] };

/** Nome que o usuário conhece: a descrição cadastrada no cubo ou, sem ela, o nome no banco. */
export const rotulo = (c: Pick<Coluna, 'nome' | 'descricao'>) => c.descricao?.trim() || c.nome;

export const mesmoPar = (x: number, y: number, a: number, b: number) => (x === a && y === b) || (x === b && y === a);

/** Colunas de mesmo nome e tipo (sem datas) entre dois cubos: candidatas à ligação automática. */
export function colunasEmComum(a: CuboInfo, b: CuboInfo) {
  return a.colunas.filter((c) => c.tipo !== 'data' && b.colunas.some((d) => d.nome.toLowerCase() === c.nome.toLowerCase() && d.tipo === c.tipo)).map((c) => c.nome);
}

/** Cubos que um filtro alcança (o dele e os ligados a ele, direta ou indiretamente). */
export function alcance(cuboId: number, ligacoes: LigacaoTela[]): Set<number> {
  const vistos = new Set([cuboId]);
  const fila = [cuboId];
  while (fila.length) {
    const atual = fila.shift()!;
    for (const l of ligacoes) {
      const outro = l.a.cuboId === atual ? l.b.cuboId : l.b.cuboId === atual ? l.a.cuboId : null;
      if (outro !== null && !vistos.has(outro)) {
        vistos.add(outro);
        fila.push(outro);
      }
    }
  }
  return vistos;
}

export const NOME_TIPO_FILTRO: Record<TipoFiltroTopo, string> = {
  periodo: 'Período (de / até)',
  ano: 'Ano',
  mes: 'Mês',
  valores: 'Escolher valores',
};

export const PADROES: Record<TipoFiltroTopo, { valor: string; nome: string }[]> = {
  periodo: [
    { valor: 'nenhum', nome: 'Em branco (todos)' },
    { valor: 'mes_atual', nome: 'Mês atual' },
    { valor: 'mes_anterior', nome: 'Mês anterior' },
    { valor: 'ultimos_30', nome: 'Últimos 30 dias' },
    { valor: 'ultimos_90', nome: 'Últimos 90 dias' },
    { valor: 'ano_atual', nome: 'Ano atual' },
  ],
  ano: [
    { valor: 'nenhum', nome: 'Em branco (todos)' },
    { valor: 'atual', nome: 'Ano atual' },
  ],
  mes: [
    { valor: 'nenhum', nome: 'Em branco (todos)' },
    { valor: 'atual', nome: 'Mês atual' },
  ],
  valores: [{ valor: 'nenhum', nome: 'Em branco (todos)' }],
};

export const novoIdFiltro = () => `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
