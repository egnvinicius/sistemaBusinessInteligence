import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from '../api/client';
import { aplicarCorPrimaria } from '../lib/cores';
import { APARENCIA_PADRAO, type Aparencia } from '../types';

interface AparenciaContexto {
  aparencia: Aparencia;
  carregada: boolean;
  definirAparencia: (a: Aparencia) => void;
  recarregar: () => Promise<void>;
}

const Ctx = createContext<AparenciaContexto | null>(null);

export function AparenciaProvider({ children }: { children: ReactNode }) {
  const [aparencia, setAparencia] = useState<Aparencia>(APARENCIA_PADRAO);
  const [carregada, setCarregada] = useState(false);

  const recarregar = useCallback(async () => {
    try {
      const { data } = await api.get<Aparencia>('/aparencia');
      setAparencia(data);
    } catch {
      // Sem API: segue com a aparência padrão para a tela de login não ficar em branco
    } finally {
      setCarregada(true);
    }
  }, []);

  useEffect(() => {
    recarregar();
  }, [recarregar]);

  useEffect(() => {
    aplicarCorPrimaria(aparencia.corPrimaria);
    document.title = aparencia.nomeSistema;
  }, [aparencia.corPrimaria, aparencia.nomeSistema]);

  // Ícone da aba do navegador (favicon): o enviado em Aparência ou o padrão
  useEffect(() => {
    const url = aparencia.faviconUrl ?? '/favicon.svg';
    let link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = url;
    link.type = url.endsWith('.svg') ? 'image/svg+xml' : url.endsWith('.ico') ? 'image/x-icon' : url.endsWith('.png') ? 'image/png' : url.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
  }, [aparencia.faviconUrl]);

  return (
    <Ctx.Provider value={{ aparencia, carregada, definirAparencia: setAparencia, recarregar }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAparencia() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAparencia fora do AparenciaProvider');
  return ctx;
}
