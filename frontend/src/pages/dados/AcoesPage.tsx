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
import { cilCode, cilPlus, cilSearch } from '@coreui/icons';
import { api, mensagemDeErro } from '../../api/client';
import { contem } from '../../lib/formato';
import type { AcaoResumo } from '../../types';

export function AcoesPage() {
  const navigate = useNavigate();
  const [acoes, setAcoes] = useState<AcaoResumo[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState('');

  useEffect(() => {
    api
      .get<AcaoResumo[]>('/acoes')
      .then((r) => setAcoes(r.data))
      .catch((e) => setErro(mensagemDeErro(e)));
  }, []);

  const visiveis = useMemo(
    () =>
      (acoes ?? []).filter(
        (a) => !busca || contem(a.nome, busca) || contem(a.tabelaDestino, busca) || contem(a.conexao.nome, busca) || a.tarefas.some((t) => contem(t.nome, busca)),
      ),
    [acoes, busca],
  );

  return (
    <>
      <div className="pagina-cabecalho">
        <div>
          <h1 className="pagina-titulo">Ações</h1>
          <p className="pagina-descricao">Cada ação busca dados numa conexão de origem e grava numa tabela do bi_dados.</p>
        </div>
        <CButton color="primary" onClick={() => navigate('/dados/acoes/nova')}>
          <CIcon icon={cilPlus} className="me-1" />
          Nova ação
        </CButton>
      </div>

      {erro && <CAlert color="danger">{erro}</CAlert>}

      {!acoes ? (
        <div className="py-5 text-center">
          <CSpinner color="primary" />
        </div>
      ) : acoes.length === 0 ? (
        <CCard className="estado-vazio">
          <CCardBody>
            <CIcon icon={cilCode} size="3xl" className="estado-vazio-icone" />
            <h2>Nenhuma ação cadastrada</h2>
            <p>
              Crie uma ação para cada consulta de carga, como a ETL_V_FATURAMENTO_CLIENTE. Pode colar o SQL da ferramenta atual: os
              parâmetros $[NOME] são convertidos sozinhos.
            </p>
            <CButton color="primary" className="mt-3" onClick={() => navigate('/dados/acoes/nova')}>
              Criar primeira ação
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
                <CFormInput
                  placeholder="Buscar por ação, tabela, conexão ou tarefa"
                  aria-label="Buscar ações"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                />
              </CInputGroup>
            </div>
            {visiveis.length === 0 ? (
              <p className="lista-vazia">Nenhuma ação encontrada com essa busca.</p>
            ) : (
              <CTable hover responsive align="middle" className="mb-0 tabela-lista">
                <CTableHead>
                  <CTableRow>
                    <CTableHeaderCell>Ação</CTableHeaderCell>
                    <CTableHeaderCell>Conexão</CTableHeaderCell>
                    <CTableHeaderCell>Tabela de destino</CTableHeaderCell>
                    <CTableHeaderCell>Usada em</CTableHeaderCell>
                    <CTableHeaderCell>Tempo máx.</CTableHeaderCell>
                  </CTableRow>
                </CTableHead>
                <CTableBody>
                  {visiveis.map((a) => (
                    <CTableRow key={a.id} className="linha-clicavel" onClick={() => navigate(`/dados/acoes/${a.id}`)}>
                      <CTableDataCell>
                        <Link to={`/dados/acoes/${a.id}`} className="fw-semibold link-body" onClick={(e) => e.stopPropagation()}>
                          {a.nome}
                        </Link>
                        {!a.ativo && (
                          <CBadge color="secondary" className="ms-2">
                            Inativa
                          </CBadge>
                        )}
                        <div className="small text-body-secondary font-mono text-truncate resumo-sql">{a.resumoSql}</div>
                      </CTableDataCell>
                      <CTableDataCell>{a.conexao.nome}</CTableDataCell>
                      <CTableDataCell className="font-mono small">{a.tabelaDestino}</CTableDataCell>
                      <CTableDataCell>
                        {a.tarefas.length ? (
                          <div className="d-flex flex-wrap gap-1">
                            {a.tarefas.map((t) => (
                              <CBadge key={t.id} color="secondary" className="badge-leve">
                                {t.nome}
                              </CBadge>
                            ))}
                          </div>
                        ) : (
                          <span className="small text-warning-emphasis">Nenhuma tarefa</span>
                        )}
                      </CTableDataCell>
                      <CTableDataCell className="text-nowrap">{a.tempoMaximoMin} min</CTableDataCell>
                    </CTableRow>
                  ))}
                </CTableBody>
              </CTable>
            )}
          </CCardBody>
        </CCard>
      )}
    </>
  );
}
