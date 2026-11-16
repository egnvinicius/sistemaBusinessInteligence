import { pool, query } from '../db/pool.js';
import { agendaCoincide, inicioDoMinuto, partesNoFuso, type AgendaRegra } from './agenda.js';
import { executarExecucao } from './executor.js';

const TRAVA_AGENDADOR = 727273;
const TRAVA_FILA = 727274;
const MAX_MINUTOS_RECUPERACAO = 7 * 24 * 60;

type Log = (m: string) => void;

const hhmm = (d: Date) => {
  const p = partesNoFuso(d);
  return `${String(p.dia).padStart(2, '0')}/${String(p.mes).padStart(2, '0')} ${String(p.hora).padStart(2, '0')}:${String(p.minuto).padStart(2, '0')}`;
};

/**
 * Coloca uma tarefa na fila. Se ela já estiver na fila ou rodando:
 * - disparo da agenda: registra "ignorado" no histórico;
 * - disparo manual: devolve a execução existente para a tela avisar.
 */
export async function enfileirar(opcoes: {
  tarefaId: number;
  agendaId?: number | null;
  origem: 'agenda' | 'manual' | 'recuperacao';
  agendadoPara?: Date | null;
  usuarioId?: number | null;
}): Promise<{ id: number; jaEmAndamento: boolean }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Serializa os enfileiramentos da mesma tarefa
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [TRAVA_FILA, opcoes.tarefaId]);
    const { rows: atual } = await client.query(
      `SELECT id FROM execucoes WHERE tarefa_id = $1 AND situacao IN ('na_fila', 'executando') LIMIT 1`,
      [opcoes.tarefaId],
    );
    if (atual[0]) {
      if (opcoes.origem !== 'manual') {
        const { rows } = await client.query(
          `INSERT INTO execucoes (tarefa_id, agenda_id, origem, situacao, agendado_para, mensagem, fim)
           VALUES ($1, $2, $3, 'ignorado', $4, $5, NOW()) RETURNING id`,
          [
            opcoes.tarefaId,
            opcoes.agendaId ?? null,
            opcoes.origem,
            opcoes.agendadoPara ?? null,
            `Ignorado: a execução anterior (#${atual[0].id}) ainda está em andamento.`,
          ],
        );
        await client.query('COMMIT');
        return { id: rows[0].id, jaEmAndamento: true };
      }
      await client.query('COMMIT');
      return { id: atual[0].id, jaEmAndamento: true };
    }
    const { rows } = await client.query(
      `INSERT INTO execucoes (tarefa_id, agenda_id, origem, situacao, agendado_para, solicitado_por)
       VALUES ($1, $2, $3, 'na_fila', $4, $5) RETURNING id`,
      [opcoes.tarefaId, opcoes.agendaId ?? null, opcoes.origem, opcoes.agendadoPara ?? null, opcoes.usuarioId ?? null],
    );
    await client.query('COMMIT');
    return { id: rows[0].id, jaEmAndamento: false };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Verifica as agendas minuto a minuto desde o último processamento.
 * Minutos perdidos (ferramenta fora do ar) dentro do prazo da tarefa são executados com atraso;
 * fora do prazo, viram um registro "não executada".
 */
