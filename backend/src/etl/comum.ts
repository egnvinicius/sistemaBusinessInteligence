import { query } from '../db/pool.js';
import { descriptografar } from '../lib/cripto.js';
import type { ConexaoConfig } from '../origens/tipos.js';

export async function carregarConexao(id: number): Promise<ConexaoConfig> {
  const { rows } = await query('SELECT * FROM conexoes WHERE id = $1', [id]);
  const r = rows[0];
  if (!r) throw new Error('Conexão não encontrada.');
  if (!r.ativo) throw new Error(`A conexão "${r.nome}" está inativa.`);
  return {
    id: r.id,
    nome: r.nome,
    tipo: r.tipo,
    host: r.host,
    porta: r.porta,
    banco: r.banco,
    usuario: r.usuario,
    senha: descriptografar(r.senha_criptografada),
    criptografar: r.criptografar,
    confiarCertificado: r.confiar_certificado,
    versao: new Date(r.atualizado_em).toISOString(),
  };
}

/** Tipo de coluna no PostgreSQL a partir do tipo informado pelo SQL Server. */
export function tipoPostgres(tipoOrigem: string): string {
  const t = tipoOrigem.toLowerCase().trim();
  const base = t.replace(/\(.*$/, '');
  const args = /\(([^)]*)\)/.exec(t)?.[1];
  switch (base) {
    case 'bigint':
      return 'bigint';
    case 'int':
      return 'integer';
    case 'smallint':
    case 'tinyint':
      return 'smallint';
    case 'bit':
      return 'boolean';
    case 'decimal':
    case 'numeric':
      return args ? `numeric(${args})` : 'numeric';
    case 'money':
      return 'numeric(19,4)';
    case 'smallmoney':
      return 'numeric(10,4)';
    case 'float':
      return 'double precision';
    case 'real':
      return 'real';
    case 'date':
      return 'date';
    case 'datetime':
    case 'datetime2':
    case 'smalldatetime':
      return 'timestamp';
    case 'datetimeoffset':
      return 'timestamptz';
    case 'time':
      return 'time';
    case 'uniqueidentifier':
      return 'uuid';
    case 'binary':
    case 'varbinary':
    case 'image':
    case 'timestamp':
    case 'rowversion':
      return 'bytea';
    default:
      return 'text';
  }
}

export const esperar = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });
