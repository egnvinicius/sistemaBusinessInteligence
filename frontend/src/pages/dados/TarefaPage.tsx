import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  CAlert,
  CBadge,
  CBreadcrumb,
  CBreadcrumbItem,
  CButton,
  CLoadingButton,
  CNav,
  CNavItem,
  CNavLink,
  CSpinner,
  CTabContent,
  CTabPane,
} from '@coreui/react-pro';
import CIcon from '@coreui/icons-react';
import { cilMediaPlay, cilMediaStop } from '@coreui/icons';
import { api, mensagemDeErro } from '../../api/client';
import { Confirmar } from '../../components/Confirmar';
import { useAuth } from '../../contexts/AuthContext';
import { useAvisos } from '../../contexts/AvisosContext';
import { formatarDataHora } from '../../lib/formato';
import { ehDesenvolvedor, type Execucao, type TarefaDetalhe } from '../../types';
import { AbaAcoes } from './AbaAcoes';
import { AbaAgenda } from './AbaAgenda';
import { AbaExecucoes } from './AbaExecucoes';
import { AbaParametros } from './AbaParametros';
import { FormularioTarefa, type GrupoTarefa } from './FormularioTarefa';

type Aba = 'execucoes' | 'acoes' | 'agenda' | 'parametros';

export function TarefaPage() {
  const { id } = useParams();
  const tarefaId = Number(id);
  const navigate = useNavigate();
  const avisar = useAvisos();
  const { usuario } = useAuth();
  const dev = ehDesenvolvedor(usuario);
  const [tarefa, setTarefa] = useState<TarefaDetalhe | null>(null);
  const [grupos, setGrupos] = useState<GrupoTarefa[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [aba, setAba] = useState<Aba>('execucoes');
  const [editando, setEditando] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const [andamento, setAndamento] = useState<Execucao | null>(null);
  const [agindo, setAgindo] = useState(false);
  const [versaoExecucoes, setVersaoExecucoes] = useState(0);

  const carregar = useCallback(async () => {
    try {
      const [t, g] = await Promise.all([api.get<TarefaDetalhe>(`/tarefas/${tarefaId}`), api.get<GrupoTarefa[]>('/tarefas/grupos')]);
      setTarefa(t.data);
      setGrupos(g.data);
    } catch (e) {
      setErro(mensagemDeErro(e));
    }
  }, [tarefaId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function executar() {
    setAgindo(true);
    try {
      await api.post(`/tarefas/${tarefaId}/executar`);
      avisar(`${tarefa?.nome} entrou na fila.`);
      setAba('execucoes');
      setVersaoExecucoes((v) => v + 1);
    } catch (e) {
      avisar(mensagemDeErro(e), 'erro');
    } finally {
      setAgindo(false);
    }
  }

  async function parar() {
    setAgindo(true);
    try {
      await api.post(`/tarefas/${tarefaId}/parar`);
      avisar(andamento?.situacao === 'na_fila' ? 'Execução retirada da fila.' : 'Interrompendo a execução…');
      setVersaoExecucoes((v) => v + 1);
    } catch (e) {
      avisar(mensagemDeErro(e), 'erro');
    } finally {
      setAgindo(false);
    }
  }

  if (erro) return <CAlert color="danger">{erro}</CAlert>;
  if (!tarefa) {
    return (
      <div className="py-5 text-center">
        <CSpinner color="primary" />
      </div>
    );
  }

  const abas: { chave: Aba; rotulo: string; contagem?: number }[] = [
    { chave: 'execucoes', rotulo: 'Execuções' },
    { chave: 'acoes', rotulo: 'Ações', contagem: tarefa.acoes.length },
    { chave: 'agenda', rotulo: 'Agenda', contagem: tarefa.agendas.length },
    ...(tarefa.parametrosVisiveis ? [{ chave: 'parametros' as Aba, rotulo: 'Parâmetros', contagem: tarefa.parametros.length }] : []),
  ];

  return (
    <>
      <CBreadcrumb className="mb-2">
        <CBreadcrumbItem>
          <Link to="/dados/tarefas">Tarefas</Link>
        </CBreadcrumbItem>
        <CBreadcrumbItem>{tarefa.grupo.nome}</CBreadcrumbItem>
        <CBreadcrumbItem active>{tarefa.nome}</CBreadcrumbItem>
      </CBreadcrumb>

      <div className="pagina-cabecalho">
        <div>
          <h1 className="pagina-titulo d-flex align-items-center gap-2">
            {tarefa.nome}
            {!tarefa.ativa && <CBadge color="secondary">Desativada</CBadge>}
          </h1>
          <p className="pagina-descricao">
            {tarefa.descricao ? `${tarefa.descricao} · ` : ''}
            {tarefa.proxima ? `Próxima execução: ${formatarDataHora(tarefa.proxima)}` : tarefa.ativa ? 'Sem agenda ativa' : 'Não segue a agenda'}
          </p>
        </div>
        <div className="d-flex gap-2 flex-wrap">
          {andamento ? (
            <CLoadingButton color="danger" loading={agindo} onClick={parar}>
              <CIcon icon={cilMediaStop} className="me-1" />
              {andamento.situacao === 'na_fila' ? 'Tirar da fila' : 'Parar execução'}
            </CLoadingButton>
          ) : (
            <CLoadingButton color="primary" loading={agindo} disabled={!tarefa.acoes.length} onClick={executar}>
              <CIcon icon={cilMediaPlay} className="me-1" />
              Executar agora
            </CLoadingButton>
          )}
          {dev && (
            <>
              <CButton color="secondary" variant="outline" onClick={() => setEditando(true)}>
                Editar tarefa
              </CButton>
              <CButton color="danger" variant="outline" onClick={() => setExcluindo(true)}>
                Excluir
              </CButton>
            </>
          )}
        </div>
      </div>

      <CNav variant="underline-border" role="tablist" className="mb-4">
        {abas.map((a) => (
          <CNavItem key={a.chave}>
            <CNavLink as="button" active={aba === a.chave} onClick={() => setAba(a.chave)} role="tab" aria-selected={aba === a.chave}>
              {a.rotulo}
              {a.contagem !== undefined && <span className="aba-contagem">{a.contagem}</span>}
            </CNavLink>
          </CNavItem>
        ))}
      </CNav>

      <CTabContent>
        <CTabPane visible={aba === 'execucoes'} role="tabpanel">
          <AbaExecucoes tarefaId={tarefaId} versao={versaoExecucoes} onAndamento={setAndamento} />
        </CTabPane>
        <CTabPane visible={aba === 'acoes'} role="tabpanel">
          {aba === 'acoes' && <AbaAcoes tarefa={tarefa} editavel={dev} onSalvo={carregar} />}
        </CTabPane>
        <CTabPane visible={aba === 'agenda'} role="tabpanel">
          {aba === 'agenda' && <AbaAgenda tarefa={tarefa} editavel={dev} onAlterado={carregar} />}
        </CTabPane>
        {tarefa.parametrosVisiveis && (
          <CTabPane visible={aba === 'parametros'} role="tabpanel">
            {aba === 'parametros' && <AbaParametros tarefa={tarefa} onAlterado={carregar} />}
          </CTabPane>
        )}
      </CTabContent>

      {editando && (
        <FormularioTarefa
          tarefa={tarefa}
          grupos={grupos}
          onFechar={() => setEditando(false)}
          onSalvo={() => {
            setEditando(false);
            avisar('Tarefa atualizada.');
            carregar();
          }}
        />
      )}

      <Confirmar
        visivel={excluindo}
        titulo="Excluir tarefa?"
        acao="Excluir tarefa"
        perigoso
        onConfirmar={async () => {
          try {
            await api.delete(`/tarefas/${tarefaId}`);
            avisar(`Tarefa ${tarefa.nome} excluída.`);
            navigate('/dados/tarefas');
          } catch (e) {
            avisar(mensagemDeErro(e), 'erro');
            setExcluindo(false);
          }
        }}
        onFechar={() => setExcluindo(false)}
      >
        A tarefa <strong>{tarefa.nome}</strong>, a agenda, os parâmetros e o histórico de execuções serão excluídos. As ações continuam no catálogo e
        os dados já carregados no bi_dados são mantidos.
      </Confirmar>
    </>
  );
}
