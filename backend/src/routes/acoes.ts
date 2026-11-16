import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { aspas, colunasDaTabela, nomeColuna, normalizarTabela, poolBiDados } from '../db/biDados.js';
import { query } from '../db/pool.js';
import { somenteDesenvolvedor } from '../lib/auth.js';
import { registrarAuditoria } from '../lib/auditoria.js';
import { ehDuplicado, lerId, validar } from '../lib/http.js';
import { converterParametrosLegados, parametrosUsados, type ValorParametro } from '../lib/sqlParametros.js';
import { carregarConexao, tipoPostgres } from '../etl/comum.js';
import { origemPara } from '../origens/tipos.js';

const acaoSchema = z.object({
  nome: z
    .string()
    .trim()
    .min(1, 'Informe o nome da ação.')
    .max(120)
    .regex(/^[A-Za-z0-9_.-]+$/, 'O nome da ação aceita letras, números, ponto, hífen e sublinhado (sem espaços).'),
  conexaoId: z.number({ message: 'Escolha a conexão de origem.' }).int().positive(),
  comandoSql: z.string().trim().min(1, 'Escreva o SELECT que busca os dados.').max(200_000),
  comandoLimpeza: z
    .string()
    .trim()
    .max(50_000)
    .nullable()
    .default(null)
    .transform((v) => v || null),
  tabelaDestino: z.string().trim().min(1, 'Informe a tabela de destino.').max(130),
  tempoMaximoMin: z.coerce.number().int().min(1, 'O tempo máximo deve ser de pelo menos 1 minuto.').max(1440).default(30),
  ativo: z.boolean().default(true),
});

const validarSchema = z.object({
  conexaoId: z.number().int().positive(),
  comandoSql: z.string().min(1),
  comandoLimpeza: z.string().nullable().optional(),
  tabelaDestino: z.string().min(1),
});

const SQL_LISTA = `
  SELECT a.*, c.nome AS conexao_nome,
         COALESCE((SELECT json_agg(json_build_object('id', t.id, 'nome', t.nome) ORDER BY t.nome)
                     FROM tarefa_acoes ta JOIN tarefas t ON t.id = ta.tarefa_id WHERE ta.acao_id = a.id), '[]') AS tarefas
    FROM acoes a JOIN conexoes c ON c.id = a.conexao_id`;

const paraResposta = (r: any, completo = false) => ({
  id: r.id,
  nome: r.nome,
  tipo: r.tipo,
  conexao: { id: r.conexao_id, nome: r.conexao_nome },
  tabelaDestino: r.tabela_destino,
  tempoMaximoMin: r.tempo_maximo_min,
  ativo: r.ativo,
  tarefas: r.tarefas,
  atualizadoEm: r.atualizado_em,
  ...(completo
    ? { comandoSql: r.comando_sql, comandoLimpeza: r.comando_limpeza }
    : { resumoSql: String(r.comando_sql).replace(/\s+/g, ' ').slice(0, 90), temLimpeza: !!r.comando_limpeza }),
});

/** Para descrever o SELECT, cada @parametro é declarado como texto (a origem converte na comparação). */
function parametrosDeTeste(sql: string): Record<string, ValorParametro> {
  return Object.fromEntries(parametrosUsados(sql).map((n) => [n, { tipo: 'texto' as const, valor: null }]));
}

