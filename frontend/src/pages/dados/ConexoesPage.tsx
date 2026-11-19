import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  CAlert,
  CBadge,
  CButton,
  CCallout,
  CCard,
  CCardBody,
  CCol,
  CForm,
  CFormInput,
  CFormLabel,
  CFormSwitch,
  CFormText,
  CLoadingButton,
  CModal,
  CModalBody,
  CModalFooter,
  CModalHeader,
  CModalTitle,
  CPasswordInput,
  CRow,
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
import { cilPlus, cilStorage } from '@coreui/icons';
import { api, mensagemDeErro } from '../../api/client';
import { Confirmar } from '../../components/Confirmar';
import { useAvisos } from '../../contexts/AvisosContext';
import { formatarDataHora } from '../../lib/formato';
import type { Conexao } from '../../types';

export function ConexoesPage() {
  const avisar = useAvisos();
  const [conexoes, setConexoes] = useState<Conexao[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<Conexao | 'nova' | null>(null);
  const [excluindo, setExcluindo] = useState<Conexao | null>(null);
  const [testando, setTestando] = useState<number | null>(null);

  const carregar = useCallback(async () => {
    try {
      setConexoes((await api.get<Conexao[]>('/conexoes')).data);
    } catch (e) {
      setErro(mensagemDeErro(e));
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function testar(c: Conexao) {
    setTestando(c.id);
    try {
      const { data } = await api.post<{ ok: boolean; mensagem: string }>('/conexoes/testar', { ...c, id: c.id });
      avisar(data.ok ? `${c.nome}: conexão funcionando.` : `${c.nome}: ${data.mensagem}`, data.ok ? 'sucesso' : 'erro');
      carregar();
    } catch (e) {
      avisar(mensagemDeErro(e), 'erro');
    } finally {
      setTestando(null);
    }
  }

  return (
    <>
      <div className="pagina-cabecalho">
        <div>
          <h1 className="pagina-titulo">Conexões</h1>
          <p className="pagina-descricao">Bancos de origem de onde as tarefas buscam os dados. As senhas ficam criptografadas.</p>
        </div>
        <CButton color="primary" onClick={() => setEditando('nova')}>
          <CIcon icon={cilPlus} className="me-1" />
          Nova conexão
        </CButton>
      </div>

      {erro && <CAlert color="danger">{erro}</CAlert>}

      {!conexoes ? (
        <div className="py-5 text-center">
          <CSpinner color="primary" />
        </div>
      ) : conexoes.length === 0 ? (
        <CCard className="estado-vazio">
          <CCardBody>
            <CIcon icon={cilStorage} size="3xl" className="estado-vazio-icone" />
            <h2>Nenhuma conexão cadastrada</h2>
            <p>Cadastre o SQL Server de origem (por exemplo, o ESCALASOFT) com um login somente leitura.</p>
            <CButton color="primary" className="mt-3" onClick={() => setEditando('nova')}>
              Cadastrar conexão
            </CButton>
          </CCardBody>
        </CCard>
      ) : (
        <CCard>
          <CCardBody>
            <CTable hover responsive align="middle" className="mb-0 tabela-lista">
              <CTableHead>
                <CTableRow>
                  <CTableHeaderCell>Conexão</CTableHeaderCell>
                  <CTableHeaderCell>Servidor</CTableHeaderCell>
                  <CTableHeaderCell>Usuário</CTableHeaderCell>
                  <CTableHeaderCell>Último teste</CTableHeaderCell>
                  <CTableHeaderCell>Ações</CTableHeaderCell>
                  <CTableHeaderCell className="text-end">
                    <span className="visually-hidden">Ações</span>
                  </CTableHeaderCell>
                </CTableRow>
              </CTableHead>
              <CTableBody>
                {conexoes.map((c) => (
                  <CTableRow key={c.id}>
                    <CTableDataCell>
                      <div className="fw-semibold">
                        {c.nome}
                        {!c.ativo && (
                          <CBadge color="secondary" className="ms-2">
                            Inativa
                          </CBadge>
                        )}
                      </div>
                      <div className="small text-body-secondary">SQL Server · {c.banco}</div>
                    </CTableDataCell>
                    <CTableDataCell className="font-mono small">
                      {c.host}:{c.porta}
                    </CTableDataCell>
                    <CTableDataCell>{c.usuario}</CTableDataCell>
                    <CTableDataCell>
                      {!c.ultimoTeste ? (
                        <span className="small text-body-secondary">Nunca testada</span>
                      ) : (
                        <CTooltip content={c.ultimoTeste.mensagem}>
                          <span className="d-inline-flex align-items-center gap-2" tabIndex={0}>
                            <CBadge color={c.ultimoTeste.ok ? 'success' : 'danger'}>{c.ultimoTeste.ok ? 'OK' : 'Falhou'}</CBadge>
                            <span className="small text-body-secondary">{formatarDataHora(c.ultimoTeste.em)}</span>
                          </span>
                        </CTooltip>
                      )}
                    </CTableDataCell>
                    <CTableDataCell>{c.acoes}</CTableDataCell>
                    <CTableDataCell className="text-end text-nowrap">
                      <CLoadingButton color="secondary" variant="ghost" size="sm" loading={testando === c.id} onClick={() => testar(c)}>
                        Testar
                      </CLoadingButton>
                      <CButton color="secondary" variant="ghost" size="sm" onClick={() => setEditando(c)}>
                        Editar
                      </CButton>
                      <CButton color="danger" variant="ghost" size="sm" onClick={() => setExcluindo(c)}>
                        Excluir
                      </CButton>
                    </CTableDataCell>
                  </CTableRow>
                ))}
              </CTableBody>
            </CTable>
          </CCardBody>
        </CCard>
      )}

      {editando && (
        <FormularioConexao
          conexao={editando === 'nova' ? null : editando}
          onFechar={() => setEditando(null)}
          onSalvo={(c, nova) => {
            setEditando(null);
            avisar(nova ? `Conexão ${c.nome} criada.` : `Conexão ${c.nome} atualizada.`);
            carregar();
          }}
        />
      )}

      <Confirmar
        visivel={!!excluindo}
        titulo="Excluir conexão?"
        acao="Excluir conexão"
        perigoso
        onConfirmar={async () => {
          try {
            await api.delete(`/conexoes/${excluindo!.id}`);
            avisar(`Conexão ${excluindo!.nome} excluída.`);
            carregar();
          } catch (e) {
            avisar(mensagemDeErro(e), 'erro');
          }
          setExcluindo(null);
        }}
        onFechar={() => setExcluindo(null)}
      >
        A conexão <strong>{excluindo?.nome}</strong> só pode ser excluída se nenhuma ação a estiver usando.
      </Confirmar>
    </>
  );
}

function FormularioConexao(props: { conexao: Conexao | null; onFechar: () => void; onSalvo: (c: Conexao, nova: boolean) => void }) {
  const nova = !props.conexao;
  const [f, setF] = useState({
    nome: props.conexao?.nome ?? '',
    host: props.conexao?.host ?? '',
    porta: props.conexao?.porta ?? 1433,
    banco: props.conexao?.banco ?? '',
    usuario: props.conexao?.usuario ?? '',
    senha: '',
    criptografar: props.conexao?.criptografar ?? true,
    confiarCertificado: props.conexao?.confiarCertificado ?? true,
    ativo: props.conexao?.ativo ?? true,
  });
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [teste, setTeste] = useState<{ ok: boolean; mensagem: string } | null>(null);
  const [testando, setTestando] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setSalvando(true);
    try {
      const { data } = nova ? await api.post<Conexao>('/conexoes', f) : await api.put<Conexao>(`/conexoes/${props.conexao!.id}`, f);
      props.onSalvo(data, nova);
    } catch (err) {
      setErro(mensagemDeErro(err));
    } finally {
      setSalvando(false);
    }
  }

  async function testar() {
    setTeste(null);
    setTestando(true);
    try {
      const { data } = await api.post<{ ok: boolean; mensagem: string }>('/conexoes/testar', { ...f, id: props.conexao?.id });
      setTeste(data);
    } catch (err) {
      setTeste({ ok: false, mensagem: mensagemDeErro(err) });
    } finally {
      setTestando(false);
    }
  }

  return (
    <CModal visible onClose={props.onFechar} alignment="center" size="lg" backdrop="static">
      <CForm onSubmit={salvar} noValidate>
        <CModalHeader>
          <CModalTitle>{nova ? 'Nova conexão SQL Server' : `Editar ${props.conexao!.nome}`}</CModalTitle>
        </CModalHeader>
        <CModalBody>
          {erro && <CAlert color="danger" className="py-2">{erro}</CAlert>}
          <CRow className="g-3">
            <CCol md={6}>
              <CFormLabel htmlFor="c-nome">Nome da conexão</CFormLabel>
              <CFormInput id="c-nome" value={f.nome} maxLength={60} autoFocus placeholder="ESCALA" onChange={(e) => set('nome', e.target.value)} />
              <CFormText>Como ela aparece nas ações.</CFormText>
            </CCol>
            <CCol md={6}>
              <CFormLabel htmlFor="c-banco">Banco de dados</CFormLabel>
              <CFormInput id="c-banco" value={f.banco} maxLength={120} placeholder="ESCALASOFT" onChange={(e) => set('banco', e.target.value)} />
            </CCol>
            <CCol md={8}>
              <CFormLabel htmlFor="c-host">Servidor (host ou IP)</CFormLabel>
              <CFormInput id="c-host" value={f.host} maxLength={160} placeholder="172.16.10.3" onChange={(e) => set('host', e.target.value)} />
            </CCol>
            <CCol md={4}>
              <CFormLabel htmlFor="c-porta">Porta</CFormLabel>
              <CFormInput id="c-porta" type="number" value={f.porta} min={1} max={65535} onChange={(e) => set('porta', Number(e.target.value))} />
            </CCol>
            <CCol md={6}>
              <CFormLabel htmlFor="c-usuario">Usuário</CFormLabel>
              <CFormInput id="c-usuario" value={f.usuario} maxLength={120} autoComplete="off" placeholder="bi_leitura" onChange={(e) => set('usuario', e.target.value)} />
            </CCol>
            <CCol md={6}>
              <CFormLabel htmlFor="c-senha">Senha</CFormLabel>
              <CPasswordInput
                id="c-senha"
                autoComplete="new-password"
                value={f.senha}
                placeholder={nova ? '' : 'Mantida. Preencha só para trocar.'}
                onChange={(e) => set('senha', e.target.value)}
              />
            </CCol>
            <CCol md={6}>
              <CFormSwitch id="c-cripto" label="Criptografar a conexão (TLS)" checked={f.criptografar} onChange={(e) => set('criptografar', e.target.checked)} />
            </CCol>
            <CCol md={6}>
              <CFormSwitch
                id="c-confiar"
                label="Confiar no certificado do servidor"
                checked={f.confiarCertificado}
                onChange={(e) => set('confiarCertificado', e.target.checked)}
              />
              <CFormText>Necessário quando o SQL Server usa certificado próprio (o mais comum na rede interna).</CFormText>
            </CCol>
            <CCol md={12}>
              <CFormSwitch id="c-ativo" label="Conexão ativa" checked={f.ativo} onChange={(e) => set('ativo', e.target.checked)} />
            </CCol>
          </CRow>
          <CCallout color="info" className="mb-0 mt-3 small">
            Use um login <strong>somente leitura</strong>, como o <code>bi_leitura</code>. A ferramenta só lê da origem e grava as cargas
            no banco <code>bi_dados</code>.
          </CCallout>
          {teste && (
            <CAlert color={teste.ok ? 'success' : 'danger'} className="mt-3 mb-0 small">
              {teste.mensagem}
            </CAlert>
          )}
        </CModalBody>
        <CModalFooter className="justify-content-between">
          <CLoadingButton color="secondary" variant="outline" loading={testando} onClick={testar}>
            Testar conexão
          </CLoadingButton>
          <div className="d-flex gap-2">
            <CButton color="secondary" variant="ghost" onClick={props.onFechar}>
              Cancelar
            </CButton>
            <CLoadingButton type="submit" color="primary" loading={salvando}>
              {nova ? 'Criar conexão' : 'Salvar alterações'}
            </CLoadingButton>
          </div>
        </CModalFooter>
      </CForm>
    </CModal>
  );
}