export async function verificarAgendas(agora: Date = new Date(), log: Log = () => undefined) {
  const client = await pool.connect();
  try {
    const { rows: trava } = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [TRAVA_AGENDADOR]);
    if (!trava[0].ok) return; // outra instância está cuidando disso
    try {
      const atual = inicioDoMinuto(agora);
      const { rows: est } = await client.query('SELECT ultimo_tick FROM agendador_estado WHERE id = 1');
      const ultimo: Date | null = est[0]?.ultimo_tick ? new Date(est[0].ultimo_tick) : null;
      if (ultimo && ultimo.getTime() >= atual.getTime()) return;

      const { rows: agendas } = await client.query<AgendaRegra & { janela_tentativas_min: number }>(
        `SELECT a.*, t.janela_tentativas_min FROM agendas a JOIN tarefas t ON t.id = a.tarefa_id
          WHERE a.ativa AND t.ativa`,
      );

      // Minutos a verificar: o atual, ou todos desde o último processamento (limitado a 7 dias)
      let inicio = ultimo ? new Date(ultimo.getTime() + 60_000) : atual;
      const maisAntigo = atual.getTime() - MAX_MINUTOS_RECUPERACAO * 60_000;
      if (inicio.getTime() < maisAntigo) inicio = new Date(maisAntigo);
      const houveQueda = !!ultimo && atual.getTime() - ultimo.getTime() > 2 * 60_000;

      const perdidas = new Map<number, { agendaId: number; qtd: number; primeiro: Date; ultimo: Date }>();
      const disparos: { tarefaId: number; agendaId: number; minuto: Date; recuperacao: boolean }[] = [];

      for (let t = inicio.getTime(); t <= atual.getTime(); t += 60_000) {
        const minuto = new Date(t);
        const partes = partesNoFuso(minuto);
        for (const a of agendas) {
          if (!agendaCoincide(a, partes)) continue;
          const atrasoMs = atual.getTime() - t;
          if (atrasoMs === 0) {
            disparos.push({ tarefaId: a.tarefa_id, agendaId: a.id, minuto, recuperacao: false });
          } else if (atrasoMs <= a.janela_tentativas_min * 60_000) {
            disparos.push({ tarefaId: a.tarefa_id, agendaId: a.id, minuto, recuperacao: true });
          } else {
            const p = perdidas.get(a.tarefa_id);
            if (p) {
              p.qtd++;
              p.ultimo = minuto;
            } else {
              perdidas.set(a.tarefa_id, { agendaId: a.id, qtd: 1, primeiro: minuto, ultimo: minuto });
            }
          }
        }
      }

      // Horários perdidos fora do prazo: um registro por tarefa, para o histórico não sumir
      for (const [tarefaId, p] of perdidas) {
        const quando = p.qtd === 1 ? `no horário agendado (${hhmm(p.primeiro)})` : `em ${p.qtd} horários agendados, de ${hhmm(p.primeiro)} a ${hhmm(p.ultimo)}`;
        await query(
          `INSERT INTO execucoes (tarefa_id, agenda_id, origem, situacao, agendado_para, mensagem, fim)
           VALUES ($1, $2, 'agenda', 'nao_executada', $3, $4, NOW())`,
          [tarefaId, p.agendaId, p.ultimo, `Não executada: a ferramenta estava indisponível ${quando}.`],
        );
      }

      // Disparos: no máximo um por tarefa neste ciclo (o mais recente)
      const porTarefa = new Map<number, (typeof disparos)[number]>();
      for (const d of disparos) porTarefa.set(d.tarefaId, d);
      for (const d of porTarefa.values()) {
        await enfileirar({
          tarefaId: d.tarefaId,
          agendaId: d.agendaId,
          origem: d.recuperacao && houveQueda ? 'recuperacao' : 'agenda',
          agendadoPara: d.minuto,
        });
      }

      await client.query('UPDATE agendador_estado SET ultimo_tick = $1 WHERE id = 1', [atual]);
      if (houveQueda) log(`Agendador retomado após ${Math.round((atual.getTime() - ultimo!.getTime()) / 60_000)} min sem processar.`);
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [TRAVA_AGENDADOR]).catch(() => undefined);
    }
  } finally {
    client.release();
  }
}

/** Pega a próxima execução da fila, se não houver outra rodando. Uma por vez. */
export async function processarProxima(): Promise<boolean> {
  const client = await pool.connect();
  let id: number | null = null;
  try {
    await client.query('BEGIN');
    const { rows: trava } = await client.query('SELECT pg_try_advisory_xact_lock($1) AS ok', [TRAVA_FILA]);
    if (!trava[0].ok) {
      await client.query('ROLLBACK');
      return false;
    }
    const { rows: rodando } = await client.query(`SELECT 1 FROM execucoes WHERE situacao = 'executando' LIMIT 1`);
    if (rodando[0]) {
      await client.query('ROLLBACK');
      return false;
    }
    const { rows } = await client.query(
      `SELECT id FROM execucoes WHERE situacao = 'na_fila' ORDER BY criado_em, id LIMIT 1 FOR UPDATE SKIP LOCKED`,
    );
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return false;
    }
    id = rows[0].id;
    await client.query(`UPDATE execucoes SET situacao = 'executando', inicio = NOW() WHERE id = $1`, [id]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
  await executarExecucao(id!);
  return true;
}

let iniciado = false;

export async function iniciarAgendador(log: Log) {
  if (iniciado) return;
  iniciado = true;

  // Execuções que estavam rodando quando a ferramenta caiu
  const { rowCount } = await query(
    `UPDATE execucoes SET situacao = 'erro', fim = NOW(),
            mensagem = 'Interrompida: a ferramenta foi reiniciada durante a execução.'
      WHERE situacao = 'executando'`,
  );
  if (rowCount) log(`${rowCount} execução(ões) interrompida(s) por reinício marcada(s) como erro.`);

  const ciclo = async () => {
    try {
      await verificarAgendas(new Date(), log);
    } catch (e) {
      log(`Falha ao verificar agendas: ${(e as Error).message}`);
    }
  };
  await ciclo();
  setInterval(ciclo, 20_000).unref();

  let ocupado = false;
  setInterval(async () => {
    if (ocupado) return;
    ocupado = true;
    try {
      while (await processarProxima()) {
        /* processa a fila até esvaziar */
      }
    } catch (e) {
      log(`Falha ao processar a fila: ${(e as Error).message}`);
    } finally {
      ocupado = false;
    }
  }, 3_000).unref();
}
