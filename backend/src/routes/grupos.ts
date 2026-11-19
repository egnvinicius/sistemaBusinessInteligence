import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool, query } from '../db/pool.js';
import { somenteAdmin } from '../lib/auth.js';
import { registrarAuditoria } from '../lib/auditoria.js';
import { ehDuplicado, lerId, listaIds, validar } from '../lib/http.js';

const grupoSchema = z.object({
  nome: z.string().trim().min(1, 'Informe o nome do grupo.').max(80),
  descricao: z
    .string()
    .trim()
    .max(255)
    .nullable()
    .default(null)
    .transform((v) => v || null),
  membros: listaIds,
  paineis: listaIds,
});

const SQL_LISTA = `
  SELECT g.id, g.nome, g.descricao,
         COALESCE((SELECT array_agg(ug.usuario_id ORDER BY ug.usuario_id) FROM usuario_grupo ug WHERE ug.grupo_usuario_id = g.id), '{}') AS membros,
         COALESCE((SELECT array_agg(pp.painel_id ORDER BY pp.painel_id) FROM painel_permissao pp WHERE pp.grupo_usuario_id = g.id), '{}') AS paineis
    FROM grupos_usuarios g`;

const paraResposta = (r: any) => ({
  id: r.id,
  nome: r.nome,
  descricao: r.descricao,
  membros: r.membros as number[],
  paineis: r.paineis as number[],
});

async function buscar(id: number) {
  const { rows } = await query(`${SQL_LISTA} WHERE g.id = $1`, [id]);
  return rows[0] ? paraResposta(rows[0]) : null;
}

async function gravarVinculos(client: any, grupoId: number, membros: number[], paineis: number[]) {
  await client.query('DELETE FROM usuario_grupo WHERE grupo_usuario_id = $1', [grupoId]);
  if (membros.length) {
    await client.query(
      `INSERT INTO usuario_grupo (usuario_id, grupo_usuario_id)
       SELECT u.id, $1 FROM usuarios u WHERE u.id = ANY($2::int[])`,
      [grupoId, membros],
    );
  }
  await client.query('DELETE FROM painel_permissao WHERE grupo_usuario_id = $1', [grupoId]);
  if (paineis.length) {
    await client.query(
      `INSERT INTO painel_permissao (painel_id, grupo_usuario_id)
       SELECT p.id, $1 FROM paineis p WHERE p.id = ANY($2::int[])`,
      [grupoId, paineis],
    );
  }
}

export async function rotasGrupos(app: FastifyInstance) {
  app.addHook('preHandler', somenteAdmin);

  app.get('/', async () => {
    const { rows } = await query(`${SQL_LISTA} ORDER BY LOWER(g.nome)`);
    return rows.map(paraResposta);
  });

  const salvar = async (request: any, reply: any, id: number | null) => {
    const d = validar(grupoSchema, request.body, reply);
    if (!d) return;
    const client = await pool.connect();
    let grupoId = id;
    try {
      await client.query('BEGIN');
      if (grupoId) {
        const { rowCount } = await client.query(
          'UPDATE grupos_usuarios SET nome = $2, descricao = $3 WHERE id = $1',
          [grupoId, d.nome, d.descricao],
        );
        if (!rowCount) {
          await client.query('ROLLBACK');
          return reply.code(404).send({ erro: 'Grupo não encontrado.' });
        }
      } else {
        const { rows } = await client.query(
          'INSERT INTO grupos_usuarios (nome, descricao) VALUES ($1, $2) RETURNING id',
          [d.nome, d.descricao],
        );
        grupoId = rows[0].id as number;
      }
      await gravarVinculos(client, grupoId, d.membros, d.paineis);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      if (ehDuplicado(e)) return reply.code(409).send({ erro: 'Já existe um grupo com esse nome.' });
      throw e;
    } finally {
      client.release();
    }
    await registrarAuditoria({
      usuarioId: request.user.sub,
      acao: id ? 'grupo_alterado' : 'grupo_criado',
      entidade: 'grupos_usuarios',
      detalhes: { id: grupoId, nome: d.nome },
      ip: request.ip,
    });
    return reply.code(id ? 200 : 201).send(await buscar(grupoId!));
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
    const { rows } = await query('DELETE FROM grupos_usuarios WHERE id = $1 RETURNING nome', [id]);
    if (!rows[0]) return reply.code(404).send({ erro: 'Grupo não encontrado.' });
    await registrarAuditoria({ usuarioId: request.user.sub, acao: 'grupo_excluido', entidade: 'grupos_usuarios', detalhes: { id, nome: rows[0].nome }, ip: request.ip });
    return reply.code(204).send();
  });
}
