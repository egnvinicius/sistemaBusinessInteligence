import { config } from '../config.js';

export interface AgendaRegra {
  id: number;
  tarefa_id: number;
  repetir_por: 'semana' | 'mes';
  dias_semana: number[];
  dias_mes: number[];
  meses: number[];
  horas: number[];
  minutos: number[];
  ativa: boolean;
}

export interface PartesData {
  diaSemana: number; // 0 = domingo
  dia: number;
  mes: number;
  hora: number;
  minuto: number;
}

const DIAS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const formatador = new Intl.DateTimeFormat('en-US', {
  timeZone: config.fusoAgenda,
  weekday: 'short',
  day: 'numeric',
  month: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  hourCycle: 'h23',
});

/** Dia da semana, dia, mês, hora e minuto no fuso das agendas. */
export function partesNoFuso(data: Date): PartesData {
  const p = Object.fromEntries(formatador.formatToParts(data).map((x) => [x.type, x.value]));
  return {
    diaSemana: DIAS[p.weekday],
    dia: Number(p.day),
    mes: Number(p.month),
    hora: Number(p.hour),
    minuto: Number(p.minute),
  };
}

/** Campo vazio = qualquer valor. Horas e minutos são obrigatórios na agenda. */
export function agendaCoincide(a: AgendaRegra, p: PartesData) {
  if (!a.ativa) return false;
  if (!a.minutos.includes(p.minuto) || !a.horas.includes(p.hora)) return false;
  if (a.meses.length && !a.meses.includes(p.mes)) return false;
  if (a.repetir_por === 'semana') return !a.dias_semana.length || a.dias_semana.includes(p.diaSemana);
  return !a.dias_mes.length || a.dias_mes.includes(p.dia);
}

export const inicioDoMinuto = (d: Date) => new Date(Math.floor(d.getTime() / 60_000) * 60_000);

/**
 * Próximo horário de cada tarefa, olhando até 35 dias à frente
 * (cobre agendas mensais). Os minutos da agenda andam de 5 em 5.
 */
export function proximasExecucoes(agendas: AgendaRegra[], a_partir: Date = new Date()): Map<number, Date> {
  const resultado = new Map<number, Date>();
  const ativas = agendas.filter((a) => a.ativa);
  if (!ativas.length) return resultado;
  const pendentes = new Set(ativas.map((a) => a.tarefa_id));
  let t = inicioDoMinuto(a_partir);
  t = new Date(t.getTime() + (5 - (partesNoFuso(t).minuto % 5)) * 60_000);
  const limite = a_partir.getTime() + 35 * 24 * 60 * 60_000;
  while (t.getTime() <= limite && pendentes.size) {
    const p = partesNoFuso(t);
    for (const a of ativas) {
      if (pendentes.has(a.tarefa_id) && agendaCoincide(a, p)) {
        resultado.set(a.tarefa_id, t);
        pendentes.delete(a.tarefa_id);
      }
    }
    t = new Date(t.getTime() + 5 * 60_000);
  }
  return resultado;
}
