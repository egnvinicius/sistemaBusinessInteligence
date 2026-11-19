import { config } from '../config.js';

/* =========================================================
   Até quando vale a sessão de um usuário:
   - "inatividade": X horas depois da última atividade;
   - "meia_noite": às 0h do dia seguinte, no fuso das agendas;
   - nenhum dos dois: não expira (renovada a cada uso, por até 1 ano parado).
   Vale o que vier primeiro.
   ========================================================= */

export interface PoliticaSessao {
  sessao_meia_noite: boolean;
  sessao_inatividade_horas: number | null;
}

export type MotivoExpiracao = 'meia_noite' | 'inatividade' | null;

const HORA = 3_600_000;
const SEM_EXPIRAR_MS = 365 * 24 * HORA;

/** Diferença (ms) entre a hora local no fuso e o UTC, no instante dado. */
function deslocamento(fuso: string, instante: Date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: fuso, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(instante)
      .map((x) => [x.type, x.value]),
  );
  const comoUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return comoUtc - Math.floor(instante.getTime() / 1000) * 1000;
}

/** Próxima meia-noite no fuso (o instante em que o dia vira). */
export function proximaMeiaNoite(fuso = config.fusoAgenda, agora = new Date()): Date {
  const local = new Date(agora.getTime() + deslocamento(fuso, agora));
  const alvo = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1, 0, 0, 0);
  // Duas passadas acertam também os dias de horário de verão
  let t = alvo - deslocamento(fuso, new Date(alvo));
  t = alvo - deslocamento(fuso, new Date(t));
  return new Date(t);
}

export function limiteDaSessao(u: PoliticaSessao, ultimaAtividade: Date, agora = new Date()): { expira: Date; motivo: MotivoExpiracao } {
  let expira = u.sessao_inatividade_horas ? new Date(ultimaAtividade.getTime() + u.sessao_inatividade_horas * HORA) : new Date(agora.getTime() + SEM_EXPIRAR_MS);
  let motivo: MotivoExpiracao = u.sessao_inatividade_horas ? 'inatividade' : null;
  if (u.sessao_meia_noite) {
    const m = proximaMeiaNoite(config.fusoAgenda, agora);
    if (m < expira) {
      expira = m;
      motivo = 'meia_noite';
    }
  }
  return { expira, motivo };
}

export const MENSAGEM_EXPIRACAO: Record<string, string> = {
  meia_noite: 'Sua sessão foi encerrada à meia-noite. Entre de novo para continuar.',
  inatividade: 'Sua sessão foi encerrada por inatividade. Entre de novo para continuar.',
};
