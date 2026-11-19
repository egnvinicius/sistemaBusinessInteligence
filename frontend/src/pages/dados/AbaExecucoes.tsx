import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CBadge,
  CButton,
  CCard,
  CCardBody,
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
import { api, AUTOMATICO, mensagemDeErro } from '../../api/client';
import { BadgeSituacao, duracao, ORIGEM } from '../../lib/execucoes';
import { formatarDataHora } from '../../lib/formato';
import type { Execucao, ExecucaoDetalhe } from '../../types';

const EM_ANDAMENTO = ['na_fila', 'executando'];

export function AbaExecucoes(props: { tarefaId: number; versao: number; onAndamento: (e: Execucao | null) => void }) {
  const [execucoes, setExecucoes] = useState<Execucao[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aberta, setAberta] = useState<number | null>(null);
  const { onAndamento } = props;

  const carregar = useCallback(async (automatico = false) => {
    try {
      const { data } = await api.get<Execucao[]>(`/tarefas/${props.tarefaId}/execucoes`, { params: { limite: 100 }, ...(automatico ? AUTOMATICO : {}) });
      setExecucoes(data);
      onAndamento(data.find((e) => EM_ANDAMENTO.includes(e.situacao)) ?? null);
    } catch (e) {
      setErro(mensagemDeErro(e));
    }
  }, [props.tarefaId, onAndamento]);

  // Atualiza a cada 3 s enquanto houver execução em andamento; senão, a cada 15 s
  const temAndamento = !!execucoes?.some((e) => EM_ANDAMENTO.includes(e.situacao));
  useEffect(() => {
    carregar();
  }, [carregar, props.versao]);
  useEffect(() => {
    const t = setInterval(() => carregar(true), temAndamento ? 3_000 : 15_000);
    return () => clearInterval(t);
  }, [carregar, temAndamento]);

  if (erro) return <p className="text-danger">{erro}</p>;
  if (!execucoes) {
    return (
      <div className="py-5 text-center">
        <CSpinner color="primary" />
      </div>
    );
  }
  if (!execucoes.length) {
    return (
      <CCard>
        <CCardBody className="text-body-secondary">
          Esta tarefa ainda não foi executada. Use &ldquo;Executar agora&rdquo; para a primeira carga ou aguarde o horário da agenda.
        </CCardBody>
      </CCard>
    );
  }

  return (
    <>
      <CCard>
        <CCardBody>
          <CTable hover responsive align="middle" className="mb-0 tabela-lista">
            <CTableHead>
              <CTableRow>
                <CTableHeaderCell>Quando</CTableHeaderCell>
                <CTableHeaderCell>Origem</CTableHeaderCell>
                <CTableHeaderCell>Situação</CTableHeaderCell>
                <CTableHeaderCell>Duração</CTableHeaderCell>
                <CTableHeaderCell>Observação</CTableHeaderCell>
              </CTableRow>
            </CTableHead>
            <CTableBody>
              {execucoes.map((e) => (
                <CTableRow
                  key={e.id}
                  className="linha-clicavel"
                  onClick={() => setAberta(e.id)}
                  tabIndex={0}
                  onKeyDown={(k) => k.key === 'Enter' && setAberta(e.id)}
                  aria-label={`Ver detalhes da execução de ${formatarDataHora(e.criadoEm)}`}
                >
                  <CTableDataCell className="text-nowrap">
                    {formatarDataHora(e.inicio ?? e.agendadoPara ?? e.criadoEm)}
                  </CTableDataCell>
                  <CTableDataCell className="small">
                    {ORIGEM[e.origem]}
                    {e.solicitadoPor && <span className="text-body-secondary"> · {e.solicitadoPor}</span>}
                  </CTableDataCell>
                  <CTableDataCell>
                    <BadgeSituacao situacao={e.situacao} />
                  </CTableDataCell>
                  <CTableDataCell className="small text-nowrap">{duracao(e.inicio, e.fim)}</CTableDataCell>
                  <CTableDataCell className="small text-body-secondary observacao">{e.mensagem ?? ''}</CTableDataCell>
                </CTableRow>
              ))}
            </CTableBody>
          </CTable>
        </CCardBody>
      </CCard>
      {aberta && <DetalheExecucao id={aberta} onFechar={() => setAberta(null)} />}
    </>
  );
}

const SITUACAO_ACAO: Record<ExecucaoDetalhe['acoes'][number]['situacao'], { rotulo: string; cor: string }> = {
  pendente: { rotulo: 'Aguardando', cor: 'light' },
  executando: { rotulo: 'Executando', cor: 'primary' },
  concluido: { rotulo: 'Concluída', cor: 'success' },
  erro: { rotulo: 'Erro', cor: 'danger' },
  cancelado: { rotulo: 'Cancelada', cor: 'secondary' },
  pulado: { rotulo: 'Não executada', cor: 'secondary' },
};

const numero = (n: number | null) => (n === null ? '—' : n.toLocaleString('pt-BR'));
const hora = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR');

