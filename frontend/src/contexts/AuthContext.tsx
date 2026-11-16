import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  api,
  definirAccessToken,
  definirAoExpirarSessao,
  marcarInteracao,
  registrarSessao,
  renovarSessao,
  sessaoExpiraEm,
  ultimaInteracao,
  ultimaRenovacaoEm,
} from '../api/client';
import type { SessaoResposta, Usuario } from '../types';

interface AuthContexto {
  usuario: Usuario | null;
  iniciando: boolean;
  entrar: (login: string, senha: string) => Promise<Usuario>;
  entrarComGoogle: (credencial: string) => Promise<Usuario>;
  sair: () => Promise<void>;
  atualizarUsuario: (u: Usuario) => void;
}

const Ctx = createContext<AuthContexto | null>(null);

/** setTimeout não aceita mais que ~24 dias; sessões mais longas são renovadas pelo uso. */
const MAIOR_ESPERA = 20 * 24 * 3_600_000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [iniciando, setIniciando] = useState(true);
  // Muda a cada login/renovação, para reagendar o fim da sessão
  const [expiraEm, setExpiraEm] = useState<string | null>(null);
  const expiraRef = useRef<string | null>(null);

  const aplicar = useCallback((s: SessaoResposta) => {
    registrarSessao(s);
    setUsuario(s.usuario);
    setExpiraEm(s.expiraEm ?? null);
    return s.usuario;
  }, []);

  // Ao abrir a aplicação, tenta retomar a sessão pelo cookie de refresh
  useEffect(() => {
    renovarSessao()
      .then((s) => {
        if (s) aplicar(s);
      })
      .finally(() => setIniciando(false));
    definirAoExpirarSessao(() => {
      definirAccessToken(null);
      setUsuario(null);
      setExpiraEm(null);
    });
  }, [aplicar]);

  // Renovações feitas pelo próprio cliente (ao receber 401) também mudam a validade
  expiraRef.current = expiraEm;
  useEffect(() => {
    if (!usuario) return;
    const t = window.setInterval(() => {
      const atual = sessaoExpiraEm();
      if (atual && atual !== expiraRef.current) setExpiraEm(atual);
    }, 15_000);
    return () => window.clearInterval(t);
  }, [usuario]);

  // Uso da tela: clique, tecla, toque ou rolagem (o mouse parado não conta)
  useEffect(() => {
    if (!usuario) return;
    let ultima = 0;
    const h = () => {
      if (Date.now() - ultima < 20_000) return;
      ultima = Date.now();
      marcarInteracao();
    };
    const eventos = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    eventos.forEach((e) => window.addEventListener(e, h, { passive: true }));
    return () => eventos.forEach((e) => window.removeEventListener(e, h));
  }, [usuario]);

  /**
   * Fim da sessão (meia-noite ou inatividade). Um minuto antes: se houve uso desde a última
   * renovação, renova (estende a inatividade); se não houve, ou se não dá para estender
   * (meia-noite), espera o fim e confirma com o servidor, que encerra com o motivo.
   */
  useEffect(() => {
    if (!usuario || !expiraEm) return;
    const fim = new Date(expiraEm).getTime();
    const antes = fim - Date.now() - 60_000;
    if (antes > MAIOR_ESPERA) return;
    let cancelado = false;
    let segundo: number | undefined;
    const encerrar = async () => {
      const s = await renovarSessao(true);
      if (cancelado) return;
      if (s && new Date(s.expiraEm ?? 0).getTime() > fim) aplicar(s); // outra aba usou a sessão
      else {
        definirAccessToken(null);
        setUsuario(null);
        setExpiraEm(null);
      }
    };
    const primeiro = window.setTimeout(async () => {
      if (ultimaInteracao() > ultimaRenovacaoEm()) {
        const s = await renovarSessao(false);
        if (cancelado) return;
        if (s && new Date(s.expiraEm ?? 0).getTime() > fim) {
          aplicar(s);
          return;
        }
      }
      segundo = window.setTimeout(encerrar, Math.max(0, fim - Date.now() + 1_500));
    }, Math.max(0, antes));
    return () => {
      cancelado = true;
      window.clearTimeout(primeiro);
      window.clearTimeout(segundo);
    };
  }, [usuario?.id, expiraEm, aplicar]); // eslint-disable-line react-hooks/exhaustive-deps

  const entrar = useCallback(
    async (login: string, senha: string) => aplicar((await api.post<SessaoResposta>('/auth/login', { login, senha })).data),
    [aplicar],
  );

  const entrarComGoogle = useCallback(
    async (credencial: string) => aplicar((await api.post<SessaoResposta>('/auth/google', { credencial })).data),
    [aplicar],
  );

  const sair = useCallback(async () => {
    await api.post('/auth/logout').catch(() => undefined);
    definirAccessToken(null);
    setUsuario(null);
    setExpiraEm(null);
  }, []);

  return (
    <Ctx.Provider value={{ usuario, iniciando, entrar, entrarComGoogle, sair, atualizarUsuario: setUsuario }}>{children}</Ctx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth fora do AuthProvider');
  return ctx;
}
