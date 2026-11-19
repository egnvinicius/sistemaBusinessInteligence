import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { z } from 'zod';
import { pool, query } from '../db/pool.js';
import { somenteAdmin, type Perfil } from '../lib/auth.js';
import { registrarAuditoria } from '../lib/auditoria.js';
import { ehDuplicado, lerId, listaIds, senhaForte, validar } from '../lib/http.js';

const base = {
  nome: z.string().trim().min(1, 'Informe o nome.').max(120),
  login: z
    .string()
    .trim()
    .min(3, 'O login deve ter ao menos 3 caracteres.')
    .max(60)
    .regex(/^[A-Za-z0-9._-]+$/, 'O login aceita apenas letras, números, ponto, hífen e sublinhado.'),
  email: z.string().trim().toLowerCase().min(1, 'Informe o e-mail.').max(160).email('E-mail inválido.'),
  perfil: z.enum(['usuario', 'gestor', 'desenvolvedor']).default('usuario'),
  ativo: z.boolean().default(true),
  grupos: listaIds,
  /** Sessão termina às 0h */
  sessaoMeiaNoite: z.boolean().optional(),
  /** Sessão termina após X horas sem uso; null = não expira por inatividade */
  sessaoInatividadeHoras: z.number().int().min(1, 'Informe de 1 a 720 horas de inatividade.').max(720, 'Informe de 1 a 720 horas de inatividade.').nullable().optional(),
};

const criarSchema = z.object({ ...base, senha: senhaForte });
const editarSchema = z.object(base);

const SQL_LISTA = `
  SELECT u.id, u.nome, u.login, u.email, u.perfil, u.ativo, u.ultimo_acesso, u.sessao_meia_noite, u.sessao_inatividade_horas,
         u.troca_senha_obrigatoria, (u.bloqueado_ate IS NOT NULL AND u.bloqueado_ate > NOW()) AS bloqueado,
         COALESCE(json_agg(json_build_object('id', g.id, 'nome', g.nome) ORDER BY g.nome)
                  FILTER (WHERE g.id IS NOT NULL), '[]') AS grupos
    FROM usuarios u
    LEFT JOIN usuario_grupo ug ON ug.usuario_id = u.id
    LEFT JOIN grupos_usuarios g ON g.id = ug.grupo_usuario_id`;

const paraResposta = (r: any) => ({
  id: r.id,
  nome: r.nome,
  login: r.login,
  email: r.email,
  perfil: r.perfil as Perfil,
  ativo: r.ativo,
  bloqueado: r.bloqueado,
  trocaSenhaObrigatoria: r.troca_senha_obrigatoria,
  ultimoAcesso: r.ultimo_acesso,
  grupos: r.grupos,
  sessaoMeiaNoite: r.sessao_meia_noite,
  sessaoInatividadeHoras: r.sessao_inatividade_horas,
});

async function buscar(id: number) {
  const { rows } = await query(`${SQL_LISTA} WHERE u.id = $1 GROUP BY u.id`, [id]);
  return rows[0] ? paraResposta(rows[0]) : null;
}

