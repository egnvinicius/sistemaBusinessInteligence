import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  CAlert,
  CBadge,
  CButton,
  CCard,
  CCardBody,
  CDropdown,
  CDropdownItem,
  CDropdownMenu,
  CDropdownToggle,
  CForm,
  CFormInput,
  CFormLabel,
  CFormSelect,
  CFormSwitch,
  CFormText,
  CInputGroup,
  CInputGroupText,
  CLoadingButton,
  CModal,
  CModalBody,
  CModalFooter,
  CModalHeader,
  CModalTitle,
  CPasswordInput,
  CSpinner,
  CTable,
  CTableBody,
  CTableDataCell,
  CTableHead,
  CTableHeaderCell,
  CTableRow,
} from '@coreui/react-pro';
import CIcon from '@coreui/icons-react';
import { cilCopy, cilOptions, cilPlus, cilSearch } from '@coreui/icons';
import { api, mensagemDeErro } from '../../api/client';
import { Confirmar } from '../../components/Confirmar';
import { SeletorMultiplo } from '../../components/SeletorMultiplo';
import { useAuth } from '../../contexts/AuthContext';
import { useAvisos } from '../../contexts/AvisosContext';
import { useMenu } from '../../contexts/MenuContext';
import { contem, formatarDataHora } from '../../lib/formato';
import { ehDesenvolvedor, NOME_PERFIL, type GrupoAcesso, type Perfil, type UsuarioAdmin } from '../../types';

type Filtro = 'todos' | 'ativos' | 'inativos';

