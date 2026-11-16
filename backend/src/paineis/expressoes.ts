import { poolBiDados } from '../db/biDados.js';
import { codigoSemLiterais } from '../lib/sqlParametros.js';

/* =========================================================
   Valores "exec=": uma expressão SQL avaliada no bi_dados
   (somente leitura) antes da comparação de um filtro ou destaque.
   Ex.: exec=to_char(current_date - 1, 'YYYY-MM-DD')
   ========================================================= */

const PREFIXO = /^\s*exec\s*=\s*/i;

export const ehExpressao = (valor: unknown): valor is string => typeof valor === 'string' && PREFIXO.test(valor);
export const textoDaExpressao = (valor: string) => valor.replace(PREFIXO, '').trim();

/** Confere a expressão sem executar: uma única expressão, sem ";". */
export function problemaNaExpressao(valor: string): string | null {
  const expr = textoDaExpressao(valor);
  if (!expr) return 'Escreva a expressão depois de "exec=".';
  if (expr.length > 500) return 'A expressão passou de 500 caracteres.';
  if (codigoSemLiterais(expr, 'pg').includes(';')) return 'A expressão do exec= não pode ter ";".';
  return null;
}

/** Todas as expressões exec= de uma configuração de visual (filtros e destaques). */
export function expressoesDoConfig(config: any): string[] {
  const valores = [...(config?.filtrosVisual ?? []), ...(config?.destaques ?? [])].map((x: any) => x?.valor);
  return [...new Set(valores.filter(ehExpressao).map(textoDaExpressao))];
}

/**
 * Avalia as expressões de uma vez, numa transação somente leitura com limite de 5 s.
 * Intervalos ("1 day 02:00:00") e datas voltam como texto, que a comparação entende.
 */
export async function avaliarExpressoes(expressoes: string[]): Promise<Map<string, string | null>> {
  const resultado = new Map<string, string | null>();
  if (!expressoes.length) return resultado;
  const client = await poolBiDados.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query('SET LOCAL statement_timeout = 5000');
    for (const expr of expressoes) {
      await client.query('SAVEPOINT expr');
      try {
        const { rows } = await client.query(`SELECT (${expr})::text AS v`);
        resultado.set(expr, rows[0]?.v ?? null);
      } catch (e) {
        await client.query('ROLLBACK TO SAVEPOINT expr');
        throw new Error(`A expressão "exec=${expr}" deu erro: ${(e as Error).message}`);
      }
    }
    return resultado;
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
  }
}

/** Troca cada valor exec= pelo resultado já avaliado. */
export function aplicarExpressoes(config: any, valores: Map<string, string | null>) {
  const troca = (x: any) => (ehExpressao(x?.valor) ? { ...x, valor: valores.get(textoDaExpressao(x.valor)) ?? '' } : x);
  return {
    ...config,
    ...(config?.filtrosVisual ? { filtrosVisual: config.filtrosVisual.map(troca) } : {}),
    ...(config?.destaques ? { destaques: config.destaques.map(troca) } : {}),
  };
}
