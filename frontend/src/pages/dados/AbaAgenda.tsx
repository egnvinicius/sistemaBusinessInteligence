import { useState } from 'react';
import {
  CBadge,
  CButton,
  CButtonGroup,
  CCard,
  CCardBody,
  CCardHeader,
  CFormSwitch,
  CLoadingButton,
} from '@coreui/react-pro';
import CIcon from '@coreui/icons-react';
import { cilPlus } from '@coreui/icons';
import { api, mensagemDeErro } from '../../api/client';
import { Confirmar } from '../../components/Confirmar';
import { useAvisos } from '../../contexts/AvisosContext';
import { DIAS_SEMANA, MESES, resumoAgenda } from '../../lib/execucoes';
import type { Agenda, TarefaDetalhe } from '../../types';

type Rascunho = Omit<Agenda, 'id'> & { id: number | null };

const NOVA: Rascunho = {
  id: null,
  repetirPor: 'semana',
  diasSemana: [1, 2, 3, 4, 5],
  diasMes: [],
  meses: [],
  horas: [7],
  minutos: [0],
  ativa: true,
};

const HORAS = Array.from({ length: 24 }, (_, i) => i);
const MINUTOS = Array.from({ length: 12 }, (_, i) => i * 5);
const DIAS_MES = Array.from({ length: 31 }, (_, i) => i + 1);

export function AbaAgenda({ tarefa, editavel, onAlterado }: { tarefa: TarefaDetalhe; editavel: boolean; onAlterado: () => void }) {
  const [nova, setNova] = useState<Rascunho | null>(null);

  return (
    <>
      <p className="text-body-secondary small">
        A tarefa entra na fila sempre que o relógio coincidir com uma linha de agenda. Campo sem nada marcado vale para todos (por exemplo, nenhum
        mês marcado = todos os meses). Cada linha pode ter parâmetros próprios, na aba Parâmetros.
      </p>
      {tarefa.agendas.length === 0 && !nova && (
        <CCard className="mb-3">
          <CCardBody className="text-body-secondary">Sem agenda: a tarefa só roda quando alguém clica em &ldquo;Executar agora&rdquo;.</CCardBody>
        </CCard>
      )}
      {tarefa.agendas.map((a, i) => (
        <LinhaAgenda key={a.id} numero={i + 1} tarefaId={tarefa.id} inicial={a} editavel={editavel} onAlterado={onAlterado} />
      ))}
      {nova && (
        <LinhaAgenda
          numero={tarefa.agendas.length + 1}
          tarefaId={tarefa.id}
          inicial={nova}
          editavel
          onCancelarNova={() => setNova(null)}
          onAlterado={() => {
            setNova(null);
            onAlterado();
          }}
        />
      )}
      {editavel && !nova && (
        <CButton color="secondary" variant="outline" onClick={() => setNova({ ...NOVA })}>
          <CIcon icon={cilPlus} className="me-1" />
          Nova linha de agenda
        </CButton>
      )}
    </>
  );
}

