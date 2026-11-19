import { query } from '../db/pool.js';

export async function registrarAuditoria(dados: {
  usuarioId?: number | null;
  acao: string;
  entidade?: string;
  detalhes?: Record<string, unknown>;
  ip?: string;
}) {
  try {
    await query(
      'INSERT INTO auditoria (usuario_id, acao, entidade, detalhes, ip) VALUES ($1, $2, $3, $4, $5)',
      [dados.usuarioId ?? null, dados.acao, dados.entidade ?? null, dados.detalhes ?? null, dados.ip ?? null],
    );
  } catch {
    // A auditoria nunca deve derrubar a requisição principal
  }
}
