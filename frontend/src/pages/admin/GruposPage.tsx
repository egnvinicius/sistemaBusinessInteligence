import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  CAlert,
  CButton,
  CCard,
  CCardBody,
  CForm,
  CFormInput,
  CFormLabel,
  CFormText,
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
import { cilGroup, cilPlus } from '@coreui/icons';
import { api, mensagemDeErro } from '../../api/client';
import { Confirmar } from '../../components/Confirmar';
import { SeletorMultiplo, type OpcaoSeletor } from '../../components/SeletorMultiplo';
import { useAvisos } from '../../contexts/AvisosContext';
import { useMenu } from '../../contexts/MenuContext';
import { plural } from '../../lib/formato';
import type { ArvoreGrupo, ArvoreSubgrupo, GrupoAcesso, UsuarioAdmin } from '../../types';

export function GruposPage() {
  const avisar = useAvisos();
  const { recarregarMenu } = useMenu();
  const [grupos, setGrupos] = useState<GrupoAcesso[] | null>(null);
  const [usuarios, setUsuarios] = useState<UsuarioAdmin[]>([]);
  const [arvore, setArvore] = useState<ArvoreGrupo[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<GrupoAcesso | 'novo' | null>(null);
  const [excluindo, setExcluindo] = useState<GrupoAcesso | null>(null);

  const carregar = useCallback(async () => {
    try {
      const [g, u, a] = await Promise.all([
        api.get<GrupoAcesso[]>('/grupos'),
        api.get<UsuarioAdmin[]>('/usuarios'),
        api.get<ArvoreGrupo[]>('/admin/menu/arvore'),
      ]);
      setGrupos(g.data);
      setUsuarios(u.data);
      setArvore(a.data);
    } catch (e) {
      setErro(mensagemDeErro(e));
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const opcoesUsuarios: OpcaoSeletor[] = useMemo(
    () =>
      usuarios.map((u) => ({
        value: u.id,
        label: u.ativo ? `${u.nome} (${u.login})` : `${u.nome} (${u.login}, inativo)`,
      })),
    [usuarios],
  );

  const opcoesPaineis: OpcaoSeletor[] = useMemo(() => {
    const opcoes: OpcaoSeletor[] = [];
    const visitar = (s: ArvoreSubgrupo, caminho: string) => {
      const aqui = `${caminho} › ${s.nome}`;
      for (const p of s.paineis) opcoes.push({ value: p.id, label: p.ativo ? p.nome : `${p.nome} (inativo)`, grupo: aqui });
      for (const f of s.subgrupos) visitar(f, aqui);
    };
    for (const g of arvore) for (const s of g.subgrupos) visitar(s, g.nome);
    return opcoes;
  }, [arvore]);

  async function excluir() {
    if (!excluindo) return;
    try {
      await api.delete(`/grupos/${excluindo.id}`);
      avisar(`Grupo ${excluindo.nome} excluído.`);
      setExcluindo(null);
      carregar();
      recarregarMenu();
    } catch (e) {
      avisar(mensagemDeErro(e), 'erro');
    }
  }

  return (
    <>
      <div className="pagina-cabecalho">
        <div>
          <h1 className="pagina-titulo">Grupos de acesso</h1>
          <p className="pagina-descricao">Cada grupo reúne pessoas e os painéis que elas podem ver.</p>
        </div>
        <CButton color="primary" onClick={() => setEditando('novo')}>
          <CIcon icon={cilPlus} className="me-1" />
          Novo grupo
        </CButton>
      </div>

      {erro && <CAlert color="danger">{erro}</CAlert>}

      {!grupos ? (
        <div className="py-5 text-center">
          <CSpinner color="primary" />
        </div>
      ) : grupos.length === 0 ? (
        <CCard className="estado-vazio">
          <CCardBody>
            <CIcon icon={cilGroup} size="3xl" className="estado-vazio-icone" />
            <h2>Nenhum grupo de acesso ainda</h2>
            <p>
              Crie um grupo por setor ou perfil, como Financeiro ou Diretoria, coloque as pessoas nele e escolha os
              painéis liberados.
            </p>
            <CButton color="primary" className="mt-3" onClick={() => setEditando('novo')}>
              Criar primeiro grupo
            </CButton>
          </CCardBody>
        </CCard>
      ) : (
        <CCard>
          <CCardBody>
            <CTable hover responsive align="middle" className="mb-0 tabela-lista">
              <CTableHead>
                <CTableRow>
                  <CTableHeaderCell>Grupo</CTableHeaderCell>
                  <CTableHeaderCell>Membros</CTableHeaderCell>
                  <CTableHeaderCell>Painéis liberados</CTableHeaderCell>
                  <CTableHeaderCell className="text-end">
                    <span className="visually-hidden">Ações</span>
                  </CTableHeaderCell>
                </CTableRow>
              </CTableHead>
              <CTableBody>
                {grupos.map((g) => (
                  <CTableRow key={g.id}>
                    <CTableDataCell>
                      <div className="fw-semibold">{g.nome}</div>
                      {g.descricao && <div className="small text-body-secondary">{g.descricao}</div>}
                    </CTableDataCell>
                    <CTableDataCell>{plural(g.membros.length, 'pessoa', 'pessoas')}</CTableDataCell>
                    <CTableDataCell>
                      {g.paineis.length ? (
                        plural(g.paineis.length, 'painel', 'painéis')
                      ) : (
                        <span className="text-warning-emphasis">Nenhum painel</span>
                      )}
                    </CTableDataCell>
                    <CTableDataCell className="text-end text-nowrap">
                      <CButton color="secondary" variant="ghost" size="sm" onClick={() => setEditando(g)}>
                        Editar
                      </CButton>
                      <CButton color="danger" variant="ghost" size="sm" onClick={() => setExcluindo(g)}>
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
        <FormularioGrupo
          grupo={editando === 'novo' ? null : editando}
          opcoesUsuarios={opcoesUsuarios}
          opcoesPaineis={opcoesPaineis}
          onFechar={() => setEditando(null)}
          onSalvo={(g, novo) => {
            setEditando(null);
            avisar(novo ? `Grupo ${g.nome} criado.` : `Grupo ${g.nome} atualizado.`);
            carregar();
            recarregarMenu();
          }}
        />
      )}

      <Confirmar
        visivel={!!excluindo}
        titulo="Excluir grupo de acesso?"
        acao="Excluir grupo"
        perigoso
        onConfirmar={excluir}
        onFechar={() => setExcluindo(null)}
      >
        Os {plural(excluindo?.membros.length ?? 0, 'membro', 'membros')} de <strong>{excluindo?.nome}</strong> deixam de
        ver os painéis liberados por este grupo, a menos que outro grupo deles também os libere. Os usuários e os painéis
        não são excluídos.
      </Confirmar>
    </>
  );
}

function FormularioGrupo(props: {
  grupo: GrupoAcesso | null;
  opcoesUsuarios: OpcaoSeletor[];
  opcoesPaineis: OpcaoSeletor[];
  onFechar: () => void;
  onSalvo: (g: GrupoAcesso, novo: boolean) => void;
}) {
  const novo = !props.grupo;
  const [nome, setNome] = useState(props.grupo?.nome ?? '');
  const [descricao, setDescricao] = useState(props.grupo?.descricao ?? '');
  const [membros, setMembros] = useState<number[]>(props.grupo?.membros ?? []);
  const [paineis, setPaineis] = useState<number[]>(props.grupo?.paineis ?? []);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setSalvando(true);
    const corpo = { nome, descricao: descricao || null, membros, paineis };
    try {
      const { data } = novo
        ? await api.post<GrupoAcesso>('/grupos', corpo)
        : await api.put<GrupoAcesso>(`/grupos/${props.grupo!.id}`, corpo);
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
          <CModalTitle>{novo ? 'Novo grupo de acesso' : `Editar ${props.grupo!.nome}`}</CModalTitle>
        </CModalHeader>
        <CModalBody>
          {erro && <CAlert color="danger" className="py-2">{erro}</CAlert>}
          <div className="row g-3">
            <div className="col-md-5">
              <CFormLabel htmlFor="g-nome">Nome</CFormLabel>
              <CFormInput id="g-nome" value={nome} maxLength={80} autoFocus onChange={(e) => setNome(e.target.value)} />
            </div>
            <div className="col-md-7">
              <CFormLabel htmlFor="g-descricao">Descrição (opcional)</CFormLabel>
              <CFormInput id="g-descricao" value={descricao} maxLength={255} onChange={(e) => setDescricao(e.target.value)} />
            </div>
            <div className="col-12">
                            <SeletorMultiplo
                id="g-membros"
                rotulo="Membros"
                opcoes={props.opcoesUsuarios}
                valor={membros}
                onChange={setMembros}
                placeholder="Selecione as pessoas"
              />
            </div>
            <div className="col-12">
                            <SeletorMultiplo
                id="g-paineis"
                rotulo="Painéis liberados"
                opcoes={props.opcoesPaineis}
                valor={paineis}
                onChange={setPaineis}
                placeholder={props.opcoesPaineis.length ? 'Selecione os painéis' : 'Nenhum painel cadastrado ainda'}
              />
              <CFormText>
                Os painéis são criados em <Link to="/admin/menu">Menu e painéis</Link>. Administradores veem todos,
                independentemente do grupo.
              </CFormText>
            </div>
          </div>
        </CModalBody>
        <CModalFooter>
          <CButton color="secondary" variant="ghost" onClick={props.onFechar}>
            Cancelar
          </CButton>
          <CLoadingButton type="submit" color="primary" loading={salvando}>
            {novo ? 'Criar grupo' : 'Salvar alterações'}
          </CLoadingButton>
        </CModalFooter>
      </CForm>
    </CModal>
  );
}
