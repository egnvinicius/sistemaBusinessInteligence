export const CONDICOES: [string, string][] = [
  ['maior', 'maior que'],
  ['maior_igual', 'maior ou igual a'],
  ['menor', 'menor que'],
  ['menor_igual', 'menor ou igual a'],
  ['igual', 'igual a'],
  ['diferente', 'diferente de'],
  ['contem', 'contém'],
  ['nao_contem', 'não contém'],
  ['vazio', 'está vazio'],
  ['nao_vazio', 'não está vazio'],
];

export interface FiltroVisual {
  coluna: string;
  condicao: string;
  valor: string;
  ligacao: 'e' | 'ou';
}

export const NOME_CONDICAO = Object.fromEntries(CONDICOES);

/** Texto curto que explica os filtros do visual (dica no cabeçalho do visual). */
export function descreverFiltros(filtros: FiltroVisual[] | undefined, rotulos?: Record<string, string>) {
  if (!filtros?.length) return '';
  return filtros
    .map((f, i) => {
      const valor = /^\s*exec\s*=/i.test(f.valor) ? ' (expressão calculada)' : f.condicao === 'vazio' || f.condicao === 'nao_vazio' ? '' : ` ${f.valor}`;
      const parte = `${rotulos?.[f.coluna] || f.coluna} ${NOME_CONDICAO[f.condicao] ?? f.condicao}${valor}`;
      return i < filtros.length - 1 ? `${parte} ${f.ligacao === 'ou' ? 'OU' : 'E'}` : parte;
    })
    .join(' ');
}

