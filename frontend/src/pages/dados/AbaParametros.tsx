import { useState, type FormEvent } from 'react';
import {
  CAlert,
  CBadge,
  CButton,
  CButtonGroup,
  CCard,
  CCardBody,
  CCardHeader,
  CCol,
  CForm,
  CFormInput,
  CFormLabel,
  CFormSelect,
  CFormText,
  CLoadingButton,
  CModal,
  CModalBody,
  CModalFooter,
  CModalHeader,
  CModalTitle,
  CRow,
  CTable,
  CTableBody,
  CTableDataCell,
  CTableHead,
  CTableHeaderCell,
  CTableRow,
} from '@coreui/react-pro';
import CIcon from '@coreui/icons-react';
import { cilPlus } from '@coreui/icons';
import { api, mensagemDeErro } from '../../api/client';
import { Confirmar } from '../../components/Confirmar';
import { useAvisos } from '../../contexts/AvisosContext';
import { resumoAgenda } from '../../lib/execucoes';
import type { ParametroTarefa, TarefaDetalhe } from '../../types';

const TIPO = { texto: 'Texto', numero: 'Número', data: 'Data' };

export function AbaParametros({ tarefa, onAlterado }: { tarefa: TarefaDetalhe; onAlterado: () => void }) {
  const avisar = useAvisos();
  const [editando, setEditando] = useState<Partial<ParametroTarefa> | null>(null);
  const [excluindo, setExcluindo] = useState<ParametroTarefa | null>(null);
  const [agendaTeste, setAgendaTeste] = useState<number | null>(null);
  const [testando, setTestando] = useState(false);
  const [resultado, setResultado] = useState<{ valores: { nome: string; valor: string; origem: string }[] } | { erro: string } | null>(null);

  const blocos: { agendaId: number | null; titulo: string; descricao: string }[] = [
    { agendaId: null, titulo: 'Padrão', descricao: 'Vale para toda execução, inclusive a manual.' },
    ...tarefa.agendas.map((a, i) => ({
      agendaId: a.id,
      titulo: `Agenda ${i + 1}`,
      descricao: `${resumoAgenda(a)}. Substitui o padrão quando a tarefa roda por esta linha.`,
    })),
  ];

  async function testar() {
    setTestando(true);
    setResultado(null);
    try {
      const { data } = await api.post(`/tarefas/${tarefa.id}/parametros/testar`, { agendaId: agendaTeste });
      setResultado(data);
    } catch (e) {
      setResultado({ erro: mensagemDeErro(e) });
    } finally {
      setTestando(false);
    }
  }

  return (
    <>
      <p className="text-body-secondary small">
        Use nos SQLs das ações como <code>@NOME</code>. Uma <strong>expressão</strong> é calculada no SQL Server a cada execução, na conexão da
        primeira ação da tarefa. Exemplo: <code>FORMAT(DATEADD(month, -3, GETDATE()), &apos;yyyyMM&apos;)</code> traz o ano e mês de 3 meses atrás.
      </p>

      {blocos.map((b) => {
        const lista = tarefa.parametros.filter((p) => p.agendaId === b.agendaId);
        return (
          <CCard className="mb-3" key={b.agendaId ?? 'padrao'}>
            <CCardHeader className="d-flex align-items-center gap-3 flex-wrap">
              <strong>{b.titulo}</strong>
              <span className="small text-body-secondary flex-grow-1">{b.descricao}</span>
              <CButton color="secondary" variant="outline" size="sm" onClick={() => setEditando({ agendaId: b.agendaId, tipo: 'texto', modo: 'fixo' })}>
                <CIcon icon={cilPlus} className="me-1" />
                Parâmetro
              </CButton>
            </CCardHeader>
            <CCardBody className={lista.length ? 'p-0' : undefined}>
              {lista.length === 0 ? (
                <span className="small text-body-secondary">
                  {b.agendaId === null ? 'Nenhum parâmetro.' : 'Nenhuma sobrescrita: esta agenda usa os valores padrão.'}
                </span>
              ) : (
                <CTable responsive align="middle" className="mb-0 tabela-lista">
                  <CTableHead>
                    <CTableRow>
                      <CTableHeaderCell>Nome</CTableHeaderCell>
                      <CTableHeaderCell>Tipo</CTableHeaderCell>
                      <CTableHeaderCell>Valor</CTableHeaderCell>
                      <CTableHeaderCell className="text-end">
                        <span className="visually-hidden">Ações</span>
                      </CTableHeaderCell>
                    </CTableRow>
                  </CTableHead>
                  <CTableBody>
                    {lista.map((p) => (
                      <CTableRow key={p.id}>
                        <CTableDataCell className="font-mono fw-semibold">@{p.nome}</CTableDataCell>
                        <CTableDataCell>{TIPO[p.tipo]}</CTableDataCell>
                        <CTableDataCell>
                          {p.modo === 'expressao' && (
                            <CBadge color="info" textColor="dark" className="me-2">
                              Expressão
                            </CBadge>
                          )}
                          <code className="valor-parametro">{p.valor}</code>
                        </CTableDataCell>
                        <CTableDataCell className="text-end text-nowrap">
                          <CButton color="secondary" variant="ghost" size="sm" onClick={() => setEditando(p)}>
                            Editar
                          </CButton>
                          <CButton color="danger" variant="ghost" size="sm" onClick={() => setExcluindo(p)}>
                            Excluir
                          </CButton>
                        </CTableDataCell>
                      </CTableRow>
                    ))}
                  </CTableBody>
                </CTable>
              )}
            </CCardBody>
          </CCard>
        );
      })}

      <CCard>
        <CCardHeader>
          <strong>Calcular agora</strong>
          <span className="small text-body-secondary ms-2">Mostra os valores que uma execução usaria neste momento, sem carregar dados.</span>
        </CCardHeader>
        <CCardBody>
          <div className="d-flex gap-2 flex-wrap align-items-center">
            <CFormSelect
              aria-label="Valores de qual agenda"
              className="seletor-adicionar"
              value={agendaTeste ?? ''}
              onChange={(e) => setAgendaTeste(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">Execução manual (valores padrão)</option>
              {tarefa.agendas.map((a, i) => (
                <option key={a.id} value={a.id}>
                  Agenda {i + 1}: {resumoAgenda(a)}
                </option>
              ))}
            </CFormSelect>
            <CLoadingButton color="secondary" variant="outline" loading={testando} onClick={testar}>
              Calcular
            </CLoadingButton>
          </div>
          {resultado &&
            ('erro' in resultado ? (
              <CAlert color="danger" className="mt-3 mb-0 small">
                {resultado.erro}
              </CAlert>
            ) : resultado.valores.length === 0 ? (
              <p className="mt-3 mb-0 small text-body-secondary">Nenhum parâmetro definido.</p>
            ) : (
              <ul className="lista-valores mt-3 mb-0">
                {resultado.valores.map((v) => (
                  <li key={v.nome}>
                    <span className="font-mono fw-semibold">@{v.nome}</span>
                    <span className="font-mono">{v.valor}</span>
                    <span className="small text-body-secondary">{v.origem === 'agenda' ? 'da agenda' : 'padrão'}</span>
                  </li>
                ))}
              </ul>
            ))}
        </CCardBody>
      </CCard>

      {editando && (
        <FormularioParametro
          tarefaId={tarefa.id}
          parametro={editando}
          titulo={blocos.find((b) => b.agendaId === (editando.agendaId ?? null))?.titulo ?? 'Padrão'}
          onFechar={() => setEditando(null)}
          onSalvo={() => {
            setEditando(null);
            avisar('Parâmetro salvo.');
            onAlterado();
          }}
        />
      )}

      <Confirmar
        visivel={!!excluindo}
        titulo={`Excluir @${excluindo?.nome}?`}
        acao="Excluir"
        perigoso
        onConfirmar={async () => {
          try {
            await api.delete(`/tarefas/parametros/${excluindo!.id}`);
            avisar('Parâmetro excluído.');
            onAlterado();
          } catch (e) {
            avisar(mensagemDeErro(e), 'erro');
          }
          setExcluindo(null);
        }}
        onFechar={() => setExcluindo(null)}
      >
        Se alguma ação desta tarefa usar <code>@{excluindo?.nome}</code>, ela vai falhar na próxima execução.
      </Confirmar>
    </>
  );
}

function FormularioParametro(props: {
  tarefaId: number;
  parametro: Partial<ParametroTarefa>;
  titulo: string;
  onFechar: () => void;
  onSalvo: () => void;
}) {
  const p = props.parametro;
  const [f, setF] = useState({
    nome: p.nome ?? '',
    tipo: p.tipo ?? 'texto',
    modo: p.modo ?? 'fixo',
    valor: p.valor ?? '',
  });
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setSalvando(true);
    try {
      const corpo = { ...f, agendaId: p.agendaId ?? null };
      if (p.id) await api.put(`/tarefas/parametros/${p.id}`, corpo);
      else await api.post(`/tarefas/${props.tarefaId}/parametros`, corpo);
      props.onSalvo();
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
          <CModalTitle>
            {p.id ? `Editar @${p.nome}` : 'Novo parâmetro'} <span className="text-body-secondary fs-6">· {props.titulo}</span>
          </CModalTitle>
        </CModalHeader>
        <CModalBody>
          {erro && <CAlert color="danger" className="py-2">{erro}</CAlert>}
          <CRow className="g-3">
            <CCol md={6}>
              <CFormLabel htmlFor="p-nome-param">Nome</CFormLabel>
              <div className="input-group">
                <span className="input-group-text">@</span>
                <CFormInput
                  id="p-nome-param"
                  value={f.nome}
                  maxLength={60}
                  autoFocus
                  spellCheck={false}
                  placeholder="ANOMES_INI"
                  onChange={(e) => set('nome', e.target.value.replace(/^@/, '').toUpperCase())}
                />
              </div>
            </CCol>
            <CCol md={6}>
              <CFormLabel htmlFor="p-tipo-param">Tipo</CFormLabel>
              <CFormSelect id="p-tipo-param" value={f.tipo} onChange={(e) => set('tipo', e.target.value as typeof f.tipo)}>
                <option value="texto">Texto (ex.: 202608)</option>
                <option value="numero">Número</option>
                <option value="data">Data</option>
              </CFormSelect>
            </CCol>
            <CCol md={12}>
              <span className="form-label d-block">Valor</span>
              <CButtonGroup size="sm" role="group" aria-label="Tipo de valor" className="mb-2">
                <CButton color="secondary" variant={f.modo === 'fixo' ? undefined : 'outline'} onClick={() => set('modo', 'fixo')}>
                  Fixo
                </CButton>
                <CButton color="secondary" variant={f.modo === 'expressao' ? undefined : 'outline'} onClick={() => set('modo', 'expressao')}>
                  Expressão (calculada no SQL Server)
                </CButton>
              </CButtonGroup>
              <CFormInput
                aria-label="Valor do parâmetro"
                className="font-mono"
                value={f.valor}
                maxLength={2000}
                spellCheck={false}
                placeholder={
                  f.modo === 'expressao'
                    ? "FORMAT(DATEADD(month, -3, GETDATE()), 'yyyyMM')"
                    : f.tipo === 'data'
                      ? '01/01/2026'
                      : f.tipo === 'numero'
                        ? '30'
                        : '202601'
                }
                onChange={(e) => set('valor', e.target.value)}
              />
              <CFormText>
                {f.modo === 'expressao'
                  ? 'Um único valor, sem ";". Na ferramenta antiga isto era o "EXEC=". As funções Oracle mudam: SYSDATE vira GETDATE(), ADD_MONTHS vira DATEADD e TO_CHAR vira FORMAT.'
                  : f.tipo === 'data'
                    ? 'Formato DD/MM/AAAA ou AAAA-MM-DD.'
                    : 'Sem aspas: o valor é enviado separado do SQL, já no tipo certo.'}
              </CFormText>
            </CCol>
          </CRow>
        </CModalBody>
        <CModalFooter>
          <CButton color="secondary" variant="ghost" onClick={props.onFechar}>
            Cancelar
          </CButton>
          <CLoadingButton type="submit" color="primary" loading={salvando}>
            {p.id ? 'Salvar alterações' : 'Adicionar parâmetro'}
          </CLoadingButton>
        </CModalFooter>
      </CForm>
    </CModal>
  );
}
