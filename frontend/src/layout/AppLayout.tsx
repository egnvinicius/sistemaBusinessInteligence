import { useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import {
  CAvatar,
  CContainer,
  CDropdown,
  CDropdownDivider,
  CDropdownHeader,
  CDropdownItem,
  CDropdownMenu,
  CDropdownToggle,
  CHeader,
  CHeaderNav,
  CHeaderToggler,
} from '@coreui/react-pro';
import CIcon from '@coreui/icons-react';
import { cilAccountLogout, cilLockLocked, cilMenu, cilSettings } from '@coreui/icons';
import { AlternarTema } from '../components/AlternarTema';
import { useAuth } from '../contexts/AuthContext';
import { AvisosProvider } from '../contexts/AvisosContext';
import { MenuProvider } from '../contexts/MenuContext';
import { NOME_PERFIL } from '../types';
import { BarraLateral, gravarRecolhida, lerRecolhida } from './BarraLateral';

const iniciais = (nome: string) =>
  nome
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');

export function AppLayout() {
  return (
    <MenuProvider>
      <AvisosProvider>
        <Estrutura />
      </AvisosProvider>
    </MenuProvider>
  );
}

function Estrutura() {
  const { usuario, sair } = useAuth();
  const navigate = useNavigate();
  // Recolhida (só ícones) fica guardada no navegador; a gaveta do celular começa fechada
  const [recolhida, setRecolhida] = useState(lerRecolhida);
  const [gavetaAberta, setGavetaAberta] = useState(false);

  if (!usuario) return null;

  return (
    <div className={`app${recolhida ? ' barra-recolhida' : ''}`}>
      <BarraLateral
        recolhida={recolhida}
        onRecolher={() =>
          setRecolhida((v) => {
            gravarRecolhida(!v);
            return !v;
          })
        }
        aberta={gavetaAberta}
        onFechar={() => setGavetaAberta(false)}
      />

      <div className="wrapper d-flex flex-column min-vh-100">
        <CHeader position="sticky" className="mb-4 p-0">
          <CContainer fluid className="px-4">
            <CHeaderToggler
              className="d-lg-none"
              onClick={() => setGavetaAberta(true)}
              style={{ marginInlineStart: '-14px' }}
              aria-label="Abrir o menu"
            >
              <CIcon icon={cilMenu} size="lg" />
            </CHeaderToggler>
            <CHeaderNav className="ms-auto align-items-center gap-2">
              <AlternarTema />
              <CDropdown variant="nav-item" alignment="end">
                <CDropdownToggle caret={false} className="py-0 pe-0 d-flex align-items-center gap-2">
                  <span className="d-none d-md-inline text-body">{usuario.nome}</span>
                  <CAvatar color="primary" textColor="white" size="md">
                    {iniciais(usuario.nome)}
                  </CAvatar>
                </CDropdownToggle>
                <CDropdownMenu className="pt-0">
                  <CDropdownHeader className="bg-body-secondary fw-semibold mb-2">
                    {usuario.login} · {NOME_PERFIL[usuario.perfil]}
                  </CDropdownHeader>
                  <CDropdownItem as="button" onClick={() => navigate('/configuracoes')}>
                    <CIcon icon={cilSettings} className="me-2" />
                    Configurações
                  </CDropdownItem>
                  <CDropdownItem as="button" onClick={() => navigate('/trocar-senha')}>
                    <CIcon icon={cilLockLocked} className="me-2" />
                    Trocar senha
                  </CDropdownItem>
                  <CDropdownDivider />
                  <CDropdownItem as="button" onClick={() => sair().then(() => navigate('/login'))}>
                    <CIcon icon={cilAccountLogout} className="me-2" />
                    Sair
                  </CDropdownItem>
                </CDropdownMenu>
              </CDropdown>
            </CHeaderNav>
          </CContainer>
        </CHeader>
        <div className="body flex-grow-1">
          <CContainer lg className="px-4 pb-5">
            <Outlet />
          </CContainer>
        </div>
      </div>
    </div>
  );
}
