import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from '../api/client';
import type { Tema, Usuario } from '../types';
import { useAparencia } from './AparenciaContext';
import { useAuth } from './AuthContext';

/** Mesma chave lida pelo script em index.html, que aplica o tema antes do React carregar. */
export const CHAVE_TEMA = 'bi:tema';

const lerLocal = (): Tema | null => {
  try {
    const v = localStorage.getItem(CHAVE_TEMA);
    return v === 'claro' || v === 'escuro' ? v : null;
  } catch {
    return null;
  }
};

const gravarLocal = (t: Tema) => {
  try {
    localStorage.setItem(CHAVE_TEMA, t);
  } catch {
    /* navegação privada: segue só em memória */
  }
};

const temaDoSistema = (): Tema =>
  window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'escuro' : 'claro';

interface TemaContexto {
  tema: Tema;
  alternarTema: () => void;
}

const Ctx = createContext<TemaContexto | null>(null);

/**
 * Ordem de decisão:
 * 1. escolha do usuário (salva no perfil e no navegador)
 * 2. tema padrão definido pelo administrador
 * 3. preferência do sistema operacional
 */
export function TemaProvider({ children }: { children: ReactNode }) {
  const { aparencia } = useAparencia();
  const { usuario, atualizarUsuario } = useAuth();
  const [escolha, setEscolha] = useState<Tema | null>(lerLocal);
  const [doSistema, setDoSistema] = useState<Tema>(temaDoSistema);

  // Quando o usuário entra, a preferência do perfil dele vence
  useEffect(() => {
    if (usuario?.temaPreferido) {
      setEscolha(usuario.temaPreferido);
      gravarLocal(usuario.temaPreferido);
    }
  }, [usuario?.temaPreferido]);

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const ouvir = () => setDoSistema(mq.matches ? 'escuro' : 'claro');
    mq.addEventListener('change', ouvir);
    return () => mq.removeEventListener('change', ouvir);
  }, []);

  const padraoAdmin = aparencia.temaPadrao === 'sistema' ? doSistema : aparencia.temaPadrao;
  const tema: Tema = escolha ?? padraoAdmin;

  useEffect(() => {
    document.documentElement.setAttribute('data-coreui-theme', tema === 'escuro' ? 'dark' : 'light');
  }, [tema]);

  const alternarTema = useCallback(() => {
    const novo: Tema = tema === 'claro' ? 'escuro' : 'claro';
    setEscolha(novo);
    gravarLocal(novo);
    if (usuario) {
      api
        .patch<{ usuario: Usuario }>('/auth/me/preferencias', { tema: novo })
        .then((r) => atualizarUsuario(r.data.usuario))
        .catch(() => undefined);
    }
  }, [tema, usuario, atualizarUsuario]);

  return <Ctx.Provider value={{ tema, alternarTema }}>{children}</Ctx.Provider>;
}

export function useTema() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useTema fora do TemaProvider');
  return ctx;
}
