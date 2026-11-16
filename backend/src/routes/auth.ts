import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { config } from '../config.js';
import { MENSAGEM_EXPIRACAO } from '../lib/sessao.js';
import {
  NOME_COOKIE_REFRESH,
  autenticado,
  consumirRefreshToken,
  emitirRefreshToken,
  limparCookieRefresh,
  paraUsuarioPublico,
  revogarRefreshToken,
} from '../lib/auth.js';
import { registrarAuditoria } from '../lib/auditoria.js';
import { encerrarSessaoConsole } from './console.js';
import { ErroGoogle, validarTokenGoogle } from '../lib/google.js';

const ERRO_CREDENCIAIS = 'Usuário ou senha inválidos.';

const loginSchema = z.object({
  login: z.string().trim().min(1).max(60),
  senha: z.string().min(1).max(200),
});

const trocarSenhaSchema = z.object({
  senhaAtual: z.string().min(1),
  novaSenha: z
    .string()
    .min(8, 'A nova senha deve ter ao menos 8 caracteres.')
    .max(200)
    .regex(/[A-Za-z]/, 'A nova senha deve conter letras.')
    .regex(/[0-9]/, 'A nova senha deve conter números.'),
});

const emailSchema = z.object({
  email: z.string().trim().toLowerCase().max(160).email('Informe um e-mail válido.'),
});

const preferenciasSchema = z.object({
  tema: z.enum(['claro', 'escuro']).nullable(),
});

// Hash fixo usado quando o usuário não existe, para o tempo de resposta não revelar isso
const HASH_FICTICIO = bcrypt.hashSync('senha-ficticia-para-tempo-constante', 12);