export async function rotasAcoes(app: FastifyInstance) {
  app.addHook('preHandler', somenteDesenvolvedor);

  app.get('/', async () => {
    const { rows } = await query(`${SQL_LISTA} ORDER BY LOWER(a.nome)`);
    return rows.map((r) => paraResposta(r));
  });

  app.get('/:id', async (request, reply) => {
    const id = lerId(request.params, reply);
    if (!id) return;
    const { rows } = await query(`${SQL_LISTA} WHERE a.id = $1`, [id]);
    if (!rows[0]) return reply.code(404).send({ erro: 'Ação não encontrada.' });
    return paraResposta(rows[0], true);
  });

  const salvar = async (request: any, reply: any, id: number | null) => {
    const d = validar(acaoSchema, request.body, reply);
    if (!d) return;
    const destino = normalizarTabela(d.tabelaDestino);
    if (!destino) {
      return reply.code(400).send({
        erro: 'Tabela de destino inválida. Use "tabela" ou "schema.tabela", só com letras, números e _, começando por letra.',
      });
    }
    // Converte a sintaxe da ferramenta antiga: $[PARAM] → @PARAM
    const sql = converterParametrosLegados(d.comandoSql);
    const limpeza = d.comandoLimpeza ? converterParametrosLegados(d.comandoLimpeza) : { texto: null, convertidos: 0 };

    try {
      let novoId = id;
      const valores = [d.nome, d.conexaoId, sql.texto, limpeza.texto, destino.completo, d.tempoMaximoMin, d.ativo];
      if (id) {
        const { rowCount } = await query(
          `UPDATE acoes SET nome = $2, conexao_id = $3, comando_sql = $4, comando_limpeza = $5, tabela_destino = $6,
                  tempo_maximo_min = $7, ativo = $8, atualizado_em = NOW() WHERE id = $1`,
          [id, ...valores],
        );
        if (!rowCount) return reply.code(404).send({ erro: 'Ação não encontrada.' });
      } else {
        const { rows } = await query(
          `INSERT INTO acoes (nome, conexao_id, comando_sql, comando_limpeza, tabela_destino, tempo_maximo_min, ativo)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          valores,
        );
        novoId = rows[0].id;
      }
      await registrarAuditoria({
        usuarioId: request.user.sub,
        acao: id ? 'acao_alterada' : 'acao_criada',
        entidade: 'acoes',
        detalhes: { id: novoId, nome: d.nome, tabela: destino.completo },
        ip: request.ip,
      });
      const { rows } = await query(`${SQL_LISTA} WHERE a.id = $1`, [novoId]);
      return reply.code(id ? 200 : 201).send({
        ...paraResposta(rows[0], true),
        parametrosConvertidos: sql.convertidos + limpeza.convertidos,
      });
    } catch (e) {
      if (ehDuplicado(e)) return reply.code(409).send({ erro: 'Já existe uma ação com esse nome.' });
      if ((e as any)?.code === '23503') return reply.code(400).send({ erro: 'Conexão não encontrada.' });
      throw e;
    }
  };

  app.post('/', (request, reply) => salvar(request, reply, null));
  app.put('/:id', (request, reply) => {
    const id = lerId(request.params, reply);
    if (!id) return;
    return salvar(request, reply, id);
  });

  app.delete('/:id', async (request, reply) => {
    const id = lerId(request.params, reply);
    if (!id) return;
    const { rows: uso } = await query(
      'SELECT t.nome FROM tarefa_acoes ta JOIN tarefas t ON t.id = ta.tarefa_id WHERE ta.acao_id = $1 ORDER BY t.nome',
      [id],
    );
    if (uso.length) {
      return reply.code(409).send({ erro: `Esta ação é usada nas tarefas: ${uso.map((u) => u.nome).join(', ')}. Tire-a dessas tarefas antes de excluir.` });
    }
    const { rows: cubos } = await query('SELECT nome FROM cubos WHERE acao_id = $1 ORDER BY nome', [id]);
    if (cubos.length) {
      return reply.code(409).send({ erro: `Esta ação é a origem dos cubos: ${cubos.map((c) => c.nome).join(', ')}. Troque a origem desses cubos antes de excluir.` });
    }
    const { rows } = await query('DELETE FROM acoes WHERE id = $1 RETURNING nome', [id]);
    if (!rows[0]) return reply.code(404).send({ erro: 'Ação não encontrada.' });
    await registrarAuditoria({ usuarioId: request.user.sub, acao: 'acao_excluida', entidade: 'acoes', detalhes: { id, nome: rows[0].nome }, ip: request.ip });
    return reply.code(204).send();
  });

  /**
   * Confere o SELECT sem executá-lo: colunas que ele retorna, se batem com a tabela de destino
   * e quais parâmetros ele usa. Também avisa sobre $[PARAM] ainda não convertidos.
   */
  app.post('/validar', async (request, reply) => {
    const d = validar(validarSchema, request.body, reply);
    if (!d) return;
    const destino = normalizarTabela(d.tabelaDestino);
    if (!destino) return reply.code(400).send({ erro: 'Tabela de destino inválida.' });
    const sql = converterParametrosLegados(d.comandoSql).texto;
    const limpeza = d.comandoLimpeza ? converterParametrosLegados(d.comandoLimpeza).texto : null;

    let colunasOrigem: { nome: string; tipoOrigem: string; tipoDestino: string }[] = [];
    let erroOrigem: string | null = null;
    try {
      const conexao = await carregarConexao(d.conexaoId);
      const cols = await origemPara(conexao.tipo).descrever(conexao, sql, parametrosDeTeste(sql));
      colunasOrigem = cols.map((c) => ({ nome: nomeColuna(c.nome), tipoOrigem: c.tipoOrigem, tipoDestino: tipoPostgres(c.tipoOrigem) }));
    } catch (e) {
      erroOrigem = (e as Error).message;
    }

    const colunasTabela = await colunasDaTabela(destino.schema, destino.tabela);
    const nomesTabela = colunasTabela.map((c) => c.column_name);
    const nomesOrigem = colunasOrigem.map((c) => c.nome);
    return {
      tabela: destino.completo,
      tabelaExiste: colunasTabela.length > 0,
      colunasOrigem,
      colunasTabela: colunasTabela.map((c) => ({ nome: c.column_name, tipo: c.data_type })),
      faltamNaTabela: colunasTabela.length ? nomesOrigem.filter((n) => !nomesTabela.includes(n)) : [],
      faltamNoSelect: colunasTabela.length && !erroOrigem ? nomesTabela.filter((n) => !nomesOrigem.includes(n)) : [],
      parametrosSelect: parametrosUsados(sql),
      parametrosLimpeza: limpeza ? parametrosUsados(limpeza, 'pg') : [],
      erroOrigem,
    };
  });

  /** Cria (ou recria, se estiver vazia) a tabela de destino a partir das colunas do SELECT. */
  app.post('/:id/criar-tabela', async (request, reply) => {
    const id = lerId(request.params, reply);
    if (!id) return;
    const { rows } = await query('SELECT * FROM acoes WHERE id = $1', [id]);
    const a = rows[0];
    if (!a) return reply.code(404).send({ erro: 'Ação não encontrada.' });
    const destino = normalizarTabela(a.tabela_destino)!;
    const existentes = await colunasDaTabela(destino.schema, destino.tabela);
    const tabelaSql = `${aspas(destino.schema)}.${aspas(destino.tabela)}`;
    if (existentes.length) {
      const { rows: cont } = await poolBiDados.query(`SELECT EXISTS (SELECT 1 FROM ${tabelaSql}) AS tem`);
      if (cont[0].tem) {
        return reply.code(409).send({ erro: `A tabela ${destino.completo} já existe e tem dados. Ela não será recriada para não perder informações.` });
      }
    }
    const conexao = await carregarConexao(a.conexao_id);
    let cols;
    try {
      cols = await origemPara(conexao.tipo).descrever(conexao, a.comando_sql, parametrosDeTeste(a.comando_sql));
    } catch (e) {
      return reply.code(400).send({ erro: (e as Error).message });
    }
    const defs = cols.map((c) => `${aspas(nomeColuna(c.nome))} ${tipoPostgres(c.tipoOrigem)}`);
    const client = await poolBiDados.connect();
    try {
      await client.query('BEGIN');
      await client.query(`CREATE SCHEMA IF NOT EXISTS ${aspas(destino.schema)}`);
      if (existentes.length) await client.query(`DROP TABLE ${tabelaSql}`);
      await client.query(`CREATE TABLE ${tabelaSql} (${defs.join(', ')})`);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      return reply.code(400).send({ erro: (e as Error).message });
    } finally {
      client.release();
    }
    await registrarAuditoria({ usuarioId: request.user.sub, acao: 'tabela_criada', entidade: 'acoes', detalhes: { id, tabela: destino.completo }, ip: request.ip });
    return { tabela: destino.completo, colunas: cols.length, recriada: existentes.length > 0 };
  });
}