export function UsuariosPage() {
  const { usuario: eu } = useAuth();
  const avisar = useAvisos();
  const { recarregarMenu } = useMenu();
  const [usuarios, setUsuarios] = useState<UsuarioAdmin[] | null>(null);
  const [grupos, setGrupos] = useState<GrupoAcesso[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('ativos');
  const [editando, setEditando] = useState<UsuarioAdmin | 'novo' | null>(null);
  const [excluindo, setExcluindo] = useState<UsuarioAdmin | null>(null);
  const [redefinindo, setRedefinindo] = useState<UsuarioAdmin | null>(null);
  const [senhaGerada, setSenhaGerada] = useState<{ usuario: UsuarioAdmin; senha: string } | null>(null);

  const carregar = useCallback(async () => {
    try {
      const [u, g] = await Promise.all([api.get<UsuarioAdmin[]>('/usuarios'), api.get<GrupoAcesso[]>('/grupos')]);
      setUsuarios(u.data);
      setGrupos(g.data);
    } catch (e) {
      setErro(mensagemDeErro(e));
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const visiveis = useMemo(
    () =>
      (usuarios ?? []).filter(
        (u) =>
          (filtro === 'todos' || (filtro === 'ativos' ? u.ativo : !u.ativo)) &&
          (!busca || contem(u.nome, busca) || contem(u.login, busca) || contem(u.email, busca)),
      ),
    [usuarios, busca, filtro],
  );

  async function excluir() {
    if (!excluindo) return;
    try {
      await api.delete(`/usuarios/${excluindo.id}`);
      avisar(`Usuário ${excluindo.nome} excluído.`);
      setExcluindo(null);
      carregar();
    } catch (e) {
      avisar(mensagemDeErro(e), 'erro');
    }
  }

  async function redefinir() {
    if (!redefinindo) return;
    try {
      const { data } = await api.post<{ senhaTemporaria: string; usuario: UsuarioAdmin }>(
        `/usuarios/${redefinindo.id}/redefinir-senha`,
      );
      setRedefinindo(null);
      setSenhaGerada({ usuario: data.usuario, senha: data.senhaTemporaria });
      carregar();
    } catch (e) {
      avisar(mensagemDeErro(e), 'erro');
    }
  }

  return (
    <>
      <div className="pagina-cabecalho">
        <div>
          <h1 className="pagina-titulo">Usuários</h1>
          <p className="pagina-descricao">Quem acessa a ferramenta e de quais grupos faz parte.</p>
        </div>
        <CButton color="primary" onClick={() => setEditando('novo')}>
          <CIcon icon={cilPlus} className="me-1" />
          Novo usuário
        </CButton>
      </div>

      {erro && <CAlert color="danger">{erro}</CAlert>}

      <CCard>
        <CCardBody>
          <div className="lista-filtros">
            <CInputGroup className="lista-busca">
              <CInputGroupText>
                <CIcon icon={cilSearch} />
              </CInputGroupText>
              <CFormInput
                placeholder="Buscar por nome, login ou e-mail"
                aria-label="Buscar usuários"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
            </CInputGroup>
            <CFormSelect
              className="lista-filtro-status"
              aria-label="Filtrar por situação"
              value={filtro}
              onChange={(e) => setFiltro(e.target.value as Filtro)}
            >
              <option value="ativos">Ativos</option>
              <option value="inativos">Inativos</option>
              <option value="todos">Todos</option>
            </CFormSelect>
          </div>

          {!usuarios ? (
            <div className="py-5 text-center">
              <CSpinner color="primary" />
            </div>
          ) : visiveis.length === 0 ? (
            <p className="lista-vazia">
              {busca ? 'Nenhum usuário encontrado com essa busca.' : 'Nenhum usuário nesta situação.'}
            </p>
          ) : (
            <CTable hover responsive align="middle" className="mb-0 tabela-lista">
              <CTableHead>
                <CTableRow>
                  <CTableHeaderCell>Nome</CTableHeaderCell>
                  <CTableHeaderCell>Login</CTableHeaderCell>
                  <CTableHeaderCell>Grupos</CTableHeaderCell>
                  <CTableHeaderCell>Situação</CTableHeaderCell>
                  <CTableHeaderCell>Último acesso</CTableHeaderCell>
                  <CTableHeaderCell className="text-end">
                    <span className="visually-hidden">Ações</span>
                  </CTableHeaderCell>
                </CTableRow>
              </CTableHead>
              <CTableBody>
                {visiveis.map((u) => (
                  <CTableRow key={u.id}>
                    <CTableDataCell>
                      <div className="fw-semibold">
                        {u.nome}
                        {u.perfil !== 'usuario' && (
                          <CBadge color="primary" shape="rounded-pill" className="ms-2 badge-leve">
                            {NOME_PERFIL[u.perfil]}
                          </CBadge>
                        )}
                      </div>
                      {u.email && <div className="small text-body-secondary">{u.email}</div>}
                    </CTableDataCell>
                    <CTableDataCell>{u.login}</CTableDataCell>
                    <CTableDataCell>
                      {u.grupos.length ? (
                        <div className="d-flex flex-wrap gap-1">
                          {u.grupos.map((g) => (
                            <CBadge key={g.id} color="secondary" className="badge-leve">
                              {g.nome}
                            </CBadge>
                          ))}
                        </div>
                      ) : (
                        <span className="text-body-secondary small">{u.perfil !== 'usuario' ? 'Vê todos os painéis' : 'Sem grupo'}</span>
                      )}
                    </CTableDataCell>
                    <CTableDataCell>
                      <Situacao u={u} />
                      {!u.sessaoMeiaNoite && !u.sessaoInatividadeHoras && (
                        <CBadge color="info" className="badge-leve ms-1" title="A sessão deste usuário não expira (torre de controle)">
                          Sessão sem expirar
                        </CBadge>
                      )}
                    </CTableDataCell>
                    <CTableDataCell className="small text-nowrap">{formatarDataHora(u.ultimoAcesso)}</CTableDataCell>
                    <CTableDataCell className="text-end text-nowrap">
                      {u.perfil === 'desenvolvedor' && !ehDesenvolvedor(eu) ? (
                        <span className="small text-body-secondary" title="Contas de Desenvolvedor só podem ser alteradas por outro Desenvolvedor.">
                          Somente Desenvolvedor
                        </span>
                      ) : (
                        <>
                          <CButton color="secondary" variant="ghost" size="sm" onClick={() => setEditando(u)}>
                            Editar
                          </CButton>
                          <CDropdown alignment="end" className="d-inline-block">
                            <CDropdownToggle color="secondary" variant="ghost" size="sm" caret={false} aria-label={`Mais ações para ${u.nome}`}>
                              <CIcon icon={cilOptions} />
                            </CDropdownToggle>
                            <CDropdownMenu>
                              <CDropdownItem as="button" onClick={() => setRedefinindo(u)}>
                                Redefinir senha
                              </CDropdownItem>
                              <CDropdownItem
                                as="button"
                                className="text-danger"
                                disabled={u.id === eu?.id}
                                onClick={() => setExcluindo(u)}
                              >
                                Excluir
                              </CDropdownItem>
                            </CDropdownMenu>
                          </CDropdown>
                        </>
                      )}
                    </CTableDataCell>
                  </CTableRow>
                ))}
              </CTableBody>
            </CTable>
          )}
        </CCardBody>
      </CCard>

      {editando && (
        <FormularioUsuario
          usuario={editando === 'novo' ? null : editando}
          grupos={grupos}
          ehVoceMesmo={editando !== 'novo' && editando.id === eu?.id}
          podeDesenvolvedor={ehDesenvolvedor(eu)}
          onFechar={() => setEditando(null)}
          onSalvo={(u, novo) => {
            setEditando(null);
            avisar(novo ? `Usuário ${u.nome} criado.` : `Usuário ${u.nome} atualizado.`);
            carregar();
            if (u.id === eu?.id) recarregarMenu();
          }}
        />
      )}

      <Confirmar
        visivel={!!excluindo}
        titulo="Excluir usuário?"
        acao="Excluir usuário"
        perigoso
        onConfirmar={excluir}
        onFechar={() => setExcluindo(null)}
      >
        <p>
          <strong>{excluindo?.nome}</strong> perde o acesso imediatamente e sai de todos os grupos.
        </p>
        <p className="mb-0 text-body-secondary small">
          Se a pessoa pode voltar no futuro, prefira desativar o usuário na edição: o cadastro e o histórico são mantidos.
        </p>
      </Confirmar>

      <Confirmar
        visivel={!!redefinindo}
        titulo="Redefinir a senha?"
        acao="Gerar senha temporária"
        onConfirmar={redefinir}
        onFechar={() => setRedefinindo(null)}
      >
        Uma senha temporária será gerada para <strong>{redefinindo?.nome}</strong>. As sessões abertas dele são encerradas
        e, no próximo acesso, ele precisa criar uma senha nova. Também desbloqueia o usuário, se estiver bloqueado.
      </Confirmar>

      <CModal visible={!!senhaGerada} onClose={() => setSenhaGerada(null)} alignment="center">
        <CModalHeader>
          <CModalTitle>Senha temporária de {senhaGerada?.usuario.nome}</CModalTitle>
        </CModalHeader>
        <CModalBody>
          <CInputGroup className="mb-3">
            <CFormInput readOnly value={senhaGerada?.senha ?? ''} className="senha-temporaria" aria-label="Senha temporária" />
            <CButton
              color="secondary"
              variant="outline"
              onClick={() => {
                navigator.clipboard?.writeText(senhaGerada?.senha ?? '');
                avisar('Senha copiada.');
              }}
            >
              <CIcon icon={cilCopy} className="me-1" />
              Copiar
            </CButton>
          </CInputGroup>
          <p className="mb-0 small text-body-secondary">
            Repasse a senha ao usuário por um canal seguro. Ela é mostrada só agora; no próximo acesso ele cria uma senha
            própria.
          </p>
        </CModalBody>
        <CModalFooter>
          <CButton color="primary" onClick={() => setSenhaGerada(null)}>
            Concluir
          </CButton>
        </CModalFooter>
      </CModal>
    </>
  );
}

function Situacao({ u }: { u: UsuarioAdmin }) {
  if (!u.ativo) return <CBadge color="secondary">Inativo</CBadge>;
  if (u.bloqueado) return <CBadge color="danger">Bloqueado</CBadge>;
  if (u.trocaSenhaObrigatoria) return <CBadge color="warning" textColor="dark">Aguardando 1º acesso</CBadge>;
  return <CBadge color="success">Ativo</CBadge>;
}

/* ---------- Formulário ---------- */

function gerarSenha() {
  const letras = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
  const numeros = '23456789';
  const todos = letras + numeros;
  const aleatorio = (n: number) => crypto.getRandomValues(new Uint32Array(1))[0] % n;
  const chars = [letras[aleatorio(letras.length)], numeros[aleatorio(numeros.length)]];
  while (chars.length < 10) chars.push(todos[aleatorio(todos.length)]);
  return chars.sort(() => aleatorio(3) - 1).join('');
}

function FormularioUsuario(props: {
  usuario: UsuarioAdmin | null;
  grupos: GrupoAcesso[];
  ehVoceMesmo: boolean;
  podeDesenvolvedor: boolean;
  onFechar: () => void;
  onSalvo: (u: UsuarioAdmin, novo: boolean) => void;
}) {
  const novo = !props.usuario;
  const [nome, setNome] = useState(props.usuario?.nome ?? '');
  const [login, setLogin] = useState(props.usuario?.login ?? '');
  const [email, setEmail] = useState(props.usuario?.email ?? '');
  const [senha, setSenha] = useState('');
  const [senhaGerada, setSenhaGerada] = useState(false);
  const [perfil, setPerfil] = useState<Perfil>(props.usuario?.perfil ?? 'usuario');
  const [ativo, setAtivo] = useState(props.usuario?.ativo ?? true);
  const [grupos, setGrupos] = useState<number[]>(props.usuario?.grupos.map((g) => g.id) ?? []);
  const [meiaNoite, setMeiaNoite] = useState(props.usuario?.sessaoMeiaNoite ?? false);
  // Usuário novo começa com a sessão encerrada após 8 horas sem uso
  const [porInatividade, setPorInatividade] = useState(props.usuario ? props.usuario.sessaoInatividadeHoras !== null : true);
  const [horas, setHoras] = useState(String(props.usuario?.sessaoInatividadeHoras ?? 8));
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setSalvando(true);
    const corpo = {
      nome,
      login,
      email,
      perfil,
      ativo,
      grupos,
      sessaoMeiaNoite: meiaNoite,
      sessaoInatividadeHoras: porInatividade ? Number(horas) : null,
      ...(novo ? { senha } : {}),
    };
    try {
      const { data } = novo
        ? await api.post<UsuarioAdmin>('/usuarios', corpo)
        : await api.put<UsuarioAdmin>(`/usuarios/${props.usuario!.id}`, corpo);
      props.onSalvo(data, novo);
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
          <CModalTitle>{novo ? 'Novo usuário' : `Editar ${props.usuario!.nome}`}</CModalTitle>
        </CModalHeader>
        <CModalBody>
          {erro && <CAlert color="danger" className="py-2">{erro}</CAlert>}
          <div className="row g-3">
            <div className="col-md-6">
              <CFormLabel htmlFor="u-nome">Nome completo</CFormLabel>
              <CFormInput id="u-nome" value={nome} maxLength={120} autoFocus onChange={(e) => setNome(e.target.value)} />
            </div>
            <div className="col-md-6">
              <CFormLabel htmlFor="u-email">E-mail</CFormLabel>
              <CFormInput id="u-email" type="email" value={email} maxLength={160} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="col-md-6">
              <CFormLabel htmlFor="u-login">Login</CFormLabel>
              <CFormInput
                id="u-login"
                value={login}
                maxLength={60}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => setLogin(e.target.value.trim())}
              />
              <CFormText>Letras, números, ponto, hífen e sublinhado.</CFormText>
            </div>
            {novo && (
              <div className="col-md-6">
                <CFormLabel htmlFor="u-senha">Senha inicial</CFormLabel>
                <div className="d-flex gap-2">
                  <CPasswordInput
                    id="u-senha"
                    autoComplete="new-password"
                    value={senha}
                    showPassword={senhaGerada}
                    onChange={(e) => setSenha(e.target.value)}
                  />
                  <CButton color="secondary" variant="outline" onClick={() => {
                      setSenha(gerarSenha());
                      setSenhaGerada(true);
                    }}>
                    Gerar
                  </CButton>
                </div>
                <CFormText>O usuário cria a própria senha no primeiro acesso.</CFormText>
              </div>
            )}
            <div className="col-12">
              <SeletorMultiplo
                id="u-grupos"
                rotulo="Grupos de acesso"
                opcoes={props.grupos.map((g) => ({ value: g.id, label: g.nome }))}
                valor={grupos}
                onChange={setGrupos}
                placeholder={props.grupos.length ? 'Selecione os grupos' : 'Nenhum grupo cadastrado ainda'}
              />
              <CFormText>Os grupos definem quais painéis a pessoa vê no menu.</CFormText>
            </div>
            <div className="col-md-6">
              <CFormLabel htmlFor="u-perfil">Perfil</CFormLabel>
              <CFormSelect
                id="u-perfil"
                value={perfil}
                disabled={props.ehVoceMesmo}
                onChange={(e) => setPerfil(e.target.value as Perfil)}
              >
                <option value="usuario">Usuário: vê os painéis dos seus grupos</option>
                <option value="gestor">Gestor: vê todos os painéis e administra</option>
                <option value="desenvolvedor" disabled={!props.podeDesenvolvedor}>
                  Desenvolvedor: também SQL, conexões e tabelas
                </option>
              </CFormSelect>
              {props.ehVoceMesmo && <CFormText>Você não pode mudar o próprio perfil.</CFormText>}
            </div>
            <div className="col-md-6">
              <CFormLabel className="d-block">Situação</CFormLabel>
              <CFormSwitch
                id="u-ativo"
                label="Usuário ativo"
                checked={ativo}
                disabled={props.ehVoceMesmo}
                onChange={(e) => setAtivo(e.target.checked)}
              />
              <CFormText>Inativo não consegue entrar; o cadastro é mantido.</CFormText>
            </div>
            <fieldset className="col-12 sessao-campos">
              <legend className="form-label fs-6 mb-1">Sessão</legend>
              <CFormSwitch
                id="u-meia-noite"
                label="Encerrar a sessão à meia-noite"
                checked={meiaNoite}
                onChange={(e) => setMeiaNoite(e.target.checked)}
              />
              <div className="sessao-inatividade">
                <CFormSwitch
                  id="u-inatividade"
                  label="Encerrar após"
                  checked={porInatividade}
                  onChange={(e) => setPorInatividade(e.target.checked)}
                />
                <CInputGroup size="sm" className="sessao-horas">
                  <CFormInput
                    id="u-horas"
                    type="number"
                    min={1}
                    max={720}
                    inputMode="numeric"
                    aria-label="Horas sem uso para encerrar a sessão"
                    value={horas}
                    disabled={!porInatividade}
                    onChange={(e) => setHoras(e.target.value)}
                  />
                  <CInputGroupText>horas sem uso</CInputGroupText>
                </CInputGroup>
              </div>
              <CFormText>
                {!meiaNoite && !porInatividade
                  ? 'Nada marcado: a sessão não expira. Use para telas de torre de controle, que ficam abertas o tempo todo.'
                  : 'Atualizações automáticas (painel em tela cheia, listas que se atualizam sozinhas) não contam como uso. Vale o que acontecer primeiro.'}
              </CFormText>
            </fieldset>
          </div>
        </CModalBody>
        <CModalFooter>
          <CButton color="secondary" variant="ghost" onClick={props.onFechar}>
            Cancelar
          </CButton>
          <CLoadingButton type="submit" color="primary" loading={salvando}>
            {novo ? 'Criar usuário' : 'Salvar alterações'}
          </CLoadingButton>
        </CModalFooter>
      </CForm>
    </CModal>
  );
}
