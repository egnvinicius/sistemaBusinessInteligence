import { query } from '../db/pool.js';
import { converterValor, type TipoParametro, type ValorParametro } from '../lib/sqlParametros.js';
import { origemPara, type ConexaoConfig } from '../origens/tipos.js';

export interface DefinicaoParametro {
  id: number;
  agenda_id: number | null;
  nome: string;
  tipo: TipoParametro;
  modo: 'fixo' | 'expressao';
  valor: string;
}

/**
 * Definições que valem para uma execução: os valores padrão,
 * substituídos pelos da agenda que disparou a tarefa (quando houver).
 */
export async function definicoesEfetivas(tarefaId: number, agendaId: number | null) {
  const { rows } = await query<DefinicaoParametro>(
    'SELECT id, agenda_id, nome, tipo, modo, valor FROM tarefa_parametros WHERE tarefa_id = $1 ORDER BY id',
    [tarefaId],
  );
  const efetivas = new Map<string, DefinicaoParametro>();
  for (const d of rows.filter((r) => r.agenda_id === null)) efetivas.set(d.nome.toLowerCase(), d);
  if (agendaId) {
    for (const d of rows.filter((r) => r.agenda_id === agendaId)) efetivas.set(d.nome.toLowerCase(), d);
  }
  return [...efetivas.values()];
}

/**
 * Calcula o valor de cada parâmetro. Expressões rodam na conexão informada
 * (a da primeira ação da tarefa), como um SELECT de um único valor.
 */
export async function resolverParametros(
  definicoes: DefinicaoParametro[],
  conexao: ConexaoConfig | null,
): Promise<Record<string, ValorParametro>> {
  const valores: Record<string, ValorParametro> = {};
  for (const d of definicoes) {
    let bruto: unknown = d.valor;
    if (d.modo === 'expressao') {
      if (!conexao) throw new Error(`O parâmetro @${d.nome} é uma expressão, mas a tarefa não tem nenhuma ação com conexão para calculá-la.`);
      try {
        bruto = await origemPara(conexao.tipo).avaliar(conexao, d.valor, d.tipo);
      } catch (e) {
        if ((e as Error).name === 'ErroAcesso') throw e;
        throw new Error(`Erro ao calcular @${d.nome} (${d.valor}): ${(e as Error).message}`);
      }
    }
    try {
      valores[d.nome] = { tipo: d.tipo, valor: converterValor(d.tipo, bruto) };
    } catch (e) {
      throw new Error(`Valor inválido para @${d.nome}: ${(e as Error).message}`);
    }
  }
  return valores;
}
