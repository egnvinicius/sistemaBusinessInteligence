import { CBadge } from '@coreui/react-pro';
import type { Agenda, Execucao, SituacaoExecucao } from '../types';

export const SITUACAO: Record<SituacaoExecucao, { rotulo: string; cor: string; texto?: string }> = {
  na_fila: { rotulo: 'Na fila', cor: 'info', texto: 'dark' },
  executando: { rotulo: 'Executando', cor: 'primary' },
  concluido: { rotulo: 'Concluído', cor: 'success' },
  concluido_com_erros: { rotulo: 'Concluído com erros', cor: 'warning', texto: 'dark' },
  erro: { rotulo: 'Erro', cor: 'danger' },
  cancelado: { rotulo: 'Cancelado', cor: 'secondary' },
  ignorado: { rotulo: 'Ignorado', cor: 'light', texto: 'dark' },
  nao_executada: { rotulo: 'Não executada', cor: 'danger' },
};

export function BadgeSituacao({ situacao }: { situacao: SituacaoExecucao }) {
  const s = SITUACAO[situacao];
  return (
    <CBadge color={s.cor} textColor={s.texto} className="badge-situacao">
      {s.rotulo}
    </CBadge>
  );
}

export const ORIGEM: Record<Execucao['origem'], string> = {
  agenda: 'Agenda',
  manual: 'Manual',
  recuperacao: 'Agenda (com atraso)',
};

export function duracao(inicio: string | null, fim: string | null) {
  if (!inicio) return '—';
  const ms = (fim ? new Date(fim) : new Date()).getTime() - new Date(inicio).getTime();
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${s % 60} s`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

export const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
export const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

/** Junta sequências: [1,2,3,4,5] → "Seg a Sex"; [7,8,9,12] → "07h a 09h, 12h". */
function faixas(valores: number[], nome: (v: number) => string, contiguo = (a: number, b: number) => b === a + 1) {
  if (!valores.length) return '';
  const ord = [...valores].sort((a, b) => a - b);
  const partes: string[] = [];
  let ini = ord[0];
  let ant = ord[0];
  for (const v of [...ord.slice(1), Number.NaN]) {
    if (!Number.isNaN(v) && contiguo(ant, v)) {
      ant = v;
      continue;
    }
    partes.push(ini === ant ? nome(ini) : ant === ini + 1 ? `${nome(ini)}, ${nome(ant)}` : `${nome(ini)} a ${nome(ant)}`);
    ini = v;
    ant = v;
  }
  return partes.join(', ');
}

const hh = (h: number) => `${String(h).padStart(2, '0')}h`;
const mm = (m: number) => String(m).padStart(2, '0');

/** Resumo legível de uma linha de agenda. */
export function resumoAgenda(a: Agenda) {
  const dias =
    a.repetirPor === 'semana'
      ? a.diasSemana.length === 0 || a.diasSemana.length === 7
        ? 'Todos os dias'
        : faixas(a.diasSemana, (d) => DIAS_SEMANA[d])
      : a.diasMes.length === 0
        ? 'Todos os dias'
        : `Dia ${faixas(a.diasMes, (d) => String(d))}`;
  const meses = a.meses.length && a.meses.length < 12 ? ` · ${faixas(a.meses, (m) => MESES[m - 1])}` : '';
  let horario: string;
  if (a.horas.length === 1 && a.minutos.length === 1) {
    horario = `${String(a.horas[0]).padStart(2, '0')}:${mm(a.minutos[0])}`;
  } else {
    const h = a.horas.length === 24 ? 'toda hora' : faixas(a.horas, hh);
    const m =
      a.minutos.length === 1
        ? `no minuto ${mm(a.minutos[0])}`
        : a.minutos.length === 12
          ? 'a cada 5 min'
          : `nos minutos ${a.minutos.map(mm).join(', ')}`;
    horario = `${h}, ${m}`;
  }
  return `${dias}${meses} · ${horario}`;
}
