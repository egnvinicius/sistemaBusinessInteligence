import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool, query } from '../db/pool.js';
import { somenteAdmin, somenteDesenvolvedor } from '../lib/auth.js';
import { registrarAuditoria } from '../lib/auditoria.js';
import { ehDuplicado, lerId, validar } from '../lib/http.js';
import { converterValor, exibirValor } from '../lib/sqlParametros.js';
import { proximasExecucoes, type AgendaRegra } from '../etl/agenda.js';
import { enfileirar } from '../etl/agendador.js';
import { carregarConexao } from '../etl/comum.js';
import { definicoesEfetivas, resolverParametros } from '../etl/parametros.js';

/* ---------- Esquemas ---------- */

const nomeTecnico = (rotulo: string) =>
  z
    .string()
    .trim()
    .min(1, `Informe o nome da ${rotulo}.`)
    .max(120)
    .regex(/^[A-Za-z0-9_.-]+$/, `O nome da ${rotulo} aceita letras, números, ponto, hífen e sublinhado (sem espaços).`);

const grupoSchema = z.object({ nome: z.string().trim().min(1, 'Informe o nome do grupo.').max(60) });

const tarefaSchema = z.object({
  grupoId: z.number({ message: 'Escolha o grupo da tarefa.' }).int().positive(),
  nome: nomeTecnico('tarefa'),
  descricao: z
    .string()
    .trim()
    .max(255)
    .nullable()
    .default(null)
    .transform((v) => v || null),
  ativa: z.boolean().default(true),
  maxTentativasAcesso: z.coerce.number().int().min(1).max(50).default(5),
  janelaTentativasMin: z.coerce.number().int().min(1).max(720).default(15),
});

const acoesDaTarefaSchema = z.object({
  acoes: z
    .array(
      z.object({
        acaoId: z.number().int().positive(),
        casoErro: z.enum(['continuar', 'parar']).default('continuar'),
        tentativas: z.coerce.number().int().min(1).max(10).default(1),
      }),
    )
    .max(200),
});

const lista = (min: number, max: number, rotulo: string) =>
  z
    .array(z.number().int().min(min, `${rotulo} inválido.`).max(max, `${rotulo} inválido.`))
    .max(100)
    .default([])
    .transform((v) => [...new Set(v)].sort((a, b) => a - b));

const agendaSchema = z
  .object({
    repetirPor: z.enum(['semana', 'mes']).default('semana'),
    diasSemana: lista(0, 6, 'Dia da semana'),
    diasMes: lista(1, 31, 'Dia do mês'),
    meses: lista(1, 12, 'Mês'),
    horas: lista(0, 23, 'Hora').refine((v) => v.length > 0, 'Escolha pelo menos uma hora.'),
    minutos: lista(0, 55, 'Minuto')
      .refine((v) => v.length > 0, 'Escolha pelo menos um minuto.')
      .refine((v) => v.every((m) => m % 5 === 0), 'Os minutos devem ser de 5 em 5 (0, 5, 10… 55).'),
    ativa: z.boolean().default(true),
  })
  // Na mesma linha, ou dias da semana, ou dias do mês
  .transform((a) => (a.repetirPor === 'semana' ? { ...a, diasMes: [] } : { ...a, diasSemana: [] }));

const parametroSchema = z.object({
  agendaId: z.number().int().positive().nullable().default(null),
  nome: z
    .string()
    .trim()
    .regex(/^@?[A-Za-z_][A-Za-z0-9_]{0,59}$/, 'O nome do parâmetro aceita letras, números e _, começando por letra (sem espaços).')
    .transform((v) => v.replace(/^@/, '')),
  tipo: z.enum(['texto', 'numero', 'data']).default('texto'),
  modo: z.enum(['fixo', 'expressao']).default('fixo'),
  valor: z.string().trim().max(2000),
});

/* ---------- Respostas ---------- */

const paraAgenda = (a: any) => ({
  id: a.id,
  repetirPor: a.repetir_por,
  diasSemana: a.dias_semana,
  diasMes: a.dias_mes,
  meses: a.meses,
  horas: a.horas,
  minutos: a.minutos,
  ativa: a.ativa,
});

