import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  CAlert,
  CBadge,
  CButton,
  CCard,
  CCardBody,
  CFormInput,
  CModal,
  CModalBody,
  CModalHeader,
  CModalTitle,
  CSpinner,
  CTable,
  CTableBody,
  CTableDataCell,
  CTableHead,
  CTableHeaderCell,
  CTableRow,
} from '@coreui/react-pro';
import CIcon from '@coreui/icons-react';
import { cilLightbulb, cilPencil, cilPlus } from '@coreui/icons';
import { api, mensagemDeErro } from '../../api/client';
import { formatarDataHora } from '../../lib/formato';
import { useAuth } from '../../contexts/AuthContext';
import { ehDesenvolvedor } from '../../types';

interface AnaliseResumo {
  id: number;
  nome: string;
  cuboNome: string | null;
  visuais: number;
  atualizadoEm: string;
  painelId: number | null;
  painelNome: string | null;
  visibilidade: 'grupos' | 'subgrupo' | 'privado' | null;
  donoNome: string;
}
interface CuboResumo {
  id: number;
  nome: string;
  descricao: string | null;
  colunas: { nome: string; tipo: string; descricao: string | null }[];
}

export function AnalisesPage() {
  const navigate = useNavigate();
  const [analises, setAnalises] = useState<AnaliseResumo[] | null>(null);
  const [cubos, setCubos] = useState<CuboResumo[]>([]);
  const [escolher, setEscolher] = useState(false);
  const { usuario } = useAuth();
  const [deOutros, setDeOutros] = useState<AnaliseResumo[] | null>(null);
  const [buscaOutros, setBuscaOutros] = useState('');

  // Desenvolvedor: também as análises dos outros usuários, só para ver
  useEffect(() => {
    if (!ehDesenvolvedor(usuario)) return;
    api
      .get<AnaliseResumo[]>('/analises', { params: { de: 'outros' } })
      .then((r) => setDeOutros(r.data))
      .catch(() => setDeOutros([]));
  }, [usuario]);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.get<AnaliseResumo[]>('/analises'), api.get<CuboResumo[]>('/analises/cubos')])
      .then(([a, c]) => {
        setAnalises(a.data);
        setCubos(c.data);
      })
      .catch((e) => setErro(mensagemDeErro(e)));
  }, []);

  const nova = () => (cubos.length === 1 ? navigate(`/analises/nova?cubo=${cubos[0].id}`) : setEscolher(true));

  return (
    <>
      <div className="pagina-cabecalho">
        <div>
          <h1 className="pagina-titulo">Minhas análises</h1>
          <p className="pagina-descricao">Visualizações que você monta com a ajuda da IA a partir dos cubos liberados para você. Só você e os Desenvolvedores veem as suas análises. Para mostrar a outras pessoas, publique a análise como painel no menu.</p>
        </div>
        {cubos.length > 0 && (
          <CButton color="primary" onClick={nova}>
            <CIcon icon={cilPlus} className="me-1" />
            Nova análise
          </CButton>
        )}
      </div>
      {erro && <CAlert color="danger">{erro}</CAlert>}

      {!analises ? (
        <div className="py-5 text-center">
          <CSpinner color="primary" />
        </div>
      ) : analises.length === 0 ? (
        <CCard className="estado-vazio">
          <CCardBody>
            <CIcon icon={cilLightbulb} size="3xl" className="estado-vazio-icone" />
            {cubos.length ? (
              <>
                <h2>Monte sua primeira análise</h2>
                <p>Escolha um cubo, descreva o que quer ver ("faturamento por mês e por filial") e a IA monta os gráficos. Depois é só arrumar e salvar.</p>
                <CButton color="primary" className="mt-3" onClick={nova}>
                  Nova análise
                </CButton>
              </>
            ) : (
              <>
                <h2>Nenhum cubo liberado para você</h2>
                <p>Os cubos são liberados por grupo de acesso. Peça a um administrador para incluir você no grupo certo.</p>
              </>
            )}
          </CCardBody>
        </CCard>
      ) : (
        <CCard>
          <CCardBody>
            <CTable hover responsive align="middle" className="mb-0 tabela-lista">
              <CTableHead>
                <CTableRow>
                  <CTableHeaderCell>Análise</CTableHeaderCell>
                  <CTableHeaderCell>Cubo</CTableHeaderCell>
                  <CTableHeaderCell>Visuais</CTableHeaderCell>
                  <CTableHeaderCell>Salva em</CTableHeaderCell>
                  <CTableHeaderCell>
                    <span className="visually-hidden">Ações</span>
                  </CTableHeaderCell>
                </CTableRow>
              </CTableHead>
              <CTableBody>
                {analises.map((a) => (
                  <CTableRow key={a.id} className="linha-clicavel" onClick={() => navigate(`/analises/${a.id}/ver`)}>
                    <CTableDataCell>
                      <Link to={`/analises/${a.id}/ver`} className="fw-semibold link-body" onClick={(e) => e.stopPropagation()}>
                        {a.nome}
                      </Link>
                      {a.painelId && (
                        <CBadge color="info" className="badge-leve ms-2" title={`Publicada no menu como o painel "${a.painelNome}"`}>
                          {a.visibilidade === 'privado' ? 'No meu menu' : 'No menu'}
                        </CBadge>
                      )}
                    </CTableDataCell>
                    <CTableDataCell>{a.cuboNome}</CTableDataCell>
                    <CTableDataCell>{a.visuais}</CTableDataCell>
                    <CTableDataCell className="small text-body-secondary">{formatarDataHora(a.atualizadoEm)}</CTableDataCell>
                    <CTableDataCell className="text-end text-nowrap">
                      <Link to={`/analises/${a.id}`} className="btn btn-sm btn-outline-secondary" onClick={(e) => e.stopPropagation()}>
                        <CIcon icon={cilPencil} className="me-1" />
                        Editar
                      </Link>
                    </CTableDataCell>
                  </CTableRow>
                ))}
              </CTableBody>
            </CTable>
          </CCardBody>
        </CCard>
      )}

      {deOutros && deOutros.length > 0 && (
        <CCard className="mt-4">
          <CCardBody>
            <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
              <div>
                <h2 className="h5 mb-0">Análises de outros usuários</h2>
                <p className="small text-body-secondary mb-0">Visível só para Desenvolvedores. Abre em modo de leitura; só o dono altera.</p>
              </div>
              <CFormInput
                size="sm"
                className="busca-outros"
                placeholder="Buscar por análise ou pessoa"
                aria-label="Buscar análises de outros usuários"
                value={buscaOutros}
                onChange={(e) => setBuscaOutros(e.target.value)}
              />
            </div>
            <CTable hover responsive align="middle" className="mb-0 tabela-lista">
              <CTableHead>
                <CTableRow>
                  <CTableHeaderCell>Análise</CTableHeaderCell>
                  <CTableHeaderCell>Dono</CTableHeaderCell>
                  <CTableHeaderCell>Cubo</CTableHeaderCell>
                  <CTableHeaderCell>Salva em</CTableHeaderCell>
                </CTableRow>
              </CTableHead>
              <CTableBody>
                {deOutros
                  .filter((a) => {
                    const b = buscaOutros.trim().toLocaleLowerCase('pt-BR');
                    return !b || `${a.nome} ${a.donoNome}`.toLocaleLowerCase('pt-BR').includes(b);
                  })
                  .map((a) => (
                    <CTableRow key={a.id} className="linha-clicavel" onClick={() => navigate(`/analises/${a.id}/ver`)}>
                      <CTableDataCell>
                        <Link to={`/analises/${a.id}/ver`} className="fw-semibold link-body" onClick={(e) => e.stopPropagation()}>
                          {a.nome}
                        </Link>
                        {a.painelId && (
                          <CBadge color={a.visibilidade === 'privado' ? 'secondary' : 'info'} className="badge-leve ms-2">
                            {a.visibilidade === 'privado' ? 'Painel privado' : 'Painel público'}
                          </CBadge>
                        )}
                      </CTableDataCell>
                      <CTableDataCell>{a.donoNome}</CTableDataCell>
                      <CTableDataCell>{a.cuboNome}</CTableDataCell>
                      <CTableDataCell className="small text-body-secondary">{formatarDataHora(a.atualizadoEm)}</CTableDataCell>
                    </CTableRow>
                  ))}
              </CTableBody>
            </CTable>
          </CCardBody>
        </CCard>
      )}

      <CModal visible={escolher} onClose={() => setEscolher(false)} alignment="center" size="lg">
        <CModalHeader>
          <CModalTitle>Escolha o cubo</CModalTitle>
        </CModalHeader>
        <CModalBody>
          <div className="cubos-escolha">
            {cubos.map((c) => (
              <button key={c.id} type="button" onClick={() => navigate(`/analises/nova?cubo=${c.id}`)}>
                <strong>{c.nome}</strong>
                {c.descricao && <span className="cubos-desc">{c.descricao}</span>}
                <span className="cubos-colunas">{c.colunas.map((x) => x.descricao?.trim() || x.nome).join(' · ')}</span>
              </button>
            ))}
          </div>
        </CModalBody>
      </CModal>
    </>
  );
}
