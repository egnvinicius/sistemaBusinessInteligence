import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { CAlert, CButton, CCard, CCardBody, CCol, CRow, CSpinner } from '@coreui/react-pro';
import CIcon from '@coreui/icons-react';
import { cilChartLine } from '@coreui/icons';
import { useAuth } from '../contexts/AuthContext';
import { useMenu } from '../contexts/MenuContext';
import { iconeDoMenu } from '../lib/icones';
import { ResumoInicio } from '../components/ResumoInicio';
import { ehAdmin, type MenuSubgrupo } from '../types';

export function InicioPage() {
  const { usuario } = useAuth();
  const { menu, carregando } = useMenu();
  const location = useLocation();
  const navigate = useNavigate();
  const [aviso, setAviso] = useState<string | null>((location.state as { aviso?: string } | null)?.aviso ?? null);

  // Limpa o aviso do histórico para não reaparecer ao recarregar
  useEffect(() => {
    if (aviso) navigate(location.pathname, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const primeiroNome = usuario?.nome.split(' ')[0];

  return (
    <>
      {aviso && (
        <CAlert color="success" dismissible onClose={() => setAviso(null)}>
          {aviso}
        </CAlert>
      )}
      <h1 className="pagina-titulo">Olá, {primeiroNome}</h1>
      {!carregando && <ResumoInicio ocultarVazio={menu.length === 0} />}

      {carregando ? (
        <div className="py-5 text-center">
          <CSpinner color="primary" />
        </div>
      ) : menu.length === 0 ? (
        <CCard className="estado-vazio mt-3">
          <CCardBody>
            <CIcon icon={cilChartLine} size="3xl" className="estado-vazio-icone" />
            {ehAdmin(usuario) ? (
              <>
                <h2>Nenhum painel cadastrado ainda</h2>
                <p>Monte o menu por setor e crie os primeiros painéis. Depois, libere o acesso por grupo.</p>
                <CButton color="primary" className="mt-3" onClick={() => navigate('/admin/menu')}>
                  Ir para Menu e painéis
                </CButton>
              </>
            ) : (
              <>
                <h2>Nenhum painel liberado para você ainda</h2>
                <p>
                  Os painéis aparecem aqui e no menu ao lado assim que um administrador liberar o acesso para o seu
                  grupo.
                </p>
              </>
            )}
          </CCardBody>
        </CCard>
      ) : (
        <>
          <h2 className="inicio-secao">Seus painéis, por setor</h2>
          <CRow className="g-4">
            {menu.map((g) => (
              <CCol key={g.id} md={6} xl={4}>
                <CCard className="h-100 atalho-grupo">
                  <CCardBody>
                    <h2 className="atalho-grupo-titulo">
                      <CIcon icon={iconeDoMenu(g.icone)} className="atalho-grupo-icone" />
                      {g.nome}
                    </h2>
                    {g.subgrupos.map((s) => (
                      <AtalhoSubgrupo key={s.id} s={s} caminho={[]} />
                    ))}
                  </CCardBody>
                </CCard>
              </CCol>
            ))}
          </CRow>
        </>
      )}
    </>
  );
}

/** Subgrupos aninhados aparecem como "Contas a pagar › Fornecedores". */
function AtalhoSubgrupo({ s, caminho }: { s: MenuSubgrupo; caminho: string[] }) {
  const titulo = [...caminho, s.nome];
  return (
    <>
      {s.paineis.length > 0 && (
        <div className="atalho-subgrupo">
          <h3>{titulo.join(' › ')}</h3>
          <ul>
            {s.paineis.map((p) => (
              <li key={p.id}>
                <Link to={`/painel/${p.id}`}>{p.nome}</Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      {s.subgrupos.map((f) => (
        <AtalhoSubgrupo key={f.id} s={f} caminho={titulo} />
      ))}
    </>
  );
}
