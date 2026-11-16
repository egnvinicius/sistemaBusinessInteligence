import { useCallback, useEffect, useState } from 'react';
import {
  CAlert,
  CBadge,
  CButton,
  CCard,
  CCardBody,
  CCardHeader,
  CFormInput,
  CFormLabel,
  CFormSelect,
  CFormSwitch,
  CFormTextarea,
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
} from '@coreui/react-pro';
import CIcon from '@coreui/icons-react';
import { cilLayers, cilPlus } from '@coreui/icons';
import { api, mensagemDeErro } from '../../api/client';
import { Confirmar } from '../../components/Confirmar';
import { SeletorMultiplo } from '../../components/SeletorMultiplo';
import { useAuth } from '../../contexts/AuthContext';
import { useAvisos } from '../../contexts/AvisosContext';
import { formatarDataHora } from '../../lib/formato';
import { ehDesenvolvedor } from '../../types';

interface Cubo {
  id: number;
  nome: string;
  descricao: string | null;
  consultaId: number | null;
  consultaNome: string | null;
  acaoId: number | null;
  acaoNome: string | null;
  tabelaDestino: string | null;
  colunas: { nome: string; tipo: string }[];
  colunasDescricao: Record<string, string>;
  ativo: boolean;
  grupos: { id: number; nome: string }[];
  analises: number;
}
interface UsoIa {
  configurada: boolean;
  modelo: string;
  limiteDiario: number;
  uso: { usuario: string | null; pedidos: number; falhas: number; tokensEntrada: number; tokensSaida: number; ultimoPedido: string }[];
}

const numero = new Intl.NumberFormat('pt-BR');