export async function rotasAuth(app: FastifyInstance) {
  /** Access token curto, que nunca passa do fim da sessão (ex.: meia-noite). */
  const assinarAccess = (u: any, fimSessao: Date) => {
    const segundos = Math.max(5, Math.min(config.accessTokenMinutos * 60, Math.floor((fimSessao.getTime() - Date.now()) / 1000)));
    return app.jwt.sign({ sub: u.id, login: u.login, perfil: u.perfil }, { expiresIn: segundos });
  };
  const sessao = (u: any, expira: Date) => ({ accessToken: assinarAccess(u, expira), usuario: paraUsuarioPublico(u), expiraEm: expira.toISOString() });

  // ---------- LOGIN ----------
  app.post(
    '/login',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const corpo = loginSchema.safeParse(request.body);
      if (!corpo.success) return reply.code(400).send({ erro: 'Informe usuário e senha.' });
      const { login, senha } = corpo.data;

      const { rows } = await query('SELECT * FROM usuarios WHERE LOWER(login) = LOWER($1)', [login]);
      const usuario = rows[0];

      if (!usuario) {
        await bcrypt.compare(senha, HASH_FICTICIO);
        await registrarAuditoria({ acao: 'login_falhou', detalhes: { login }, ip: request.ip });
        return reply.code(401).send({ erro: ERRO_CREDENCIAIS });
      }

      if (usuario.bloqueado_ate && new Date(usuario.bloqueado_ate) > new Date()) {
        const minutos = Math.ceil((new Date(usuario.bloqueado_ate).getTime() - Date.now()) / 60000);
        return reply
          .code(423)
          .send({ erro: `Acesso bloqueado temporariamente por excesso de tentativas. Tente novamente em ${minutos} min.` });
      }

      const senhaOk = await bcrypt.compare(senha, usuario.senha_hash);
      if (!senhaOk || !usuario.ativo) {
        const tentativas = usuario.tentativas_falhas + 1;
        const bloquear = tentativas >= config.maxTentativasLogin;
        await query(
          `UPDATE usuarios SET tentativas_falhas = $2,
             bloqueado_ate = CASE WHEN $3 THEN NOW() + ($4 || ' minutes')::interval ELSE bloqueado_ate END
           WHERE id = $1`,
          [usuario.id, bloquear ? 0 : tentativas, bloquear, String(config.bloqueioMinutos)],
        );
        await registrarAuditoria({
          usuarioId: usuario.id,
          acao: bloquear ? 'login_bloqueado' : 'login_falhou',
          ip: request.ip,
        });
        return reply.code(401).send({ erro: ERRO_CREDENCIAIS });
      }

      const { rows: atualizado } = await query(
        `UPDATE usuarios SET tentativas_falhas = 0, bloqueado_ate = NULL, ultimo_acesso = NOW()
          WHERE id = $1 RETURNING *`,
        [usuario.id],
      );
      const expira = await emitirRefreshToken(reply, atualizado[0]);
      await registrarAuditoria({ usuarioId: usuario.id, acao: 'login', ip: request.ip });

      return sessao(atualizado[0], expira);
    },
  );

  // ---------- LOGIN COM GOOGLE ----------
  /** Configuração pública para a tela de login (mostrar ou não o botão). */
  app.get('/google/config', async () => ({ clientId: config.googleClientId || null, dominio: config.googleDominio || null }));

  app.post(
    '/google',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const corpo = z.object({ credencial: z.string().min(20).max(5000) }).safeParse(request.body);
      if (!corpo.success) return reply.code(400).send({ erro: 'Login com Google inválido.' });
      let conta;
      try {
        conta = await validarTokenGoogle(corpo.data.credencial);
      } catch (e) {
        if (e instanceof ErroGoogle) {
          await registrarAuditoria({ acao: 'login_google_falhou', detalhes: { motivo: e.message }, ip: request.ip });
          return reply.code(401).send({ erro: e.message });
        }
        throw e;
      }
      // Só entra quem já está cadastrado e ativo, pelo e-mail
      const { rows } = await query('SELECT * FROM usuarios WHERE LOWER(email) = $1', [conta.email]);
      const usuario = rows[0];
      if (!usuario || !usuario.ativo) {
        await registrarAuditoria({ acao: 'login_google_falhou', detalhes: { email: conta.email, motivo: usuario ? 'inativo' : 'sem cadastro' }, ip: request.ip });
        return reply.code(403).send({
          erro: `A conta ${conta.email} não tem acesso a esta ferramenta. Peça a um administrador para cadastrar ou ativar esse e-mail.`,
        });
      }
      const { rows: atualizado } = await query(
        `UPDATE usuarios SET tentativas_falhas = 0, bloqueado_ate = NULL, ultimo_acesso = NOW() WHERE id = $1 RETURNING *`,
        [usuario.id],
      );
      const expira = await emitirRefreshToken(reply, atualizado[0]);
      await registrarAuditoria({ usuarioId: usuario.id, acao: 'login_google', ip: request.ip });
      return sessao(atualizado[0], expira);
    },
  );

  // ---------- RENOVAR SESSÃO ----------
  app.post('/refresh', async (request, reply) => {
    // automatico = renovação pedida por atualização automática (painel em tela cheia, listas que se
    // atualizam sozinhas): não conta como uso, para não segurar a sessão de quem saiu de perto
    const automatico = (request.body as { automatico?: unknown } | null)?.automatico === true;
    const r = await consumirRefreshToken(request.cookies[NOME_COOKIE_REFRESH]);
    if (!('usuarioId' in r)) {
      limparCookieRefresh(reply);
      return reply.code(401).send({ erro: (r.motivo && MENSAGEM_EXPIRACAO[r.motivo]) || 'Sessão expirada.', motivo: r.motivo });
    }
    const { rows } = await query('SELECT * FROM usuarios WHERE id = $1 AND ativo', [r.usuarioId]);
    if (!rows[0]) {
      limparCookieRefresh(reply);
      return reply.code(401).send({ erro: 'Usuário inativo.' });
    }
    const expira = await emitirRefreshToken(reply, rows[0], automatico ? new Date(r.ultimaAtividade) : new Date());
    return sessao(rows[0], expira);
  });

  // ---------- SAIR ----------
  app.post('/logout', async (request, reply) => {
    const usuarioId = await revogarRefreshToken(request.cookies[NOME_COOKIE_REFRESH]);
    // Transação aberta no Console SQL não sobrevive ao "Sair"
    if (usuarioId) await encerrarSessaoConsole(usuarioId, 'rollback', 'Desfeita porque o usuário saiu do sistema.');
    limparCookieRefresh(reply);
    return { ok: true };
  });

  // ---------- USUÁRIO ATUAL ----------
  app.get('/me', { preHandler: autenticado }, async (request, reply) => {
    const { rows } = await query('SELECT * FROM usuarios WHERE id = $1 AND ativo', [request.user.sub]);
    if (!rows[0]) return reply.code(401).send({ erro: 'Usuário inativo.' });
    return { usuario: paraUsuarioPublico(rows[0]) };
  });

  // ---------- TROCAR SENHA ----------
  app.post('/trocar-senha', { preHandler: autenticado }, async (request, reply) => {
    const corpo = trocarSenhaSchema.safeParse(request.body);
    if (!corpo.success) return reply.code(400).send({ erro: corpo.error.issues[0].message });

    const { rows } = await query('SELECT * FROM usuarios WHERE id = $1', [request.user.sub]);
    const usuario = rows[0];
    if (!usuario || !(await bcrypt.compare(corpo.data.senhaAtual, usuario.senha_hash))) {
      return reply.code(400).send({ erro: 'Senha atual incorreta.' });
    }
    if (corpo.data.senhaAtual === corpo.data.novaSenha) {
      return reply.code(400).send({ erro: 'A nova senha deve ser diferente da atual.' });
    }

    const hash = await bcrypt.hash(corpo.data.novaSenha, 12);
    const { rows: atualizado } = await query(
      `UPDATE usuarios SET senha_hash = $2, troca_senha_obrigatoria = FALSE, atualizado_em = NOW()
        WHERE id = $1 RETURNING *`,
      [usuario.id, hash],
    );
    // Encerra as outras sessões do usuário
    await query('UPDATE refresh_tokens SET revogado_em = NOW() WHERE usuario_id = $1 AND revogado_em IS NULL', [
      usuario.id,
    ]);
    await emitirRefreshToken(reply, atualizado[0]);
    await registrarAuditoria({ usuarioId: usuario.id, acao: 'senha_alterada', ip: request.ip });
    return { usuario: paraUsuarioPublico(atualizado[0]) };
  });

  // ---------- COMPLETAR CADASTRO (e-mail obrigatório) ----------
  app.post('/completar-cadastro', { preHandler: autenticado }, async (request, reply) => {
    const corpo = emailSchema.safeParse(request.body);
    if (!corpo.success) return reply.code(400).send({ erro: corpo.error.issues[0].message });
    try {
      const { rows } = await query(
        'UPDATE usuarios SET email = $2, atualizado_em = NOW() WHERE id = $1 AND ativo RETURNING *',
        [request.user.sub, corpo.data.email],
      );
      if (!rows[0]) return reply.code(401).send({ erro: 'Usuário inativo.' });
      await registrarAuditoria({ usuarioId: request.user.sub, acao: 'email_informado', ip: request.ip });
      return { usuario: paraUsuarioPublico(rows[0]) };
    } catch (e) {
      if ((e as { code?: string }).code === '23505') {
        return reply.code(409).send({ erro: 'Este e-mail já está em uso por outro usuário.' });
      }
      throw e;
    }
  });

  // ---------- PREFERÊNCIAS (tema) ----------
  app.patch('/me/preferencias', { preHandler: autenticado }, async (request, reply) => {
    const corpo = preferenciasSchema.safeParse(request.body);
    if (!corpo.success) return reply.code(400).send({ erro: 'Tema inválido.' });
    const { rows } = await query(
      'UPDATE usuarios SET tema_preferido = $2, atualizado_em = NOW() WHERE id = $1 RETURNING *',
      [request.user.sub, corpo.data.tema],
    );
    return { usuario: paraUsuarioPublico(rows[0]) };
  });
}
