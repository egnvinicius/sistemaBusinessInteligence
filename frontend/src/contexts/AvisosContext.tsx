import { createContext, useCallback, useContext, useState, type ReactElement, type ReactNode, type ComponentProps } from 'react';
import { CToast, CToastBody, CToaster } from '@coreui/react-pro';

type Avisar = (texto: string, tipo?: 'sucesso' | 'erro') => void;

const Ctx = createContext<Avisar>(() => undefined);

/** Avisos rápidos (toasts) no canto da tela. */
export function AvisosProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ReactElement<ComponentProps<typeof CToast>> | undefined>();

  const avisar = useCallback<Avisar>((texto, tipo = 'sucesso') => {
    setToast(
      <CToast autohide delay={tipo === 'erro' ? 6000 : 3500} color={tipo === 'erro' ? 'danger' : 'success'} className="text-white">
        <CToastBody>{texto}</CToastBody>
      </CToast>,
    );
  }, []);

  return (
    <Ctx.Provider value={avisar}>
      {children}
      <CToaster push={toast} placement="bottom-end" className="p-3" />
    </Ctx.Provider>
  );
}

export const useAvisos = () => useContext(Ctx);