/** Senha temporária legível: sem caracteres ambíguos, sempre com letras e números. */
function gerarSenhaTemporaria() {
  const letras = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
  const numeros = '23456789';
  const todos = letras + numeros;
  const pick = (s: string) => s[crypto.randomInt(s.length)];
  const chars = [pick(letras), pick(numeros), ...Array.from({ length: 8 }, () => pick(todos))];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

async function contarOutrosAtivos(perfil: Perfil, exceto: number) {
  const { rows } = await query<{ n: string }>(
    'SELECT COUNT(*) AS n FROM usuarios WHERE perfil = $1 AND ativo AND id <> $2',
    [perfil, exceto],
  );
  return Number(rows[0].n);
}

async function gravarGrupos(client: any, usuarioId: number, grupos: number[]) {
  await client.query('DELETE FROM usuario_grupo WHERE usuario_id = $1', [usuarioId]);
  if (grupos.length) {
    await client.query(
      `INSERT INTO usuario_grupo (usuario_id, grupo_usuario_id)
       SELECT $1, g.id FROM grupos_usuarios g WHERE g.id = ANY($2::int[])`,
      [usuarioId, grupos],
    );
  }
}

/**
 * Só um Desenvolvedor mexe em contas de Desenvolvedor (criar, promover, editar, redefinir senha, excluir).
 * Sem isso, um Gestor poderia criar ou assumir uma conta de Desenvolvedor e chegar ao SQL.
 */
function bloqueiaGestorSobreDesenvolvedor(request: FastifyRequest, reply: FastifyReply, perfisEnvolvidos: Perfil[]) {
  if (request.user.perfil !== 'desenvolvedor' && perfisEnvolvidos.includes('desenvolvedor')) {
    reply.code(403).send({ erro: 'Somente um Desenvolvedor pode criar, alterar ou excluir usuários com perfil Desenvolvedor.' });
    return true;
  }
  return false;
}

export async function rotasUsuarios(app: FastifyInstance) {
  app.addHook('preHandler', somenteAdmin);

  app.get('/', async () => {
    const { rows } = await query(`${SQL_LISTA} GROUP BY u.id ORDER BY LOWER(u.nome)`);
    return rows.map(paraResposta);
  });

  app.post('/', async (request, reply) => {
    const d = validar(criarSchema, request.body, reply);
    if (!d) return;
    if (bloqueiaGestorSobreDesenvolvedor(request, reply, [d.perfil])) return;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const hash = await bcrypt.hash(d.senha, 12);
      const { rows } = await client.query(
        `INSERT INTO usuarios (nome, login, email, senha_hash, perfil, ativo, troca_senha_obrigatoria, sessao_meia_noite, sessao_inatividade_horas)
         VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7, $8) RETURNING id`,
        // Sem informar: sessão encerrada após 8 horas sem uso
        [d.nome, d.login, d.email, hash, d.perfil, d.ativo, d.sessaoMeiaNoite ?? false, d.sessaoInatividadeHoras === undefined ? 8 : d.sessaoInatividadeHoras],
      );
      await gravarGrupos(client, rows[0].id, d.grupos);
      await client.query('COMMIT');
      await registrarAuditoria({ usuarioId: request.user.sub, acao: 'usuario_criado', entidade: 'usuarios', detalhes: { id: rows[0].id, login: d.login, perfil: d.perfil }, ip: request.ip });
      return reply.code(201).send(await buscar(rows[0].id));
    } catch (e) {
      await client.query('ROLLBACK');
      if (ehDuplicado(e)) return reply.code(409).send({ erro: 'Já existe um usuário com esse login ou e-mail.' });
      throw e;
    } finally {
      client.release();
    }
  });

  app.put('/:id', async (request, reply) => {
    const id = lerId(request.params, reply);
    if (!id) return;
    const d = validar(editarSchema, request.body, reply);
    if (!d) return;

    const { rows: atual } = await query('SELECT * FROM usuarios WHERE id = $1', [id]);
    if (!atual[0]) return reply.code(404).send({ erro: 'Usuário não encontrado.' });
    if (bloqueiaGestorSobreDesenvolvedor(request, reply, [atual[0].perfil, d.perfil])) return;

    if (id === request.user.sub && (!d.ativo || d.perfil !== atual[0].perfil)) {
      return reply.code(400).send({ erro: 'Você não pode desativar o próprio usuário nem mudar o próprio perfil.' });
    }
    const deixaDeSerDev = atual[0].perfil === 'desenvolvedor' && atual[0].ativo && (d.perfil !== 'desenvolvedor' || !d.ativo);
    if (deixaDeSerDev && (await contarOutrosAtivos('desenvolvedor', id)) === 0) {
      return reply.code(400).send({ erro: 'É preciso manter pelo menos um Desenvolvedor ativo.' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE usuarios SET nome = $2, login = $3, email = $4, perfil = $5, ativo = $6,
                sessao_meia_noite = COALESCE($7, sessao_meia_noite),
                sessao_inatividade_horas = CASE WHEN $9 THEN $8 ELSE sessao_inatividade_horas END, atualizado_em = NOW()
          WHERE id = $1`,
        // Campo ausente (cliente antigo) mantém a política atual; null em horas = não expira por inatividade
        [id, d.nome, d.login, d.email, d.perfil, d.ativo, d.sessaoMeiaNoite ?? null, d.sessaoInatividadeHoras ?? null, d.sessaoInatividadeHoras !== undefined],
      );
      await gravarGrupos(client, id, d.grupos);
      if (!d.ativo) {
        await client.query('UPDATE refresh_tokens SET revogado_em = NOW() WHERE usuario_id = $1 AND revogado_em IS NULL', [id]);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      if (ehDuplicado(e)) return reply.code(409).send({ erro: 'Já existe um usuário com esse login ou e-mail.' });
      throw e;
    } finally {
      client.release();
    }
    await registrarAuditoria({
      usuarioId: request.user.sub,
      acao: 'usuario_alterado',
      entidade: 'usuarios',
      detalhes: { id, perfil: d.perfil, sessaoMeiaNoite: d.sessaoMeiaNoite, sessaoInatividadeHoras: d.sessaoInatividadeHoras },
      ip: request.ip,
    });
    return buscar(id);
  });

  app.post('/:id/redefinir-senha', async (request, reply) => {
    const id = lerId(request.params, reply);
    if (!id) return;
    const { rows: alvo } = await query('SELECT perfil FROM usuarios WHERE id = $1', [id]);
    if (!alvo[0]) return reply.code(404).send({ erro: 'Usuário não encontrado.' });
    if (bloqueiaGestorSobreDesenvolvedor(request, reply, [alvo[0].perfil])) return;

    const senha = gerarSenhaTemporaria();
    const hash = await bcrypt.hash(senha, 12);
    await query(
      `UPDATE usuarios SET senha_hash = $2, troca_senha_obrigatoria = TRUE, tentativas_falhas = 0,
              bloqueado_ate = NULL, atualizado_em = NOW()
        WHERE id = $1`,
      [id, hash],
    );
    await query('UPDATE refresh_tokens SET revogado_em = NOW() WHERE usuario_id = $1 AND revogado_em IS NULL', [id]);
    await registrarAuditoria({ usuarioId: request.user.sub, acao: 'senha_redefinida', entidade: 'usuarios', detalhes: { id }, ip: request.ip });
    return { senhaTemporaria: senha, usuario: await buscar(id) };
  });

  app.delete('/:id', async (request, reply) => {
    const id = lerId(request.params, reply);
    if (!id) return;
    if (id === request.user.sub) return reply.code(400).send({ erro: 'Você não pode excluir o próprio usuário.' });
    const { rows } = await query('SELECT perfil, ativo, login FROM usuarios WHERE id = $1', [id]);
    if (!rows[0]) return reply.code(404).send({ erro: 'Usuário não encontrado.' });
    if (bloqueiaGestorSobreDesenvolvedor(request, reply, [rows[0].perfil])) return;
    if (rows[0].perfil === 'desenvolvedor' && rows[0].ativo && (await contarOutrosAtivos('desenvolvedor', id)) === 0) {
      return reply.code(400).send({ erro: 'É preciso manter pelo menos um Desenvolvedor ativo.' });
    }
    await query('DELETE FROM usuarios WHERE id = $1', [id]);
    await registrarAuditoria({ usuarioId: request.user.sub, acao: 'usuario_excluido', entidade: 'usuarios', detalhes: { id, login: rows[0].login }, ip: request.ip });
    return reply.code(204).send();
  });
}
