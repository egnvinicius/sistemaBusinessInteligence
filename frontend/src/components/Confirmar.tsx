import { useState, type ReactNode } from 'react';
import { CButton, CLoadingButton, CModal, CModalBody, CModalFooter, CModalHeader, CModalTitle } from '@coreui/react-pro';

interface Props {
  visivel: boolean;
  titulo: string;
  children: ReactNode;
  acao: string;
  perigoso?: boolean;
  onConfirmar: () => Promise<unknown> | void;
  onFechar: () => void;
}

export function Confirmar({ visivel, titulo, children, acao, perigoso, onConfirmar, onFechar }: Props) {
  const [executando, setExecutando] = useState(false);
  return (
    <CModal visible={visivel} onClose={onFechar} alignment="center">
      <CModalHeader>
        <CModalTitle>{titulo}</CModalTitle>
      </CModalHeader>
      <CModalBody>{children}</CModalBody>
      <CModalFooter>
        <CButton color="secondary" variant="ghost" onClick={onFechar} disabled={executando}>
          Cancelar
        </CButton>
        <CLoadingButton
          color={perigoso ? 'danger' : 'primary'}
          loading={executando}
          onClick={async () => {
            setExecutando(true);
            try {
              await onConfirmar();
            } finally {
              setExecutando(false);
            }
          }}
        >
          {acao}
        </CLoadingButton>
      </CModalFooter>
    </CModal>
  );
}