/** Ações e log de uma execução; atualiza sozinho enquanto ela roda. */
function DetalheExecucao({ id, onFechar }: { id: number; onFechar: () => void }) {
  const [d, setD] = useState<ExecucaoDetalhe | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const fimLog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let ativo = true;
    const buscar = async () => {
      try {
        const { data } = await api.get<ExecucaoDetalhe>(`/tarefas/execucoes/${id}`);
        if (ativo) setD(data);
        return EM_ANDAMENTO.includes(data.situacao);
      } catch (e) {
        if (ativo) setErro(mensagemDeErro(e));
        return false;
      }
    };
    let t: ReturnType<typeof setTimeout>;
    const ciclo = async () => {
      if (await buscar()) t = setTimeout(ciclo, 2_000);
    };
    ciclo();
    return () => {
      ativo = false;
      clearTimeout(t);
    };
  }, [id]);

  useEffect(() => {
    if (d && EM_ANDAMENTO.includes(d.situacao)) fimLog.current?.scrollIntoView({ block: 'nearest' });
  }, [d]);

  return (
    <CModal visible onClose={onFechar} size="xl" alignment="center" scrollable>
      <CModalHeader>
        <CModalTitle className="d-flex align-items-center gap-2">
          Execução de {d ? formatarDataHora(d.inicio ?? d.criadoEm) : '…'}
          {d && <BadgeSituacao situacao={d.situacao} />}
        </CModalTitle>
      </CModalHeader>
      <CModalBody>
        {erro && <p className="text-danger">{erro}</p>}
        {!d ? (
          <div className="py-4 text-center">
            <CSpinner color="primary" />
          </div>
        ) : (
          <>
            <dl className="detalhe-execucao">
              <div>
                <dt>Origem</dt>
                <dd>
                  {ORIGEM[d.origem]}
                  {d.solicitadoPor ? ` · ${d.solicitadoPor}` : ''}
                </dd>
              </div>
              {d.agendadoPara && (
                <div>
                  <dt>Horário agendado</dt>
                  <dd>{formatarDataHora(d.agendadoPara)}</dd>
                </div>
              )}
              <div>
                <dt>Duração</dt>
                <dd>{duracao(d.inicio, d.fim)}</dd>
              </div>
              {d.parametros && Object.keys(d.parametros).length > 0 && (
                <div className="detalhe-parametros">
                  <dt>Parâmetros</dt>
                  <dd>
                    {Object.entries(d.parametros).map(([k, v]) => (
                      <CBadge key={k} color="secondary" className="badge-leve font-mono me-1">
                        @{k} = {v}
                      </CBadge>
                    ))}
                  </dd>
                </div>
              )}
            </dl>
            {d.mensagem && <p className="mb-3">{d.mensagem}</p>}

            {d.acoes.length > 0 && (
              <>
                <h3 className="subtitulo">Ações</h3>
                <CTable small responsive className="tabela-lista mb-4">
                  <CTableHead>
                    <CTableRow>
                      <CTableHeaderCell>Ordem</CTableHeaderCell>
                      <CTableHeaderCell>Ação</CTableHeaderCell>
                      <CTableHeaderCell>Situação</CTableHeaderCell>
                      <CTableHeaderCell className="text-end">Excluídas</CTableHeaderCell>
                      <CTableHeaderCell className="text-end">Inseridas</CTableHeaderCell>
                      <CTableHeaderCell>Duração</CTableHeaderCell>
                    </CTableRow>
                  </CTableHead>
                  <CTableBody>
                    {d.acoes.map((a) => (
                      <CTableRow key={`${a.ordem}-${a.nome}`}>
                        <CTableDataCell>{a.ordem}</CTableDataCell>
                        <CTableDataCell>
                          <div className="font-mono small">{a.nome}</div>
                          {a.mensagem && <div className={`small ${a.situacao === 'erro' ? 'text-danger' : 'text-body-secondary'}`}>{a.mensagem}</div>}
                        </CTableDataCell>
                        <CTableDataCell>
                          <CBadge color={SITUACAO_ACAO[a.situacao].cor} textColor={a.situacao === 'pendente' ? 'dark' : undefined}>
                            {SITUACAO_ACAO[a.situacao].rotulo}
                          </CBadge>
                        </CTableDataCell>
                        <CTableDataCell className="text-end">{numero(a.linhasExcluidas)}</CTableDataCell>
                        <CTableDataCell className="text-end">{numero(a.linhasInseridas)}</CTableDataCell>
                        <CTableDataCell className="small text-nowrap">{duracao(a.inicio, a.fim)}</CTableDataCell>
                      </CTableRow>
                    ))}
                  </CTableBody>
                </CTable>
              </>
            )}

            <h3 className="subtitulo">Log</h3>
            {d.logs.length === 0 ? (
              <p className="text-body-secondary small">Sem registros ainda.</p>
            ) : (
              <ol className="log-execucao">
                {d.logs.map((l, i) => (
                  <li key={i} className={`log-${l.nivel}`}>
                    <time>{hora(l.dataHora)}</time>
                    <span>{l.mensagem}</span>
                  </li>
                ))}
              </ol>
            )}
            <div ref={fimLog} />
          </>
        )}
      </CModalBody>
      <CModalFooter>
        <CButton color="primary" onClick={onFechar}>
          Fechar
        </CButton>
      </CModalFooter>
    </CModal>
  );
}
