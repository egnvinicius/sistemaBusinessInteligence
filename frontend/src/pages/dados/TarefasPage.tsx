import { Fragment, useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  CAlert,
  CButton,
  CCard,
  CCardBody,
  CFormInput,
  CFormLabel,
  CFormSwitch,
  CInputGroup,
  CInputGroupText,
  CLoadingButton,
  CModal,
  CModalBody,
  CModalFooter,
  CModalHeader,
  CModalTitle,
  CSpinner,
  CTable,
  CTableBody,
  CTableDataCell,
  CTableHead,
  CTableHeaderCell,
  CTableRow,
  CTooltip,
} from '@coreui/react-pro';
import CIcon from '@coreui/icons-react';
import { cilMediaPlay, cilMediaStop, cilPlus, cilSearch, cilSync } from '@coreui/icons';
import { api, AUTOMATICO, mensagemDeErro } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { useAvisos } from '../../contexts/AvisosContext';
import { BadgeSituacao } from '../../lib/execucoes';
import { contem, formatarDataHora } from '../../lib/formato';
import { ehDesenvolvedor, type TarefaResumo } from '../../types';
import { FormularioTarefa, type GrupoTarefa } from './FormularioTarefa';

const ATUALIZAR_A_CADA_MS = 10_000;

export function TarefasPage() {
  const { usuario } = useAuth();
  const dev = ehDesenvolvedor(usuario);
  const avisar = useAvisos();
  const navigate = useNavigate();
  const [tarefas, setTarefas] = useState<TarefaResumo[] | null>(null);
  const [grupos, setGrupos] = useState<GrupoTarefa[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [nova, setNova] = useState(false);
  const [gerindoGrupos, setGerindoGrupos] = useState(false);
  const [agindo, setAgindo] = useState<number | null>(null);

  const carregar = useCallback(async (automatico = false) => {
    const cfg = automatico ? AUTOMATICO : undefined;
    try {
      const [t, g] = await Promise.all([api.get<TarefaResumo[]>('/tarefas', cfg), api.get<GrupoTarefa[]>('/tarefas/grupos', cfg)]);
      setTarefas(t.data);
      setGrupos(g.data);
      setErro(null);
    } catch (e) {
      setErro(mensagemDeErro(e));
    }
  }, []);

  useEffect(() => {
    carregar();
    const t = setInterval(() => carregar(true), ATUALIZAR_A_CADA_MS);
    return () => clearInterval(t);
  }, [carregar]);

  const visiveis = useMemo(
    () => (tarefas ?? []).filter((t) => !busca || contem(t.nome, busca) || contem(t.grupo.nome, busca) || contem(t.descricao, busca)),
    [tarefas, busca],
  );
  const porGrupo = useMemo(() => {
    const m = new Map<string, TarefaResumo[]>();
    for (const t of visiveis) {
      if (!m.has(t.grupo.nome)) m.set(t.grupo.nome, []);
      m.get(t.grupo.nome)!.push(t);
    }
    return [...m.entries()];
  }, [visiveis]);
  const emAndamento = (tarefas ?? []).filter((t) => t.andamento);

  async function executar(t: TarefaResumo) {
    setAgindo(t.id);
    try {
      await api.post(`/tarefas/${t.id}/executar`);
      avisar(`${t.nome} entrou na fila.`);
      carregar();
    } catch (e) {
      avisar(mensagemDeErro(e), 'erro');
    } finally {
      setAgindo(null);
    }
  }

  async function parar(t: TarefaResumo) {
    setAgindo(t.id);
    try {
      await api.post(`/tarefas/${t.id}/parar`);
      avisar(t.andamento?.situacao === 'na_fila' ? `${t.nome} saiu da fila.` : `Interrompendo ${t.nome}…`);
      carregar();
    } catch (e) {
      avisar(mensagemDeErro(e), 'erro');
    } finally {
      setAgindo(null);
    }
  }

  async function alternarAtiva(t: TarefaResumo) {
    try {
      await api.patch(`/tarefas/${t.id}/ativa`, { ativa: !t.ativa });
      carregar();
    } catch (e) {
      avisar(mensagemDeErro(e), 'erro');
    }
  }

  return (
    <>
      <div className="pagina-cabecalho">
        <div>
          <h1 className="pagina-titulo">Tarefas</h1>
          <p className="pagina-descricao">Atualizações agendadas dos dados dos painéis. Uma tarefa roda por vez; as demais esperam na fila.</p>
        </div>
        {dev && (
          <div className="d-flex gap-2">
            <CButton color="secondary" variant="outline" onClick={() => setGerindoGrupos(true)}>
              Grupos
            </CButton>
            <CButton color="primary" onClick={() => setNova(true)} disabled={!grupos.length} title={!grupos.length ? 'Crie um grupo antes' : undefined}>
              <CIcon icon={cilPlus} className="me-1" />
              Nova tarefa
            </CButton>
          </div>
        )}
      </div>

      {erro && <CAlert color="danger">{erro}</CAlert>}

      {emAndamento.length > 0 && (
        <CAlert color="info" className="d-flex align-items-center gap-2 fila-resumo">
          <CIcon icon={cilSync} className="girando" />
          <span>
            {emAndamento
              .map((t) => `${t.nome} ${t.andamento!.situacao === 'executando' ? 'em execução' : 'na fila'}`)
              .join(' · ')}
          </span>
        </CAlert>
      )}

      {!tarefas ? (
        <div className="py-5 text-center">
          <CSpinner color="primary" />
        </div>
      ) : tarefas.length === 0 ? (
        <CCard className="estado-vazio">
          <CCardBody>
            <CIcon icon={cilSync} size="3xl" className="estado-vazio-icone" />
            <h2>Nenhuma tarefa cadastrada</h2>
            <p>
              {dev
                ? 'Crie um grupo (por exemplo GERAL ou ARMAZÉM), depois a tarefa, escolha as ações que ela executa e defina a agenda.'
                : 'As tarefas de atualização são cadastradas por um Desenvolvedor.'}
            </p>
            {dev && (
              <CButton color="primary" className="mt-3" onClick={() => (grupos.length ? setNova(true) : setGerindoGrupos(true))}>
                {grupos.length ? 'Criar primeira tarefa' : 'Criar primeiro grupo'}
              </CButton>
            )}
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
                <CFormInput placeholder="Buscar tarefa ou grupo" aria-label="Buscar tarefas" value={busca} onChange={(e) => setBusca(e.target.value)} />
              </CInputGroup>
            </div>
            <CTable hover responsive align="middle" className="mb-0 tabela-lista tabela-tarefas">
              <CTableHead>
                <CTableRow>
                  <CTableHeaderCell>Tarefa</CTableHeaderCell>
                  <CTableHeaderCell>Ativa</CTableHeaderCell>
                  <CTableHeaderCell>Última execução</CTableHeaderCell>
                  <CTableHeaderCell>Próxima</CTableHeaderCell>
                  <CTableHeaderCell className="text-end">
                    <span className="visually-hidden">Ações</span>
                  </CTableHeaderCell>
                </CTableRow>
              </CTableHead>
              <CTableBody>
                {porGrupo.map(([grupo, lista]) => (
                  <Fragment key={grupo}>
                    <CTableRow className="linha-grupo">
                      <CTableDataCell colSpan={5}>{grupo}</CTableDataCell>
                    </CTableRow>
                    {lista.map((t) => (
                      <CTableRow key={t.id}>
                        <CTableDataCell>
                          <Link to={`/dados/tarefas/${t.id}`} className="fw-semibold link-body">
                            {t.nome}
                          </Link>
                          <div className="small text-body-secondary">
                            {t.descricao ?? `${t.acoes} ação(ões) · ${t.agendas} agenda(s)`}
                          </div>
                        </CTableDataCell>
                        <CTableDataCell>
                          <CFormSwitch
                            aria-label={`${t.ativa ? 'Desativar' : 'Ativar'} ${t.nome}`}
                            checked={t.ativa}
                            onChange={() => alternarAtiva(t)}
                          />
                        </CTableDataCell>
                        <CTableDataCell>
                          {t.andamento ? (
                            <BadgeSituacao situacao={t.andamento.situacao} />
                          ) : t.ultima ? (
                            <CTooltip content={t.ultima.mensagem ?? 'Sem observações'}>
                              <span className="d-inline-flex align-items-center gap-2" tabIndex={0}>
                                <BadgeSituacao situacao={t.ultima.situacao} />
                                <span className="small text-body-secondary text-nowrap">
                                  {formatarDataHora(t.ultima.fim ?? t.ultima.criado_em)}
                                </span>
                              </span>
                            </CTooltip>
                          ) : (
                            <span className="small text-body-secondary">Nunca executada</span>
                          )}
                        </CTableDataCell>
                        <CTableDataCell className="small text-nowrap">
                          {t.proxima ? formatarDataHora(t.proxima) : <span className="text-body-secondary">{t.ativa ? 'Sem agenda' : 'Desativada'}</span>}
                        </CTableDataCell>
                        <CTableDataCell className="text-end text-nowrap">
                          {t.andamento ? (
                            <CLoadingButton color="danger" variant="ghost" size="sm" loading={agindo === t.id} onClick={() => parar(t)}>
                              <CIcon icon={cilMediaStop} className="me-1" />
                              Parar
                            </CLoadingButton>
                          ) : (
                            <CLoadingButton
                              color="primary"
                              variant="ghost"
                              size="sm"
                              loading={agindo === t.id}
                              disabled={!t.acoes}
                              onClick={() => executar(t)}
                            >
                              <CIcon icon={cilMediaPlay} className="me-1" />
                              Executar
                            </CLoadingButton>
                          )}
                          <CButton color="secondary" variant="ghost" size="sm" onClick={() => navigate(`/dados/tarefas/${t.id}`)}>
                            Abrir
                          </CButton>
                        </CTableDataCell>
                      </CTableRow>
                    ))}
                  </Fragment>
                ))}
              </CTableBody>
            </CTable>
          </CCardBody>
        </CCard>
      )}

      {nova && (
        <FormularioTarefa
          grupos={grupos}
          onFechar={() => setNova(false)}
          onSalvo={(id) => {
            setNova(false);
            navigate(`/dados/tarefas/${id}`);
          }}
        />
      )}
      {gerindoGrupos && (
        <GruposTarefa
          grupos={grupos}
          onFechar={() => setGerindoGrupos(false)}
          onAlterado={() => carregar()}
        />
      )}
    </>
  );
}

/** Cadastro rápido dos grupos de tarefas (GERAL, ADM, ARMAZÉM, FROTA…). */
function GruposTarefa(props: { grupos: GrupoTarefa[]; onFechar: () => void; onAlterado: () => void }) {
  const avisar = useAvisos();
  const [nome, setNome] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function criar(e: FormEvent) {
    e.preventDefault();
    if (!nome.trim()) return;
    setSalvando(true);
    setErro(null);
    try {
      await api.post('/tarefas/grupos', { nome });
      setNome('');
      props.onAlterado();
    } catch (err) {
      setErro(mensagemDeErro(err));
    } finally {
      setSalvando(false);
    }
  }

  async function excluir(g: GrupoTarefa) {
    try {
      await api.delete(`/tarefas/grupos/${g.id}`);
      props.onAlterado();
    } catch (err) {
      avisar(mensagemDeErro(err), 'erro');
    }
  }

  return (
    <CModal visible onClose={props.onFechar} alignment="center">
      <CModalHeader>
        <CModalTitle>Grupos de tarefas</CModalTitle>
      </CModalHeader>
      <CModalBody>
        {erro && <CAlert color="danger" className="py-2">{erro}</CAlert>}
        <form onSubmit={criar} className="d-flex gap-2 mb-3">
          <div className="flex-grow-1">
            <CFormLabel htmlFor="tg-nome" className="visually-hidden">
              Nome do grupo
            </CFormLabel>
            <CFormInput id="tg-nome" placeholder="Nome do novo grupo, ex.: ARMAZÉM" value={nome} maxLength={60} onChange={(e) => setNome(e.target.value)} />
          </div>
          <CLoadingButton type="submit" color="primary" loading={salvando}>
            Adicionar
          </CLoadingButton>
        </form>
        {props.grupos.length === 0 ? (
          <p className="text-body-secondary small mb-0">Nenhum grupo ainda.</p>
        ) : (
          <ul className="list-group">
            {props.grupos.map((g) => (
              <li key={g.id} className="list-group-item d-flex justify-content-between align-items-center">
                <span>
                  {g.nome} <span className="small text-body-secondary">· {g.tarefas} tarefa(s)</span>
                </span>
                <CButton color="danger" variant="ghost" size="sm" disabled={g.tarefas > 0} onClick={() => excluir(g)} title={g.tarefas ? 'Mova ou exclua as tarefas antes' : undefined}>
                  Excluir
                </CButton>
              </li>
            ))}
          </ul>
        )}
      </CModalBody>
      <CModalFooter>
        <CButton color="primary" onClick={props.onFechar}>
          Concluir
        </CButton>
      </CModalFooter>
    </CModal>
  );
}
