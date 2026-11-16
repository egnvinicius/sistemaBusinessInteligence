import { useState, type FormEvent } from 'react';
import {
  CAlert,
  CButton,
  CCol,
  CForm,
  CFormInput,
  CFormLabel,
  CFormSelect,
  CFormSwitch,
  CFormText,
  CLoadingButton,
  CModal,
  CModalBody,
  CModalFooter,
  CModalHeader,
  CModalTitle,
  CRow,
} from '@coreui/react-pro';
import { api, mensagemDeErro } from '../../api/client';
import type { TarefaDetalhe } from '../../types';

export interface GrupoTarefa {
  id: number;
  nome: string;
  tarefas: number;
}

/** Criar ou editar os dados gerais de uma tarefa. */
export function FormularioTarefa(props: {
  tarefa?: TarefaDetalhe;
  grupos: GrupoTarefa[];
  onFechar: () => void;
  onSalvo: (id: number) => void;
}) {
  const t = props.tarefa;
  const [f, setF] = useState({
    grupoId: t?.grupo.id ?? props.grupos[0]?.id ?? 0,
    nome: t?.nome ?? '',
    descricao: t?.descricao ?? '',
    ativa: t?.ativa ?? true,
    maxTentativasAcesso: t?.maxTentativasAcesso ?? 5,
    janelaTentativasMin: t?.janelaTentativasMin ?? 15,
  });
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setSalvando(true);
    try {
      const corpo = { ...f, descricao: f.descricao || null };
      const { data } = t ? await api.put<{ id: number }>(`/tarefas/${t.id}`, corpo) : await api.post<{ id: number }>('/tarefas', corpo);
      props.onSalvo(data.id);
    } catch (err) {
      setErro(mensagemDeErro(err));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <CModal visible onClose={props.onFechar} alignment="center" size="lg" backdrop="static">
      <CForm onSubmit={salvar} noValidate>
        <CModalHeader>
          <CModalTitle>{t ? `Editar ${t.nome}` : 'Nova tarefa'}</CModalTitle>
        </CModalHeader>
        <CModalBody>
          {erro && <CAlert color="danger" className="py-2">{erro}</CAlert>}
          <CRow className="g-3">
            <CCol md={7}>
              <CFormLabel htmlFor="t-nome">Nome da tarefa</CFormLabel>
              <CFormInput id="t-nome" value={f.nome} maxLength={120} autoFocus placeholder="ATU_COMERCIAL" onChange={(e) => set('nome', e.target.value.toUpperCase())} />
            </CCol>
            <CCol md={5}>
              <CFormLabel htmlFor="t-grupo">Grupo</CFormLabel>
              <CFormSelect id="t-grupo" value={f.grupoId} onChange={(e) => set('grupoId', Number(e.target.value))}>
                {props.grupos.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.nome}
                  </option>
                ))}
              </CFormSelect>
            </CCol>
            <CCol md={12}>
              <CFormLabel htmlFor="t-descricao">Descrição (opcional)</CFormLabel>
              <CFormInput id="t-descricao" value={f.descricao} maxLength={255} onChange={(e) => set('descricao', e.target.value)} />
            </CCol>
            <CCol md={12}>
              <fieldset>
                <legend className="form-label fs-6">Se o servidor não responder</legend>
                <div className="d-flex flex-wrap align-items-center gap-2">
                  <span>Tentar até</span>
                  <CFormInput
                    aria-label="Número máximo de tentativas"
                    type="number"
                    min={1}
                    max={50}
                    className="campo-numero-curto"
                    value={f.maxTentativasAcesso}
                    onChange={(e) => set('maxTentativasAcesso', Number(e.target.value))}
                  />
                  <span>vezes ou por</span>
                  <CFormInput
                    aria-label="Tempo máximo tentando, em minutos"
                    type="number"
                    min={1}
                    max={720}
                    className="campo-numero-curto"
                    value={f.janelaTentativasMin}
                    onChange={(e) => set('janelaTentativasMin', Number(e.target.value))}
                  />
                  <span>minutos, o que vier primeiro.</span>
                </div>
                <CFormText>
                  Depois disso, a execução termina com erro e o log registra qual servidor não respondeu. O mesmo prazo vale para rodar com atraso
                  quando a ferramenta estava fora do ar no horário agendado.
                </CFormText>
              </fieldset>
            </CCol>
            <CCol md={12}>
              <CFormSwitch id="t-ativa" label="Tarefa ativa (segue a agenda)" checked={f.ativa} onChange={(e) => set('ativa', e.target.checked)} />
            </CCol>
          </CRow>
        </CModalBody>
        <CModalFooter>
          <CButton color="secondary" variant="ghost" onClick={props.onFechar}>
            Cancelar
          </CButton>
          <CLoadingButton type="submit" color="primary" loading={salvando}>
            {t ? 'Salvar alterações' : 'Criar tarefa'}
          </CLoadingButton>
        </CModalFooter>
      </CForm>
    </CModal>
  );
}
