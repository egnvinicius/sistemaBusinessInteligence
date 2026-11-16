import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import type { SessaoResposta } from '../types';

/** Access token fica só em memória; o refresh token vive num cookie httpOnly. */
let accessToken: string | null = null;
export const definirAccessToken = (token: string | null) => {
  accessToken = token;
};
/** Para chamadas fora do axios (ex.: fetch keepalive ao fechar a página). */
export const obterAccessToken = () => accessToken;

export const api = axios.create({ baseURL: '/api', withCredentials: true });

api.interceptors.request.use((cfg) => {
  if (accessToken) cfg.headers.Authorization = `Bearer ${accessToken}`;
  return cfg;
});

/**
 * Chamadas automáticas (painel em tela cheia, listas que se atualizam sozinhas) levam este cabeçalho:
 * a renovação de sessão que elas disparam não conta como uso, para a sessão expirar por inatividade.
 */
export const AUTOMATICO = { headers: { 'X-Automatico': '1' } };

/* ---------- Estado da sessão (para encerrar no momento certo) ---------- */

const CHAVE_INTERACAO = 'bi_ultima_interacao';
const CHAVE_MOTIVO = 'bi_motivo_saida';
let ultimaRenovacao = 0;
let expiraEm: string | null = null;

/** Última vez que a pessoa mexeu na tela (compartilhada entre abas). */
export function marcarInteracao() {
  try {
    localStorage.setItem(CHAVE_INTERACAO, String(Date.now()));
  } catch {
    /* sem armazenamento: vale só esta aba */
  }
  interacaoLocal = Date.now();
}
let interacaoLocal = Date.now();
export function ultimaInteracao() {
  try {
    return Math.max(interacaoLocal, Number(localStorage.getItem(CHAVE_INTERACAO) ?? 0));
  } catch {
    return interacaoLocal;
  }
}
export const ultimaRenovacaoEm = () => ultimaRenovacao;
export const sessaoExpiraEm = () => expiraEm;

/** Guarda o que veio do login ou da renovação. */
export function registrarSessao(s: SessaoResposta) {
  definirAccessToken(s.accessToken);
  ultimaRenovacao = Date.now();
  expiraEm = s.expiraEm ?? null;
  try {
    sessionStorage.removeItem(CHAVE_MOTIVO); // entrou de novo: o aviso já cumpriu o papel
  } catch {
    /* nada */
  }
}

/** Motivo da última saída forçada (meia-noite, inatividade), mostrado na tela de login até entrar de novo. */
export function lerMotivoSaida() {
  try {
    return sessionStorage.getItem(CHAVE_MOTIVO);
  } catch {
    return null;
  }
}
function guardarMotivoSaida(m: string) {
  try {
    sessionStorage.setItem(CHAVE_MOTIVO, m);
  } catch {
    /* sem armazenamento: só não mostra o aviso */
  }
}

// Uma única renovação em andamento por vez (evita girar o refresh token duas vezes)
let renovacaoEmAndamento: Promise<SessaoResposta | null> | null = null;

export function renovarSessao(automatico = false): Promise<SessaoResposta | null> {
  if (!renovacaoEmAndamento) {
    renovacaoEmAndamento = axios
      .post<SessaoResposta>('/api/auth/refresh', { automatico }, { withCredentials: true })
      .then((r) => {
        registrarSessao(r.data);
        return r.data;
      })
      .catch((e: AxiosError<{ erro?: string; motivo?: string | null }>) => {
        definirAccessToken(null);
        expiraEm = null;
        if (e.response?.data?.motivo && e.response.data.erro) guardarMotivoSaida(e.response.data.erro);
        return null;
      })
      .finally(() => {
        renovacaoEmAndamento = null;
      });
  }
  return renovacaoEmAndamento;
}

let aoExpirarSessao: () => void = () => undefined;
export const definirAoExpirarSessao = (fn: () => void) => {
  aoExpirarSessao = fn;
};

const ROTAS_SEM_RENOVACAO = ['/auth/login', '/auth/refresh', '/auth/logout'];

api.interceptors.response.use(
  (r) => r,
  async (erro: AxiosError) => {
    const cfg = erro.config as (InternalAxiosRequestConfig & { _repetida?: boolean }) | undefined;
    if (
      erro.response?.status === 401 &&
      cfg &&
      !cfg._repetida &&
      !ROTAS_SEM_RENOVACAO.some((r) => cfg.url?.startsWith(r))
    ) {
      cfg._repetida = true;
      const sessao = await renovarSessao(cfg.headers?.['X-Automatico'] === '1');
      if (sessao) return api(cfg);
      aoExpirarSessao();
    }
    return Promise.reject(erro);
  },
);

export function mensagemDeErro(erro: unknown, padrao = 'Não foi possível concluir a operação.') {
  if (axios.isAxiosError(erro)) {
    if (!erro.response) return 'Sem conexão com o servidor. Verifique a rede e tente novamente.';
    return (erro.response.data as { erro?: string })?.erro ?? padrao;
  }
  return padrao;
}
