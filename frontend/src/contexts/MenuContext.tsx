import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from '../api/client';
import type { MenuGrupo } from '../types';

interface MenuContexto {
  menu: MenuGrupo[];
  carregando: boolean;
  recarregarMenu: () => Promise<void>;
}

const Ctx = createContext<MenuContexto | null>(null);

/** Menu Grupo › Subgrupo › Painel do usuário logado, já filtrado pelo backend. */
export function MenuProvider({ children }: { children: ReactNode }) {
  const [menu, setMenu] = useState<MenuGrupo[]>([]);
  const [carregando, setCarregando] = useState(true);

  const recarregarMenu = useCallback(async () => {
    try {
      const { data } = await api.get<MenuGrupo[]>('/menu');
      setMenu(data);
    } catch {
      setMenu([]);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    recarregarMenu();
  }, [recarregarMenu]);

  return <Ctx.Provider value={{ menu, carregando, recarregarMenu }}>{children}</Ctx.Provider>;
}

export function useMenu() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useMenu fora do MenuProvider');
  return ctx;
}