const paraExecucao = (e: any) =>
  e
    ? {
        id: Number(e.id),
        tarefaId: e.tarefa_id,
        tarefaNome: e.tarefa_nome,
        origem: e.origem,
        situacao: e.situacao,
        agendadoPara: e.agendado_para,
        inicio: e.inicio,
        fim: e.fim,
        criadoEm: e.criado_em,
        mensagem: e.mensagem,
        parametros: e.parametros_json,
        solicitadoPor: e.usuario_nome ?? null,
        acoesTotal: e.acoes_total !== undefined ? Number(e.acoes_total) : undefined,
        acoesErro: e.acoes_erro !== undefined ? Number(e.acoes_erro) : undefined,
      }
    : null;

async function agendasAtivas() {
  const { rows } = await query<AgendaRegra>(
    'SELECT a.* FROM agendas a JOIN tarefas t ON t.id = a.tarefa_id WHERE a.ativa AND t.ativa',
  );
  return rows;
}

export async function rotasTarefas(app: FastifyInstance) {
  const auditar = (request: any, acao: string, detalhes: Record<string, unknown>) =>
    registrarAuditoria({ usuarioId: request.user.sub, acao, entidade: 'tarefas', detalhes, ip: request.ip });

  /* =========================================================
     Grupos de tarefas
     ========================================================= */
  app.get('/grupos', { preHandler: somenteAdmin }, async () => {
    const { rows } = await query(
      `SELECT g.id, g.nome, (SELECT COUNT(*) FROM tarefas t WHERE t.grupo_id = g.id) AS tarefas
         FROM tarefa_grupos g ORDER BY g.ordem, LOWER(g.nome)`,
    );
    return rows.map((r) => ({ id: r.id, nome: r.nome, tarefas: Number(r.tarefas) }));
  });

  app.post('/grupos', { preHandler: somenteDesenvolvedor }, async (request, reply) => {
    const d = validar(grupoSchema, request.body, reply);
    if (!d) return;
    try {
      const { rows } = await query(
        `INSERT INTO tarefa_grupos (nome, ordem) VALUES ($1, (SELECT COALESCE(MAX(ordem), -1) + 1 FROM tarefa_grupos)) RETURNING id`,
        [d.nome],
      );
      return reply.code(201).send({ id: rows[0].id, nome: d.nome, tarefas: 0 });
    } catch (e) {
      if (ehDuplicado(e)) return reply.code(409).send({ erro: 'Já existe um grupo de tarefas com esse nome.' });
      throw e;
    }
  });

  app.put('/grupos/:id', { preHandler: somenteDesenvolvedor }, async (request, reply) => {
    const id = lerId(request.params, reply);
    if (!id) return;
    const d = validar(grupoSchema, request.body, reply);
    if (!d) return;
    try {
      const { rowCount } = await query('UPDATE tarefa_grupos SET nome = $2 WHERE id = $1', [id, d.nome]);
      if (!rowCount) return reply.code(404).send({ erro: 'Grupo não encontrado.' });
      return { id, nome: d.nome };
    } catch (e) {
      if (ehDuplicado(e)) return reply.code(409).send({ erro: 'Já existe um grupo de tarefas com esse nome.' });
      throw e;
    }
  });

  app.delete('/grupos/:id', { preHandler: somenteDesenvolvedor }, async (request, reply) => {
    const id = lerId(request.params, reply);
    if (!id) return;
    const { rows } = await query('SELECT COUNT(*) AS n FROM tarefas WHERE grupo_id = $1', [id]);
    if (Number(rows[0].n) > 0) return reply.code(409).send({ erro: 'Este grupo ainda tem tarefas. Mova ou exclua as tarefas antes.' });
    const { rowCount } = await query('DELETE FROM tarefa_grupos WHERE id = $1', [id]);
    if (!rowCount) return reply.code(404).send({ erro: 'Grupo não encontrado.' });
    return reply.code(204).send();
  });

  /* =========================================================
     Fila e execuções (Gestor e Desenvolvedor acompanham)
     ========================================================= */
  app.get('/fila', { preHandler: somenteAdmin }, async () => {
    const { rows } = await query(
      `SELECT e.*, t.nome AS tarefa_nome FROM execucoes e JOIN tarefas t ON t.id = e.tarefa_id
        WHERE e.situacao IN ('na_fila', 'executando') ORDER BY e.situacao DESC, e.criado_em`,
    );
    return rows.map(paraExecucao);
  });

  app.get('/execucoes/:id', { preHandler: somenteAdmin }, async (request, reply) => {
    const id = lerId(request.params, reply);
    if (!id) return;
    const { rows } = await query(
      `SELECT e.*, t.nome AS tarefa_nome, u.nome AS usuario_nome
         FROM execucoes e JOIN tarefas t ON t.id = e.tarefa_id LEFT JOIN usuarios u ON u.id = e.solicitado_por
        WHERE e.id = $1`,
      [id],
    );
    if (!rows[0]) return reply.code(404).send({ erro: 'Execução não encontrada.' });
    const [{ rows: acoes }, { rows: logs }] = await Promise.all([
      query('SELECT * FROM execucao_acoes WHERE execucao_id = $1 ORDER BY ordem, id', [id]),
      query('SELECT nivel, mensagem, data_hora FROM execucao_logs WHERE execucao_id = $1 ORDER BY id', [id]),
    ]);
    return {
      ...paraExecucao(rows[0]),
      acoes: acoes.map((a) => ({
        nome: a.acao_nome,
        ordem: a.ordem,
        situacao: a.situacao,
        tentativas: a.tentativas,
        linhasExcluidas: a.linhas_excluidas === null ? null : Number(a.linhas_excluidas),
        linhasInseridas: a.linhas_inseridas === null ? null : Number(a.linhas_inseridas),
        inicio: a.inicio,
        fim: a.fim,
        mensagem: a.mensagem,
      })),
      logs: logs.map((l) => ({ nivel: l.nivel, mensagem: l.mensagem, dataHora: l.data_hora })),
    };
  });

  /* =========================================================
     Tarefas
     ========================================================= */
  app.get('/', { preHandler: somenteAdmin }, async () => {
    const [{ rows }, agendas] = await Promise.all([
      query(
        `SELECT t.*, g.nome AS grupo_nome, g.ordem AS grupo_ordem,
                (SELECT COUNT(*) FROM tarefa_acoes ta WHERE ta.tarefa_id = t.id) AS n_acoes,
                (SELECT COUNT(*) FROM agendas a WHERE a.tarefa_id = t.id AND a.ativa) AS n_agendas,
                (SELECT row_to_json(x) FROM (
                    SELECT e.id, e.situacao, e.inicio, e.fim, e.criado_em, e.mensagem, e.origem
                      FROM execucoes e
                     WHERE e.tarefa_id = t.id AND e.situacao NOT IN ('na_fila', 'executando', 'ignorado')
                     ORDER BY e.criado_em DESC LIMIT 1) x) AS ultima,
                (SELECT row_to_json(x) FROM (
                    SELECT e.id, e.situacao, e.inicio, e.criado_em
                      FROM execucoes e
                     WHERE e.tarefa_id = t.id AND e.situacao IN ('na_fila', 'executando')
                     ORDER BY e.criado_em LIMIT 1) x) AS andamento
           FROM tarefas t JOIN tarefa_grupos g ON g.id = t.grupo_id
          ORDER BY g.ordem, LOWER(g.nome), LOWER(t.nome)`,
      ),
      agendasAtivas(),
    ]);
    const proximas = proximasExecucoes(agendas);
    return rows.map((t) => ({
      id: t.id,
      nome: t.nome,
      descricao: t.descricao,
      ativa: t.ativa,
      grupo: { id: t.grupo_id, nome: t.grupo_nome },
      acoes: Number(t.n_acoes),
      agendas: Number(t.n_agendas),
      ultima: t.ultima,
      andamento: t.andamento,
      proxima: t.ativa ? (proximas.get(t.id) ?? null) : null,
    }));
  });

  app.get('/:id', { preHandler: somenteAdmin }, async (request, reply) => {
    const id = lerId(request.params, reply);
    if (!id) return;
    const { rows } = await query(
      'SELECT t.*, g.nome AS grupo_nome FROM tarefas t JOIN tarefa_grupos g ON g.id = t.grupo_id WHERE t.id = $1',
      [id],
    );
    const t = rows[0];
    if (!t) return reply.code(404).send({ erro: 'Tarefa não encontrada.' });
    const ehDev = request.user.perfil === 'desenvolvedor';
    const [{ rows: acoes }, { rows: agendas }, { rows: parametros }] = await Promise.all([
      query(
        `SELECT ta.id, ta.ordem, ta.caso_erro, ta.tentativas, a.id AS acao_id, a.nome, a.ativo, a.tabela_destino,
                a.tempo_maximo_min, c.nome AS conexao_nome
           FROM tarefa_acoes ta JOIN acoes a ON a.id = ta.acao_id JOIN conexoes c ON c.id = a.conexao_id
          WHERE ta.tarefa_id = $1 ORDER BY ta.ordem, ta.id`,
        [id],
      ),
      query('SELECT * FROM agendas WHERE tarefa_id = $1 ORDER BY id', [id]),
      // Parâmetros podem conter expressões SQL: só o Desenvolvedor vê
      ehDev
        ? query('SELECT * FROM tarefa_parametros WHERE tarefa_id = $1 ORDER BY agenda_id NULLS FIRST, LOWER(nome)', [id])
        : Promise.resolve({ rows: [] as any[] }),
    ]);
    const proxima = t.ativa ? proximasExecucoes(agendas.filter((a: any) => a.ativa)).get(id) ?? null : null;
    return {
      id: t.id,
      nome: t.nome,
      descricao: t.descricao,
      ativa: t.ativa,
      grupo: { id: t.grupo_id, nome: t.grupo_nome },
      maxTentativasAcesso: t.max_tentativas_acesso,
      janelaTentativasMin: t.janela_tentativas_min,
      proxima,
      acoes: acoes.map((a) => ({
        acaoId: a.acao_id,
        nome: a.nome,
        ativo: a.ativo,
        ordem: a.ordem,
        casoErro: a.caso_erro,
        tentativas: a.tentativas,
        tabelaDestino: a.tabela_destino,
        tempoMaximoMin: a.tempo_maximo_min,
        conexao: a.conexao_nome,
      })),
      agendas: agendas.map(paraAgenda),
      parametros: parametros.map((p) => ({
        id: p.id,
        agendaId: p.agenda_id,
        nome: p.nome,
        tipo: p.tipo,
        modo: p.modo,
        valor: p.valor,
      })),
      parametrosVisiveis: ehDev,
    };
  });

  const salvarTarefa = async (request: any, reply: any, id: number | null) => {
    const d = validar(tarefaSchema, request.body, reply);
    if (!d) return;
    try {
      const valores = [d.grupoId, d.nome, d.descricao, d.ativa, d.maxTentativasAcesso, d.janelaTentativasMin];
      let novoId = id;
      if (id) {
        const { rowCount } = await query(
          `UPDATE tarefas SET grupo_id = $2, nome = $3, descricao = $4, ativa = $5, max_tentativas_acesso = $6,
                  janela_tentativas_min = $7, atualizado_em = NOW() WHERE id = $1`,
          [id, ...valores],
        );
        if (!rowCount) return reply.code(404).send({ erro: 'Tarefa não encontrada.' });
      } else {
        const { rows } = await query(
          `INSERT INTO tarefas (grupo_id, nome, descricao, ativa, max_tentativas_acesso, janela_tentativas_min)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          valores,
        );
        novoId = rows[0].id;
      }
      await auditar(request, id ? 'tarefa_alterada' : 'tarefa_criada', { id: novoId, nome: d.nome });
      return reply.code(id ? 200 : 201).send({ id: novoId });
    } catch (e) {
      if (ehDuplicado(e)) return reply.code(409).send({ erro: 'Já existe uma tarefa com esse nome.' });
      if ((e as any)?.code === '23503') return reply.code(400).send({ erro: 'Grupo de tarefas não encontrado.' });
      throw e;
    }
  };

  app.post('/', { preHandler: somenteDesenvolvedor }, (request, reply) => salvarTarefa(request, reply, null));
  app.put('/:id', { preHandler: somenteDesenvolvedor }, (request, reply) => {
    const id = lerId(request.params, reply);
    if (!id) return;
    return salvarTarefa(request, reply, id);
  });

  app.delete('/:id', { preHandler: somenteDesenvolvedor }, async (request, reply) => {
    const id = lerId(request.params, reply);
    if (!id) return;
    const { rows: andamento } = await query(
      `SELECT 1 FROM execucoes WHERE tarefa_id = $1 AND situacao IN ('na_fila', 'executando')`,
      [id],
    );
    if (andamento[0]) return reply.code(409).send({ erro: 'A tarefa está na fila ou em execução. Pare a execução antes de excluir.' });
    const { rows } = await query('DELETE FROM tarefas WHERE id = $1 RETURNING nome', [id]);
    if (!rows[0]) return reply.code(404).send({ erro: 'Tarefa não encontrada.' });
    await auditar(request, 'tarefa_excluida', { id, nome: rows[0].nome });
    return reply.code(204).send();
  });

  /** Ativar/desativar é operacional: Gestor também pode. */
  app.patch('/:id/ativa', { preHandler: somenteAdmin }, async (request, reply) => {
    const id = lerId(request.params, reply);
    if (!id) return;
    const d = validar(z.object({ ativa: z.boolean() }), request.body, reply);
    if (!d) return;
    const { rowCount } = await query('UPDATE tarefas SET ativa = $2, atualizado_em = NOW() WHERE id = $1', [id, d.ativa]);
    if (!rowCount) return reply.code(404).send({ erro: 'Tarefa não encontrada.' });
    await auditar(request, d.ativa ? 'tarefa_ativada' : 'tarefa_desativada', { id });
    return { id, ativa: d.ativa };
  });

  /* ---------- Ações da tarefa (lista ordenada) ---------- */
  app.put('/:id/acoes', { preHandler: somenteDesenvolvedor }, async (request, reply) => {
    const id = lerId(request.params, reply);
    if (!id) return;
    const d = validar(acoesDaTarefaSchema, request.body, reply);
    if (!d) return;
    const ids = d.acoes.map((a) => a.acaoId);
    if (new Set(ids).size !== ids.length) return reply.code(400).send({ erro: 'Uma ação não pode aparecer duas vezes na mesma tarefa.' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: t } = await client.query('SELECT 1 FROM tarefas WHERE id = $1', [id]);
      if (!t[0]) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ erro: 'Tarefa não encontrada.' });
      }
      await client.query('DELETE FROM tarefa_acoes WHERE tarefa_id = $1', [id]);
      for (const [i, a] of d.acoes.entries()) {
        await client.query(
          'INSERT INTO tarefa_acoes (tarefa_id, acao_id, ordem, caso_erro, tentativas) VALUES ($1, $2, $3, $4, $5)',
          [id, a.acaoId, (i + 1) * 10, a.casoErro, a.tentativas],
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      if ((e as any)?.code === '23503') return reply.code(400).send({ erro: 'Uma das ações escolhidas não existe mais.' });
      throw e;
    } finally {
      client.release();
    }
    await auditar(request, 'tarefa_acoes_alteradas', { id, acoes: ids });
    return { ok: true };
  });

  /* ---------- Agenda ---------- */
  app.post('/:id/agendas', { preHandler: somenteDesenvolvedor }, async (request, reply) => {
    const id = lerId(request.params, reply);
    if (!id) return;
    const d = validar(agendaSchema, request.body, reply);
    if (!d) return;
    try {
      const { rows } = await query(
        `INSERT INTO agendas (tarefa_id, repetir_por, dias_semana, dias_mes, meses, horas, minutos, ativa)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [id, d.repetirPor, d.diasSemana, d.diasMes, d.meses, d.horas, d.minutos, d.ativa],
      );
      await auditar(request, 'agenda_criada', { tarefa: id, agenda: rows[0].id });
      return reply.code(201).send(paraAgenda(rows[0]));
    } catch (e) {
      if ((e as any)?.code === '23503') return reply.code(404).send({ erro: 'Tarefa não encontrada.' });
      throw e;
    }
  });

  app.put('/agendas/:id', { preHandler: somenteDesenvolvedor }, async (request, reply) => {
    const id = lerId(request.params, reply);
    if (!id) return;
    const d = validar(agendaSchema, request.body, reply);
    if (!d) return;
    const { rows } = await query(
      `UPDATE agendas SET repetir_por = $2, dias_semana = $3, dias_mes = $4, meses = $5, horas = $6, minutos = $7, ativa = $8
        WHERE id = $1 RETURNING *`,
      [id, d.repetirPor, d.diasSemana, d.diasMes, d.meses, d.horas, d.minutos, d.ativa],
    );
    if (!rows[0]) return reply.code(404).send({ erro: 'Agenda não encontrada.' });
    await auditar(request, 'agenda_alterada', { agenda: id });
    return paraAgenda(rows[0]);
  });

  app.delete('/agendas/:id', { preHandler: somenteDesenvolvedor }, async (request, reply) => {
    const id = lerId(request.params, reply);
    if (!id) return;
    const { rows } = await query('DELETE FROM agendas WHERE id = $1 RETURNING tarefa_id', [id]);
    if (!rows[0]) return reply.code(404).send({ erro: 'Agenda não encontrada.' });
    await auditar(request, 'agenda_excluida', { agenda: id, tarefa: rows[0].tarefa_id });
    return reply.code(204).send();
  });

  /* ---------- Parâmetros ---------- */
  const salvarParametro = async (request: any, reply: any, tarefaId: number | null, parametroId: number | null) => {
    const d = validar(parametroSchema, request.body, reply);
    if (!d) return;
    if (d.modo === 'fixo') {
      try {
        converterValor(d.tipo, d.valor);
      } catch (e) {
        return reply.code(400).send({ erro: (e as Error).message });
      }
    } else if (!d.valor) {
      return reply.code(400).send({ erro: 'Escreva a expressão do parâmetro.' });
    }
    try {
      if (parametroId) {
        const { rows } = await query(
          `UPDATE tarefa_parametros SET agenda_id = $2, nome = $3, tipo = $4, modo = $5, valor = $6
            WHERE id = $1 AND ($2::int IS NULL OR EXISTS (SELECT 1 FROM agendas a WHERE a.id = $2 AND a.tarefa_id = tarefa_parametros.tarefa_id))
            RETURNING *`,
          [parametroId, d.agendaId, d.nome, d.tipo, d.modo, d.valor],
        );
        if (!rows[0]) return reply.code(404).send({ erro: 'Parâmetro ou agenda não encontrado.' });
        await auditar(request, 'parametro_alterado', { parametro: parametroId, nome: d.nome });
        return rows[0];
      }
      const { rows } = await query(
        `INSERT INTO tarefa_parametros (tarefa_id, agenda_id, nome, tipo, modo, valor)
         SELECT $1, $2, $3, $4, $5, $6
          WHERE $2::int IS NULL OR EXISTS (SELECT 1 FROM agendas a WHERE a.id = $2 AND a.tarefa_id = $1)
         RETURNING *`,
        [tarefaId, d.agendaId, d.nome, d.tipo, d.modo, d.valor],
      );
      if (!rows[0]) return reply.code(400).send({ erro: 'A agenda escolhida não pertence a esta tarefa.' });
      await auditar(request, 'parametro_criado', { tarefa: tarefaId, nome: d.nome });
      return reply.code(201).send(rows[0]);
    } catch (e) {
      if (ehDuplicado(e)) {
        return reply.code(409).send({ erro: `O parâmetro @${d.nome} já existe ${d.agendaId ? 'nesta agenda' : 'como valor padrão'}.` });
      }
      if ((e as any)?.code === '23503') return reply.code(404).send({ erro: 'Tarefa não encontrada.' });
      throw e;
    }
  };

  app.post('/:id/parametros', { preHandler: somenteDesenvolvedor }, (request, reply) => {
    const id = lerId(request.params, reply);
    if (!id) return;
    return salvarParametro(request, reply, id, null);
  });

  app.put('/parametros/:id', { preHandler: somenteDesenvolvedor }, (request, reply) => {
    const id = lerId(request.params, reply);
    if (!id) return;
    return salvarParametro(request, reply, null, id);
  });

  app.delete('/parametros/:id', { preHandler: somenteDesenvolvedor }, async (request, reply) => {
    const id = lerId(request.params, reply);
    if (!id) return;
    const { rowCount } = await query('DELETE FROM tarefa_parametros WHERE id = $1', [id]);
    if (!rowCount) return reply.code(404).send({ erro: 'Parâmetro não encontrado.' });
    await auditar(request, 'parametro_excluido', { parametro: id });
    return reply.code(204).send();
  });

  /** Calcula os parâmetros agora, como numa execução (padrão ou de uma agenda), sem carregar dados. */
  app.post('/:id/parametros/testar', { preHandler: somenteDesenvolvedor }, async (request, reply) => {
    const id = lerId(request.params, reply);
    if (!id) return;
    const d = validar(z.object({ agendaId: z.number().int().positive().nullable().default(null) }), request.body ?? {}, reply);
    if (!d) return;
    const defs = await definicoesEfetivas(id, d.agendaId);
    try {
      let conexao = null;
      if (defs.some((p) => p.modo === 'expressao')) {
        const { rows } = await query(
          'SELECT a.conexao_id FROM tarefa_acoes ta JOIN acoes a ON a.id = ta.acao_id WHERE ta.tarefa_id = $1 ORDER BY ta.ordem LIMIT 1',
          [id],
        );
        if (!rows[0]) return reply.code(400).send({ erro: 'Adicione pelo menos uma ação à tarefa: as expressões são calculadas na conexão da primeira ação.' });
        conexao = await carregarConexao(rows[0].conexao_id);
      }
      const valores = await resolverParametros(defs, conexao);
      return {
        valores: Object.entries(valores).map(([nome, v]) => ({
          nome,
          tipo: v.tipo,
          valor: exibirValor(v.valor),
          origem: defs.find((x) => x.nome === nome)?.agenda_id ? 'agenda' : 'padrao',
        })),
      };
    } catch (e) {
      return reply.code(400).send({ erro: (e as Error).message });
    }
  });

  /* ---------- Execução manual e parada (Gestor e Desenvolvedor) ---------- */
  app.post('/:id/executar', { preHandler: somenteAdmin }, async (request, reply) => {
    const id = lerId(request.params, reply);
    if (!id) return;
    const { rows } = await query(
      'SELECT t.nome, (SELECT COUNT(*) FROM tarefa_acoes ta WHERE ta.tarefa_id = t.id) AS n FROM tarefas t WHERE t.id = $1',
      [id],
    );
    if (!rows[0]) return reply.code(404).send({ erro: 'Tarefa não encontrada.' });
    if (Number(rows[0].n) === 0) return reply.code(400).send({ erro: 'A tarefa não tem ações para executar.' });
    const r = await enfileirar({ tarefaId: id, origem: 'manual', usuarioId: request.user.sub });
    if (r.jaEmAndamento) return reply.code(409).send({ erro: 'A tarefa já está na fila ou em execução.', execucaoId: r.id });
    await auditar(request, 'tarefa_executada_manual', { id, execucao: r.id });
    return reply.code(202).send({ execucaoId: r.id });
  });

  app.post('/:id/parar', { preHandler: somenteAdmin }, async (request, reply) => {
    const id = lerId(request.params, reply);
    if (!id) return;
    const { rowCount: daFila } = await query(
      `UPDATE execucoes SET situacao = 'cancelado', fim = NOW(), mensagem = 'Cancelada antes de começar, a pedido de um usuário.'
        WHERE tarefa_id = $1 AND situacao = 'na_fila'`,
      [id],
    );
    const { rowCount: emExecucao } = await query(
      `UPDATE execucoes SET cancelar = TRUE WHERE tarefa_id = $1 AND situacao = 'executando'`,
      [id],
    );
    if (!daFila && !emExecucao) return reply.code(409).send({ erro: 'A tarefa não está na fila nem em execução.' });
    await auditar(request, 'tarefa_parada', { id });
    return { canceladasNaFila: daFila, interrompendo: emExecucao };
  });

  app.get('/:id/execucoes', { preHandler: somenteAdmin }, async (request, reply) => {
    const id = lerId(request.params, reply);
    if (!id) return;
    const limite = Math.min(Number((request.query as any)?.limite) || 50, 500);
    const { rows } = await query(
      `SELECT e.*, u.nome AS usuario_nome,
              (SELECT COUNT(*) FROM execucao_acoes ea WHERE ea.execucao_id = e.id) AS acoes_total,
              (SELECT COUNT(*) FROM execucao_acoes ea WHERE ea.execucao_id = e.id AND ea.situacao = 'erro') AS acoes_erro
         FROM execucoes e LEFT JOIN usuarios u ON u.id = e.solicitado_por
        WHERE e.tarefa_id = $1 ORDER BY e.criado_em DESC, e.id DESC LIMIT $2`,
      [id, limite],
    );
    return rows.map(paraExecucao);
  });
}