export function CubosPage() {
  const { usuario } = useAuth();
  const dev = ehDesenvolvedor(usuario);
  const avisar = useAvisos();
  const [cubos, setCubos] = useState<Cubo[] | null>(null);
  const [uso, setUso] = useState<UsoIa | null>(null);
  const [editar, setEditar] = useState<Partial<Cubo> | null>(null);
  const [excluir, setExcluir] = useState<Cubo | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(() => {
    Promise.all([api.get<Cubo[]>('/catalogo/cubos'), api.get<UsoIa>('/catalogo/cubos/uso-ia')])
      .then(([c, u]) => {
        setCubos(c.data);
        setUso(u.data);
      })
      .catch((e) => setErro(mensagemDeErro(e)));
  }, []);
  useEffect(carregar, [carregar]);

  return (
    <>
      <div className="pagina-cabecalho">
        <div>
          <h1 className="pagina-titulo">Cubos</h1>
          <p className="pagina-descricao">
            Tabelas carregadas pelas ações, liberadas para os usuários montarem as próprias análises com IA. A IA recebe só os nomes, os tipos e as descrições das colunas, nunca os dados.
          </p>
        </div>
        {dev && (
          <CButton color="primary" onClick={() => setEditar({ ativo: true, colunasDescricao: {}, grupos: [] })}>
            <CIcon icon={cilPlus} className="me-1" />
            Novo cubo
          </CButton>
        )}
      </div>
      {erro && <CAlert color="danger">{erro}</CAlert>}

      {uso && !uso.configurada && (
        <CAlert color="warning">
          A IA não está configurada: informe <code>ANTHROPIC_API_KEY</code> no <code>.env</code> do servidor. Sem ela, os usuários montam as análises só manualmente.
        </CAlert>
      )}

      {!cubos ? (
        <div className="py-5 text-center">
          <CSpinner color="primary" />
        </div>
      ) : cubos.length === 0 ? (
        <CCard className="estado-vazio">
          <CCardBody>
            <CIcon icon={cilLayers} size="3xl" className="estado-vazio-icone" />
            <h2>Nenhum cubo cadastrado</h2>
            <p>Um cubo usa a tabela que uma ação carrega no bi_dados. Escolha a ação e descreva as colunas principais para a IA entender cada uma.</p>
          </CCardBody>
        </CCard>
      ) : (
        <CCard className="mb-4">
          <CCardBody>
            <CTable hover={dev} responsive align="middle" className="mb-0 tabela-lista">
              <CTableHead>
                <CTableRow>
                  <CTableHeaderCell>Cubo</CTableHeaderCell>
                  <CTableHeaderCell>Origem</CTableHeaderCell>
                  <CTableHeaderCell>Grupos com acesso</CTableHeaderCell>
                  <CTableHeaderCell>Análises</CTableHeaderCell>
                  {dev && <CTableHeaderCell />}
                </CTableRow>
              </CTableHead>
              <CTableBody>
                {cubos.map((c) => (
                  <CTableRow key={c.id} className={dev ? 'linha-clicavel' : undefined} onClick={dev ? () => setEditar(c) : undefined}>
                    <CTableDataCell>
                      <span className="fw-semibold">{c.nome}</span>{' '}
                      {!c.ativo && (
                        <CBadge color="secondary" className="badge-leve">
                          inativo
                        </CBadge>
                      )}
                      {c.descricao && <div className="small text-body-secondary">{c.descricao}</div>}
                    </CTableDataCell>
                    <CTableDataCell className="small">
                      {c.acaoId ? (
                        <>
                          Ação {c.acaoNome} <code className="ms-1">{c.tabelaDestino}</code>
                        </>
                      ) : (
                        <>Consulta de painel {c.consultaNome}</>
                      )}
                      <div className="text-body-secondary">
                        {c.colunas.length ? `${c.colunas.length} colunas, ${Object.keys(c.colunasDescricao).length} descritas` : 'Tabela ainda não existe no bi_dados'}
                      </div>
                    </CTableDataCell>
                    <CTableDataCell className="small">{c.grupos.length ? c.grupos.map((g) => g.nome).join(', ') : <span className="text-body-secondary">Só Gestor e Desenvolvedor</span>}</CTableDataCell>
                    <CTableDataCell>{c.analises}</CTableDataCell>
                    {dev && (
                      <CTableDataCell className="text-end">
                        <CButton
                          size="sm"
                          color="danger"
                          variant="ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            setExcluir(c);
                          }}
                        >
                          Excluir
                        </CButton>
                      </CTableDataCell>
                    )}
                  </CTableRow>
                ))}
              </CTableBody>
            </CTable>
          </CCardBody>
        </CCard>
      )}

      {uso && (
        <CCard>
          <CCardHeader>
            Uso da IA nos últimos 30 dias <span className="small text-body-secondary ms-2">modelo {uso.modelo} · até {uso.limiteDiario} pedidos por pessoa por dia</span>
          </CCardHeader>
          <CCardBody>
            {uso.uso.length === 0 ? (
              <p className="lista-vazia mb-0">Nenhum pedido à IA ainda.</p>
            ) : (
              <CTable small responsive className="mb-0">
                <CTableHead>
                  <CTableRow>
                    <CTableHeaderCell>Usuário</CTableHeaderCell>
                    <CTableHeaderCell className="text-end">Pedidos</CTableHeaderCell>
                    <CTableHeaderCell className="text-end">Falhas</CTableHeaderCell>
                    <CTableHeaderCell className="text-end">Tokens (entrada / saída)</CTableHeaderCell>
                    <CTableHeaderCell>Último pedido</CTableHeaderCell>
                  </CTableRow>
                </CTableHead>
                <CTableBody>
                  {uso.uso.map((u) => (
                    <CTableRow key={u.usuario ?? '-'}>
                      <CTableDataCell>{u.usuario ?? '(usuário excluído)'}</CTableDataCell>
                      <CTableDataCell className="text-end">{numero.format(u.pedidos)}</CTableDataCell>
                      <CTableDataCell className="text-end">{numero.format(u.falhas)}</CTableDataCell>
                      <CTableDataCell className="text-end">
                        {numero.format(u.tokensEntrada)} / {numero.format(u.tokensSaida)}
                      </CTableDataCell>
                      <CTableDataCell className="small">{formatarDataHora(u.ultimoPedido)}</CTableDataCell>
                    </CTableRow>
                  ))}
                </CTableBody>
              </CTable>
            )}
          </CCardBody>
        </CCard>
      )}

      {editar && (
        <ModalCubo
          inicial={editar}
          onFechar={() => setEditar(null)}
          onSalvo={() => {
            setEditar(null);
            avisar('Cubo salvo.');
            carregar();
          }}
        />
      )}
      <Confirmar
        visivel={!!excluir}
        titulo="Excluir cubo?"
        acao="Excluir cubo"
        perigoso
        onFechar={() => setExcluir(null)}
        onConfirmar={async () => {
          try {
            await api.delete(`/catalogo/cubos/${excluir!.id}`);
            avisar('Cubo excluído.');
            carregar();
          } catch (e) {
            setErro(mensagemDeErro(e));
          } finally {
            setExcluir(null);
          }
        }}
      >
        O cubo <strong>{excluir?.nome}</strong> será excluído
        {excluir?.analises ? (
          <>
            {' '}
            junto com <strong>{excluir.analises}</strong> {excluir.analises === 1 ? 'análise salva' : 'análises salvas'} pelos usuários
          </>
        ) : null}
        . Para só esconder dos usuários, desative o cubo.
      </Confirmar>
    </>
  );
}

