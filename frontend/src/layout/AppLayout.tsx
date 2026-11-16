import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
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
  CNavGroup,
  CNavItem,
  CNavTitle,
  CSidebar,
  CSidebarBrand,
  CSidebarFooter,
  CSidebarHeader,
  CSidebarNav,
  CSidebarToggler,
} from '@coreui/react-pro';
import CIcon from '@coreui/icons-react';
import {
  cilAccountLogout,
  cilBrush,
  cilCode,
  cilGroup,
  cilHome,
  cilListRich,
  cilLockLocked,
  cilMenu,
  cilPeople,
  cilStorage,
  cilTerminal,
  cilChartLine,
  cilFilter,
  cilLayers,
  cilLightbulb,
  cilSync, cilSettings } from '@coreui/icons';
import { AlternarTema } from '../components/AlternarTema';
import { useAparencia } from '../contexts/AparenciaContext';
import { useTema } from '../contexts/TemaContext';
import { logoDoTema } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { AvisosProvider } from '../contexts/AvisosContext';
import { MenuProvider, useMenu } from '../contexts/MenuContext';
import { iconeDoMenu } from '../lib/icones';
import { ehAdmin, ehDesenvolvedor, NOME_PERFIL, type MenuSubgrupo } from '../types';

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
  const { aparencia } = useAparencia();
  const { tema } = useTema();
  const { usuario, sair } = useAuth();
  const navigate = useNavigate();
  const [sidebarVisivel, setSidebarVisivel] = useState(true);
  const [estreita, setEstreita] = useState(false);

  if (!usuario) return null;

  return (
    <div>
      <CSidebar
        className="border-end"
        position="fixed"
        unfoldable={estreita}
        visible={sidebarVisivel}
        onVisibleChange={setSidebarVisivel}
      >
        <CSidebarHeader className="border-bottom">
          <CSidebarBrand as={NavLink} to="/" className="sidebar-marca">
            {logoDoTema(aparencia, tema) ? (
              <img src={logoDoTema(aparencia, tema)!} alt={aparencia.nomeSistema} className="sidebar-logo" />
            ) : (
              <span className="sidebar-nome">{aparencia.nomeSistema}</span>
            )}
          </CSidebarBrand>
        </CSidebarHeader>

        <CSidebarNav>
          <CNavItem>
            <NavLink to="/" end className="nav-link">
              <CIcon icon={cilHome} customClassName="nav-icon" />
              Início
            </NavLink>
          </CNavItem>

          <CNavTitle>Painéis</CNavTitle>
          <MenuPaineis />

          <CNavTitle>Análises</CNavTitle>
          <ItemAdmin para="/analises" icone={cilLightbulb} rotulo="Minhas análises" />

          {ehAdmin(usuario) && (
            <>
              <CNavTitle>Atualização de dados</CNavTitle>
              <ItemAdmin para="/dados/tarefas" icone={cilSync} rotulo="Tarefas" />
              {ehDesenvolvedor(usuario) && (
                <>
                  <ItemAdmin para="/dados/acoes" icone={cilCode} rotulo="Ações (SQL)" />
                  <ItemAdmin para="/dados/conexoes" icone={cilStorage} rotulo="Conexões" />
                  <ItemAdmin para="/dados/console" icone={cilTerminal} rotulo="Console SQL" />
                </>
              )}

              {ehDesenvolvedor(usuario) && (
                <>
                  <CNavTitle>Construção de painéis</CNavTitle>
                  <ItemAdmin para="/construcao/consultas" icone={cilChartLine} rotulo="Consultas de painel" />
                  <ItemAdmin para="/construcao/filtros" icone={cilFilter} rotulo="Filtros e listas" />
                  <ItemAdmin para="/construcao/cubos" icone={cilLayers} rotulo="Cubos" />
                </>
              )}

              <CNavTitle>Administração</CNavTitle>
              <ItemAdmin para="/admin/usuarios" icone={cilPeople} rotulo="Usuários" />
              <ItemAdmin para="/admin/grupos" icone={cilGroup} rotulo="Grupos de acesso" />
              <ItemAdmin para="/admin/menu" icone={cilListRich} rotulo="Menu e painéis" />
              <ItemAdmin para="/configuracoes/aparencia" icone={cilBrush} rotulo="Aparência" />
              {!ehDesenvolvedor(usuario) && <ItemAdmin para="/construcao/cubos" icone={cilLayers} rotulo="Cubos e uso da IA" />}
            </>
          )}
        </CSidebarNav>

        <CSidebarFooter className="border-top d-none d-lg-flex">
          <CSidebarToggler onClick={() => setEstreita((v) => !v)} aria-label="Recolher ou expandir o menu" />
        </CSidebarFooter>
      </CSidebar>

      <div className="wrapper d-flex flex-column min-vh-100">
        <CHeader position="sticky" className="mb-4 p-0">
          <CContainer fluid className="px-4">
            <CHeaderToggler
              onClick={() => setSidebarVisivel((v) => !v)}
              style={{ marginInlineStart: '-14px' }}
              aria-label="Abrir ou fechar o menu"
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

function ItemAdmin({ para, icone, rotulo }: { para: string; icone: string[]; rotulo: string }) {
  return (
    <CNavItem>
      <NavLink to={para} className="nav-link">
        <CIcon icon={icone} customClassName="nav-icon" />
        {rotulo}
      </NavLink>
    </CNavItem>
  );
}

/** Algum painel desta subárvore é o que está aberto? (para deixar o caminho expandido) */
const contemPainel = (s: MenuSubgrupo, id: number): boolean =>
  s.paineis.some((p) => p.id === id) || s.subgrupos.some((f) => contemPainel(f, id));

/** Grupo › Subgrupo (› Subgrupo…) › Painel, só com o que o usuário pode ver. */
function MenuPaineis() {
  const { menu, carregando } = useMenu();
  const { pathname } = useLocation();
  const painelAtual = Number(pathname.match(/^\/painel\/(\d+)/)?.[1] ?? 0);

  if (carregando) return null;
  if (!menu.length) return <li className="nav-vazio">Nenhum painel liberado</li>;

  return (
    <>
      {menu.map((g) => (
        <CNavGroup
          key={g.id}
          visible={g.subgrupos.some((s) => contemPainel(s, painelAtual)) || undefined}
          toggler={
            <>
              <CIcon icon={iconeDoMenu(g.icone)} customClassName="nav-icon" />
              {g.nome}
            </>
          }
        >
          {g.subgrupos.map((s) => (
            <SubgrupoNav key={s.id} s={s} nivel={1} painelAtual={painelAtual} />
          ))}
        </CNavGroup>
      ))}
    </>
  );
}

function SubgrupoNav({ s, nivel, painelAtual }: { s: MenuSubgrupo; nivel: number; painelAtual: number }) {
  return (
    <CNavGroup
      className={`nav-subgrupo nav-nivel-${nivel}`}
      visible={contemPainel(s, painelAtual) || undefined}
      toggler={
        <>
          <span className="nav-icon">
            <span className="nav-icon-bullet" />
          </span>
          {s.nome}
        </>
      }
    >
      {s.subgrupos.map((f) => (
        <SubgrupoNav key={f.id} s={f} nivel={nivel + 1} painelAtual={painelAtual} />
      ))}
      {s.paineis.map((p) => (
        <CNavItem key={p.id}>
          <NavLink to={`/painel/${p.id}`} className={`nav-link nav-painel nav-nivel-${nivel}`}>
            {p.nome}
          </NavLink>
        </CNavItem>
      ))}
    </CNavGroup>
  );
}
