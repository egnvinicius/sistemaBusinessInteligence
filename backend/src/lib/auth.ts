import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { query } from '../db/pool.js';
import { config } from '../config.js';
import { limiteDaSessao, type PoliticaSessao } from './sessao.js';

export type Perfil = 'usuario' | 'gestor' | 'desenvolvedor';

/** Gestor e Desenvolvedor veem todos os painéis e acessam a administração. */
export const PERFIS_ADMIN: Perfil[] = ['gestor', 'desenvolvedor'];

export interface TokenPayload {
  sub: number;
  login: string;
  perfil: Perfil;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: TokenPayload;
    user: TokenPayload;
  }
}

export interface UsuarioPublico {
  id: number;
  nome: string;
  email: string | null;
  login: string;
  perfil: Perfil;
  temaPreferido: 'claro' | 'escuro' | null;
  trocaSenhaObrigatoria: boolean;
  /** Cadastros antigos sem e-mail precisam informá-lo antes de usar o sistema. */
  emailPendente: boolean;
  /** Política de sessão do usuário (a tela avisa e encerra no momento certo) */
  sessao: { meiaNoite: boolean; inatividadeHoras: number | null };
}

export function paraUsuarioPublico(row: any): UsuarioPublico {
  return {
    id: row.id,
    nome: row.nome,
    email: row.email,
    login: row.login,
    perfil: row.perfil,
    temaPreferido: row.tema_preferido,
    trocaSenhaObrigatoria: row.troca_senha_obrigatoria,
    emailPendente: !row.email,
    sessao: { meiaNoite: !!row.sessao_meia_noite, inatividadeHoras: row.sessao_inatividade_horas ?? null },
  };
}

export const NOME_COOKIE_REFRESH = 'bi_refresh';

const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

/**
 * Gera um refresh token opaco, guarda só o hash no banco e grava o cookie httpOnly.
 * A validade segue a política de sessão do usuário (meia-noite, inatividade ou sem expirar).
 * Devolve até quando a sessão vale.
 */
export async function emitirRefreshToken(reply: FastifyReply, usuario: PoliticaSessao & { id: number }, ultimaAtividade = new Date()) {
  const token = crypto.randomBytes(48).toString('base64url');
  const { expira, motivo } = limiteDaSessao(usuario, ultimaAtividade);
  await query(
    'INSERT INTO refresh_tokens (usuario_id, token_hash, expira_em, ultima_atividade_em, motivo_expiracao) VALUES ($1, $2, $3, $4, $5)',
    [usuario.id, hashToken(token), expira, ultimaAtividade, motivo],
  );
  reply.setCookie(NOME_COOKIE_REFRESH, token, {
    httpOnly: true,
    secure: config.cookieSeguro,
    sameSite: 'strict',
    path: '/api/auth',
    expires: expira,
  });
  return expira;
}

/**
 * Valida e revoga (rotação) o refresh token do cookie. Devolve o usuário e a última atividade
 * da sessão; se o token venceu, devolve o motivo (meia-noite ou inatividade).
 */
export async function consumirRefreshToken(
  token: string | undefined,
): Promise<{ usuarioId: number; ultimaAtividade: Date } | { motivo: string | null }> {
  if (!token) return { motivo: null };
  const { rows } = await query<{ usuario_id: number; ultima_atividade_em: Date }>(
    `UPDATE refresh_tokens SET revogado_em = NOW()
      WHERE token_hash = $1 AND revogado_em IS NULL AND expira_em > NOW()
      RETURNING usuario_id, ultima_atividade_em`,
    [hashToken(token)],
  );
  if (rows[0]) return { usuarioId: rows[0].usuario_id, ultimaAtividade: rows[0].ultima_atividade_em };
  const { rows: vencido } = await query<{ motivo_expiracao: string | null }>(
    'SELECT motivo_expiracao FROM refresh_tokens WHERE token_hash = $1 AND revogado_em IS NULL AND expira_em <= NOW()',
    [hashToken(token)],
  );
  return { motivo: vencido[0]?.motivo_expiracao ?? null };
}

/** Revoga o refresh token do cookie e devolve de quem era (ou null). */
export async function revogarRefreshToken(token: string | undefined): Promise<number | null> {
  if (!token) return null;
  const { rows } = await query<{ usuario_id: number }>(
    'UPDATE refresh_tokens SET revogado_em = NOW() WHERE token_hash = $1 AND revogado_em IS NULL RETURNING usuario_id',
    [hashToken(token)],
  );
  return rows[0]?.usuario_id ?? null;
}

export function limparCookieRefresh(reply: FastifyReply) {
  reply.clearCookie(NOME_COOKIE_REFRESH, { path: '/api/auth' });
}

/** preHandler: exige access token válido. */
export async function autenticado(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch {
    return reply.code(401).send({ erro: 'Sessão expirada ou inválida.' });
  }
}

/**
 * preHandler: exige sessão válida e um dos perfis informados.
 * O perfil é conferido no banco a cada requisição (não só no token),
 * para que uma mudança de perfil ou desativação valha na hora.
 */
export function requerPerfil(...perfis: Perfil[]) {
  return async function (request: FastifyRequest, reply: FastifyReply) {
    try {
      await request.jwtVerify();
    } catch {
      return reply.code(401).send({ erro: 'Sessão expirada ou inválida.' });
    }
    const { rows } = await query<{ perfil: Perfil }>('SELECT perfil FROM usuarios WHERE id = $1 AND ativo', [
      request.user.sub,
    ]);
    if (!rows[0]) return reply.code(401).send({ erro: 'Usuário inativo.' });
    request.user.perfil = rows[0].perfil;
    if (!perfis.includes(rows[0].perfil)) {
      return reply.code(403).send({ erro: 'Seu perfil não tem acesso a esta área.' });
    }
  };
}

/** Gestor ou Desenvolvedor. */
export const somenteAdmin = requerPerfil('gestor', 'desenvolvedor');

/** SQL, conexões e tabelas: só Desenvolvedor. */
export const somenteDesenvolvedor = requerPerfil('desenvolvedor');
