import { CButton } from '@coreui/react-pro';
import CIcon from '@coreui/icons-react';
import { cilMoon, cilSun } from '@coreui/icons';
import { useTema } from '../contexts/TemaContext';

export function AlternarTema({ className }: { className?: string }) {
  const { tema, alternarTema } = useTema();
  const proximo = tema === 'claro' ? 'escuro' : 'claro';
  return (
    <CButton
      className={`alternar-tema ${className ?? ''}`}
      onClick={alternarTema}
      aria-label={`Usar tema ${proximo}`}
      title={`Usar tema ${proximo}`}
    >
      <CIcon icon={tema === 'claro' ? cilMoon : cilSun} size="lg" />
    </CButton>
  );
}
