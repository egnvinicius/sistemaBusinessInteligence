import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  CAlert,
  CBadge,
  CButton,
  CCard,
  CCardBody,
  CFormInput,
  CInputGroup,
  CInputGroupText,
  CSpinner,
  CTable,
  CTableBody,
  CTableDataCell,
  CTableHead,
  CTableHeaderCell,
  CTableRow,
} from '@coreui/react-pro';
import CIcon from '@coreui/icons-react';
import { cilChartLine, cilPlus, cilSearch } from '@coreui/icons';
import { api, mensagemDeErro } from '../../api/client';
import { contem } from '../../lib/formato';

export interface ConsultaPainel {
  id: number;
  nome: string;
  descricao: string | null;
  colunas: { nome: string; tipo: 'numero' | 'texto' | 'data' }[];
  parametros: string[];
  visuais: number;
  paineis: { id: number; nome: string }[];
  resumoSql?: string;
  sql?: string;
}

export function ConsultasPage() {
  const navigate = useNavigate();
  const [lista, setLista] = useState<ConsultaPainel[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState('');

  useEffect(() => {
    api
      .get<ConsultaPainel[]>('/catalogo/consultas')
      .then((r) => setLista(r.data))
      .catch((e) => setErro(mensagemDeErro(e)));
  }, []);

  const visiveis = useMemo(
    () => (lista ?? []).filter((c) => !busca || contem(c.nome, busca) || contem(c.descricao, busca) || c.paineis.some((p) => contem(p.nome, busca))),
    [lista, busca],
  );

  return (
    <>
      <div className="pagina-cabecalho">
        <div>
          <h1 className="pagina-titulo">Consultas de painel</h1>
          <p className="pagina-descricao">SELECTs no bi_dados que alimentam os gráficos. Gestores escolhem entre elas ao montar os painéis.</p>
        </div>
        <CButton color="primary" onClick={() => navigate('/construcao/consultas/nova')}>
          <CIcon icon={cilPlus} className="me-1" />
          Nova consulta
        </CButton>
      </div>
      {erro && <CAlert color="danger">{erro}</CAlert>}
      {!lista ? (
        <div className="py-5 text-center">
          <CSpinner color="primary" />
        </div>
      ) : lista.length === 0 ? (
        <CCard className="estado-vazio">
          <CCardBody>
            <CIcon icon={cilChartLine} size="3xl" className="estado-vazio-icone" />
            <h2>Nenhuma consulta cadastrada</h2>
            <p>Crie um SELECT sobre as tabelas carregadas no bi_dados. Os filtros do painel chegam ao SQL como @PARAMETRO.</p>
            <CButton color="primary" className="mt-3" onClick={() => navigate('/construcao/consultas/nova')}>
              Criar primeira consulta
            </CButton>
          </CCardBody>
        </CCard>
      ) : (
        <CCard>
          <CCardBody>
            <div className="lista-filtros">
              <CInputGroup className="lista-busca">
                <CInputGroupText>
                  <CIcon icon={cilSearch} />
                </CInputGroupText>
                <CFormInput placeholder="Buscar por consulta ou painel" aria-label="Buscar consultas" value={busca} onChange={(e) => setBusca(e.target.value)} />
              </CInputGroup>
            </div>
            <CTable hover responsive align="middle" className="mb-0 tabela-lista">
              <CTableHead>
                <CTableRow>
                  <CTableHeaderCell>Consulta</CTableHeaderCell>
                  <CTableHeaderCell>Colunas</CTableHeaderCell>
                  <CTableHeaderCell>Filtros usados</CTableHeaderCell>
                  <CTableHeaderCell>Usada em</CTableHeaderCell>
                </CTableRow>
              </CTableHead>
              <CTableBody>
                {visiveis.map((c) => (
                  <CTableRow key={c.id} className="linha-clicavel" onClick={() => navigate(`/construcao/consultas/${c.id}`)}>
                    <CTableDataCell>
                      <Link to={`/construcao/consultas/${c.id}`} className="fw-semibold link-body" onClick={(e) => e.stopPropagation()}>
                        {c.nome}
                      </Link>
                      {c.descricao && <div className="small text-body-secondary">{c.descricao}</div>}
                    </CTableDataCell>
                    <CTableDataCell className="small">{c.colunas.map((x) => x.nome).join(', ')}</CTableDataCell>
                    <CTableDataCell>
                      {c.parametros.length ? (
                        c.parametros.map((p) => (
                          <CBadge key={p} color="secondary" className="badge-leve me-1">
                            @{p}
                          </CBadge>
                        ))
                      ) : (
                        <span className="text-body-secondary small">Nenhum</span>
                      )}
                    </CTableDataCell>
                    <CTableDataCell className="small">
                      {c.paineis.length ? c.paineis.map((p) => p.nome).join(', ') : <span className="text-body-secondary">Nenhum painel</span>}
                    </CTableDataCell>
                  </CTableRow>
                ))}
              </CTableBody>
            </CTable>
          </CCardBody>
        </CCard>
      )}
    </>
  );
}