function ModalCubo({ inicial, onFechar, onSalvo }: { inicial: Partial<Cubo>; onFechar: () => void; onSalvo: () => void }) {
  const [f, setF] = useState({
    nome: inicial.nome ?? '',
    descricao: inicial.descricao ?? '',
    acaoId: inicial.acaoId ?? 0,
    consultaId: inicial.consultaId ?? null,
    colunasDescricao: inicial.colunasDescricao ?? {},
    grupos: (inicial.grupos ?? []).map((g) => g.id),
    ativo: inicial.ativo ?? true,
  });
  const [acoes, setAcoes] = useState<{ id: number; nome: string; tabelaDestino: string; ativo: boolean }[]>([]);
  const [colunas, setColunas] = useState<{ nome: string; tipo: string }[] | null>(inicial.colunas ?? null);
  const [tabela, setTabela] = useState<string | null>(inicial.tabelaDestino ?? null);
  const [grupos, setGrupos] = useState<{ id: number; nome: string }[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => {
    api.get('/acoes').then((r) => setAcoes(r.data)).catch((e) => setErro(mensagemDeErro(e)));
    api.get('/grupos').then((r) => setGrupos(r.data)).catch(() => undefined);
  }, []);

  // Colunas da tabela que a ação escolhida carrega
  useEffect(() => {
    if (!f.acaoId) return;
    let ativo = true;
    setColunas(null);
    api
      .get(`/catalogo/cubos/colunas-acao/${f.acaoId}`)
      .then((r) => {
        if (!ativo) return;
        setColunas(r.data.colunas);
        setTabela(r.data.tabelaDestino);
      })
      .catch((e) => ativo && setErro(mensagemDeErro(e)));
    return () => {
      ativo = false;
    };
  }, [f.acaoId]);

  const salvar = async () => {
    setSalvando(true);
    setErro(null);
    try {
      // Escolhida uma ação, ela passa a ser a origem (cubos antigos de consulta deixam a consulta)
      const corpo = { ...f, descricao: f.descricao || null, acaoId: f.acaoId || null, consultaId: f.acaoId ? null : f.consultaId };
      if (inicial.id) await api.put(`/catalogo/cubos/${inicial.id}`, corpo);
      else await api.post('/catalogo/cubos', corpo);
      onSalvo();
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <CModal visible size="lg" onClose={onFechar} alignment="center" backdrop="static">
      <CModalHeader>
        <CModalTitle>{inicial.id ? `Cubo ${inicial.nome}` : 'Novo cubo'}</CModalTitle>
      </CModalHeader>
      <CModalBody>
        <div className="row g-3">
          <div className="col-md-6">
            <CFormLabel htmlFor="cb-nome">Nome</CFormLabel>
            <CFormInput id="cb-nome" value={f.nome} maxLength={120} onChange={(e) => setF({ ...f, nome: e.target.value })} placeholder="Ex.: Faturamento" />
          </div>
          <div className="col-md-6">
            <CFormLabel htmlFor="cb-acao">Ação</CFormLabel>
            <CFormSelect id="cb-acao" value={f.acaoId || ''} onChange={(e) => setF({ ...f, acaoId: Number(e.target.value) })}>
              <option value="">Escolha a ação</option>
              {acoes.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nome} · {a.tabelaDestino}
                  {a.ativo ? '' : ' (inativa)'}
                </option>
              ))}
            </CFormSelect>
            <div className="form-text">O cubo lê a tabela que a ação carrega no bi_dados.</div>
          </div>
          {!f.acaoId && f.consultaId && (
            <div className="col-12">
              <CAlert color="info" className="mb-0 small">
                Este cubo usa a consulta de painel <strong>{inicial.consultaNome}</strong>. Ele continua funcionando assim; escolha uma ação para trocar a origem.
              </CAlert>
            </div>
          )}
          <div className="col-12">
            <CFormLabel htmlFor="cb-desc">Descrição (os usuários e a IA leem)</CFormLabel>
            <CFormTextarea
              id="cb-desc"
              rows={2}
              maxLength={500}
              value={f.descricao}
              onChange={(e) => setF({ ...f, descricao: e.target.value })}
              placeholder="Ex.: Faturamento mensal por filial e segmento, desde 2024. Uma linha por mês, filial e segmento."
            />
          </div>
          <div className="col-12">
            <SeletorMultiplo
              id="cb-grupos"
              rotulo="Grupos com acesso"
              placeholder="Nenhum: só Gestor e Desenvolvedor"
              opcoes={grupos.map((g) => ({ value: g.id, label: g.nome }))}
              valor={f.grupos}
              onChange={(g) => setF({ ...f, grupos: g })}
            />
          </div>
          {f.acaoId > 0 && colunas === null && (
            <div className="col-12 text-center py-2">
              <CSpinner size="sm" color="primary" />
            </div>
          )}
          {f.acaoId > 0 && colunas?.length === 0 && (
            <div className="col-12">
              <CAlert color="warning" className="mb-0 small">
                A tabela <code>{tabela}</code> ainda não existe no bi_dados. Rode a tarefa dessa ação uma vez (ou crie a tabela na tela da ação) antes de criar o cubo.
              </CAlert>
            </div>
          )}
          {colunas && colunas.length > 0 && (
            <div className="col-12">
              <span className="form-label d-block">Descrição das colunas</span>
              <p className="form-text mt-0">Ajuda a IA a escolher a coluna certa. Ex.: "vl_liq: valor líquido em R$, sem impostos".</p>
              <div className="cubo-colunas">
                {colunas.map((c) => (
                  <div key={c.nome} className="cubo-coluna">
                    <label htmlFor={`cb-col-${c.nome}`}>
                      <code>{c.nome}</code> <span className="text-body-secondary small">{c.tipo}</span>
                    </label>
                    <CFormInput
                      id={`cb-col-${c.nome}`}
                      size="sm"
                      maxLength={200}
                      value={f.colunasDescricao[c.nome] ?? ''}
                      onChange={(e) => setF({ ...f, colunasDescricao: { ...f.colunasDescricao, [c.nome]: e.target.value } })}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="col-12">
            <CFormSwitch id="cb-ativo" label="Cubo ativo (aparece para os usuários)" checked={f.ativo} onChange={(e) => setF({ ...f, ativo: e.target.checked })} />
          </div>
        </div>
        {erro && (
          <CAlert color="danger" className="mt-3 mb-0">
            {erro}
          </CAlert>
        )}
      </CModalBody>
      <CModalFooter>
        <CButton color="secondary" variant="ghost" onClick={onFechar}>
          Cancelar
        </CButton>
        <CLoadingButton color="primary" loading={salvando} disabled={!f.nome.trim() || (!f.acaoId && !f.consultaId) || (f.acaoId > 0 && !colunas?.length)} onClick={salvar}>
          {inicial.id ? 'Salvar' : 'Criar cubo'}
        </CLoadingButton>
      </CModalFooter>
    </CModal>
  );
}