function LinhaAgenda(props: {
  numero: number;
  tarefaId: number;
  inicial: Rascunho;
  editavel: boolean;
  onAlterado: () => void;
  onCancelarNova?: () => void;
}) {
  const avisar = useAvisos();
  const [a, setA] = useState<Rascunho>(props.inicial);
  const [salvando, setSalvando] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const nova = a.id === null;
  const alterado = nova || JSON.stringify(a) !== JSON.stringify(props.inicial);
  const ed = props.editavel;

  const set = <K extends keyof Rascunho>(k: K, v: Rascunho[K]) => setA((x) => ({ ...x, [k]: v }));
  const alternar = (k: 'diasSemana' | 'diasMes' | 'meses' | 'horas' | 'minutos', v: number) =>
    setA((x) => ({ ...x, [k]: x[k].includes(v) ? x[k].filter((y) => y !== v) : [...x[k], v].sort((p, q) => p - q) }));

  async function salvar() {
    setSalvando(true);
    try {
      const corpo = { ...a, id: undefined };
      if (nova) await api.post(`/tarefas/${props.tarefaId}/agendas`, corpo);
      else await api.put(`/tarefas/agendas/${a.id}`, corpo);
      avisar('Agenda salva.');
      props.onAlterado();
    } catch (e) {
      avisar(mensagemDeErro(e), 'erro');
    } finally {
      setSalvando(false);
    }
  }

  const Chips = ({ campo, valores, rotulo, nome }: { campo: 'diasSemana' | 'diasMes' | 'meses' | 'horas' | 'minutos'; valores: number[]; rotulo: (v: number) => string; nome: string }) => (
    <div className="chips" role="group" aria-label={nome}>
      {valores.map((v) => {
        const marcado = a[campo].includes(v);
        return (
          <button
            key={v}
            type="button"
            className={`chip ${marcado ? 'marcado' : ''}`}
            aria-pressed={marcado}
            disabled={!ed}
            onClick={() => alternar(campo, v)}
          >
            {rotulo(v)}
          </button>
        );
      })}
    </div>
  );

  const Atalho = ({ rotulo, aplicar }: { rotulo: string; aplicar: () => void }) =>
    ed ? (
      <button type="button" className="atalho" onClick={aplicar}>
        {rotulo}
      </button>
    ) : null;

  return (
    <CCard className={`mb-3 agenda-linha ${!a.ativa ? 'inativa' : ''}`}>
      <CCardHeader className="d-flex align-items-center gap-3 flex-wrap">
        <strong>Agenda {props.numero}</strong>
        <span className="text-body-secondary small flex-grow-1">{resumoAgenda({ ...a, id: a.id ?? 0 })}</span>
        {!a.ativa && <CBadge color="secondary">Pausada</CBadge>}
        {ed && <CFormSwitch id={`ag-ativa-${a.id ?? 'nova'}`} label="Ativa" checked={a.ativa} onChange={(e) => set('ativa', e.target.checked)} />}
      </CCardHeader>
      <CCardBody>
        <div className="agenda-grade">
          <div className="agenda-campo">
            <div className="agenda-rotulo">
              <span>Repetir por</span>
            </div>
            <CButtonGroup size="sm" role="group" aria-label="Repetir por">
              <CButton
                color="secondary"
                variant={a.repetirPor === 'semana' ? undefined : 'outline'}
                disabled={!ed}
                onClick={() => setA((x) => ({ ...x, repetirPor: 'semana', diasMes: [] }))}
              >
                Dias da semana
              </CButton>
              <CButton
                color="secondary"
                variant={a.repetirPor === 'mes' ? undefined : 'outline'}
                disabled={!ed}
                onClick={() => setA((x) => ({ ...x, repetirPor: 'mes', diasSemana: [] }))}
              >
                Dias do mês
              </CButton>
            </CButtonGroup>
          </div>

          {a.repetirPor === 'semana' ? (
            <div className="agenda-campo">
              <div className="agenda-rotulo">
                <span>Dias da semana</span>
                {Atalho({ rotulo: 'Dias úteis', aplicar: () => set('diasSemana', [1, 2, 3, 4, 5]) })}
                {Atalho({ rotulo: 'Todos', aplicar: () => set('diasSemana', []) })}
              </div>
              {Chips({ campo: 'diasSemana', valores: [1, 2, 3, 4, 5, 6, 0], rotulo: (d) => DIAS_SEMANA[d], nome: 'Dias da semana' })}
            </div>
          ) : (
            <div className="agenda-campo">
              <div className="agenda-rotulo">
                <span>Dias do mês</span>
                {Atalho({ rotulo: 'Todos', aplicar: () => set('diasMes', []) })}
              </div>
              {Chips({ campo: 'diasMes', valores: DIAS_MES, rotulo: String, nome: 'Dias do mês' })}
            </div>
          )}

          <div className="agenda-campo">
            <div className="agenda-rotulo">
              <span>Meses</span>
              {Atalho({ rotulo: 'Todos', aplicar: () => set('meses', []) })}
            </div>
            {Chips({ campo: 'meses', valores: MESES.map((_, i) => i + 1), rotulo: (m) => MESES[m - 1], nome: 'Meses' })}
          </div>

          <div className="agenda-campo">
            <div className="agenda-rotulo">
              <span>Horas</span>
              {Atalho({ rotulo: 'Comercial (07h a 18h)', aplicar: () => set('horas', HORAS.filter((h) => h >= 7 && h <= 18)) })}
              {Atalho({ rotulo: 'Todas', aplicar: () => set('horas', HORAS) })}
            </div>
            {Chips({ campo: 'horas', valores: HORAS, rotulo: (h) => `${String(h).padStart(2, '0')}h`, nome: 'Horas' })}
          </div>

          <div className="agenda-campo">
            <div className="agenda-rotulo">
              <span>Minutos</span>
              {Atalho({ rotulo: 'Hora cheia', aplicar: () => set('minutos', [0]) })}
              {Atalho({ rotulo: 'A cada 15 min', aplicar: () => set('minutos', [0, 15, 30, 45]) })}
              {Atalho({ rotulo: 'A cada 5 min', aplicar: () => set('minutos', MINUTOS) })}
            </div>
            {Chips({ campo: 'minutos', valores: MINUTOS, rotulo: (m) => `:${String(m).padStart(2, '0')}`, nome: 'Minutos' })}
          </div>
        </div>

        {ed && (
          <div className="d-flex gap-2 justify-content-end mt-3">
            {nova ? (
              <CButton color="secondary" variant="ghost" onClick={props.onCancelarNova}>
                Cancelar
              </CButton>
            ) : (
              <>
                <CButton color="danger" variant="ghost" onClick={() => setExcluindo(true)}>
                  Excluir linha
                </CButton>
                <CButton color="secondary" variant="ghost" disabled={!alterado} onClick={() => setA(props.inicial)}>
                  Descartar
                </CButton>
              </>
            )}
            <CLoadingButton
              color="primary"
              loading={salvando}
              disabled={!alterado || !a.horas.length || !a.minutos.length}
              title={!a.horas.length || !a.minutos.length ? 'Marque pelo menos uma hora e um minuto' : undefined}
              onClick={salvar}
            >
              {nova ? 'Adicionar agenda' : 'Salvar agenda'}
            </CLoadingButton>
          </div>
        )}
      </CCardBody>

      <Confirmar
        visivel={excluindo}
        titulo="Excluir esta linha de agenda?"
        acao="Excluir"
        perigoso
        onConfirmar={async () => {
          try {
            await api.delete(`/tarefas/agendas/${a.id}`);
            avisar('Linha de agenda excluída.');
            props.onAlterado();
          } catch (e) {
            avisar(mensagemDeErro(e), 'erro');
          }
          setExcluindo(false);
        }}
        onFechar={() => setExcluindo(false)}
      >
        Os parâmetros específicos desta linha também são excluídos.
      </Confirmar>
    </CCard>
  );
}
