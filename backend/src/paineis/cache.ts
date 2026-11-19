/**
 * Cache dos resultados das consultas de painel (por consulta + valores dos filtros).
 * Esvaziado sempre que os dados do bi_dados podem ter mudado:
 * fim de uma execução de tarefa, gravação pelo Console SQL ou edição de uma consulta.
 */
const TTL_MS = 10 * 60_000;
const MAX_ITENS = 500;

interface Item {
  em: number;
  valor: ResultadoConsulta;
}

export interface ResultadoConsulta {
  colunas: { nome: string; tipo: 'numero' | 'texto' | 'data' }[];
  linhas: Record<string, unknown>[];
  truncado: boolean;
  geradoEm: string;
}

const itens = new Map<string, Item>();

export function lerCache(chave: string): ResultadoConsulta | null {
  const i = itens.get(chave);
  if (!i) return null;
  if (Date.now() - i.em > TTL_MS) {
    itens.delete(chave);
    return null;
  }
  return i.valor;
}

export function gravarCache(chave: string, valor: ResultadoConsulta) {
  if (itens.size >= MAX_ITENS) {
    const maisAntiga = itens.keys().next().value;
    if (maisAntiga) itens.delete(maisAntiga);
  }
  itens.set(chave, { em: Date.now(), valor });
}

export function invalidarCache(consultaId?: number) {
  if (consultaId === undefined) {
    itens.clear();
    return;
  }
  for (const k of itens.keys()) if (k.startsWith(`${consultaId}|`)) itens.delete(k);
}
