import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  CAlert,
  CBadge,
  CButton,
  CCard,
  CCardBody,
  CCardHeader,
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
  CLoadingButton,
  CModal,
  CModalBody,
  CModalFooter,
  CModalHeader,
  CModalTitle,
  CSpinner,
} from '@coreui/react-pro';
import CIcon from '@coreui/icons-react';
import { cilArrowBottom, cilArrowTop, cilListRich, cilOptions, cilPlus } from '@coreui/icons';
import { api, mensagemDeErro } from '../../api/client';
import { Confirmar } from '../../components/Confirmar';
import { SeletorMultiplo } from '../../components/SeletorMultiplo';
import { useAvisos } from '../../contexts/AvisosContext';
import { useMenu } from '../../contexts/MenuContext';
import { ICONES_MENU, iconeDoMenu } from '../../lib/icones';
import { MAX_NIVEIS_SUBGRUPO, type ArvoreGrupo, type ArvorePainel, type ArvoreSubgrupo, type GrupoAcesso } from '../../types';

type Tipo = 'grupo' | 'subgrupo' | 'painel';

type Modal =
  | { tipo: 'grupo'; item?: ArvoreGrupo }
  | { tipo: 'subgrupo'; item?: ArvoreSubgrupo; grupoId: number; paiId: number | null }
  | { tipo: 'painel'; item?: ArvorePainel; subgrupoId: number };

/** Todos os subgrupos em lista, com o caminho completo ("Vendas › Regional Sul"). */
interface SubgrupoPlano {
  id: number;
  grupoId: number;
  grupoNome: string;
  caminho: string;
  nivel: number;
  /** Ids dele e de tudo o que está dentro (não pode ser destino dele mesmo). */
  subarvore: number[];
  altura: number;
}

function planificar(arvore: ArvoreGrupo[]): SubgrupoPlano[] {
  const saida: SubgrupoPlano[] = [];
  const visitar = (g: ArvoreGrupo, s: ArvoreSubgrupo, prefixo: string[]): { ids: number[]; altura: number } => {
    const caminho = [...prefixo, s.nome];
    const item: SubgrupoPlano = { id: s.id, grupoId: g.id, grupoNome: g.nome, caminho: caminho.join(' › '), nivel: s.nivel, subarvore: [], altura: 1 };
    saida.push(item);
    const filhos = s.subgrupos.map((f) => visitar(g, f, caminho));
    item.subarvore = [s.id, ...filhos.flatMap((f) => f.ids)];
    item.altura = 1 + Math.max(0, ...filhos.map((f) => f.altura));
    return { ids: item.subarvore, altura: item.altura };
  };
  for (const g of arvore) for (const s of g.subgrupos) visitar(g, s, []);
  return saida;
}

const ROTA: Record<Tipo, string> = { grupo: 'grupos', subgrupo: 'subgrupos', painel: 'paineis' };
const NOME_TIPO: Record<Tipo, string> = { grupo: 'grupo do menu', subgrupo: 'subgrupo', painel: 'painel' };

export function MenuPage() {
  const avisar = useAvisos();
  const { recarregarMenu } = useMenu();
  const [arvore, setArvore] = useState<ArvoreGrupo[] | null>(null);
  const [gruposAcesso, setGruposAcesso] = useState<GrupoAcesso[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal | null>(null);
  const [excluindo, setExcluindo] = useState<{ tipo: Tipo; id: number; nome: string } | null>(null);

  const carregar = useCallback(async () => {
    try {
      const [a, g] = await Promise.all([
        api.get<ArvoreGrupo[]>('/admin/menu/arvore'),
        api.get<GrupoAcesso[]>('/grupos'),
      ]);
      setArvore(a.data);
      setGruposAcesso(g.data);
    } catch (e) {
      setErro(mensagemDeErro(e));
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const nomeGrupoAcesso = useMemo(() => new Map(gruposAcesso.map((g) => [g.id, g.nome])), [gruposAcesso]);

  const atualizarTudo = async () => {
    await carregar();
    recarregarMenu();
  };

  async function mover(tipo: Tipo, ids: number[], indice: number, direcao: -1 | 1) {
    const destino = indice + direcao;
    if (destino < 0 || destino >= ids.length) return;
    const nova = [...ids];
    [nova[indice], nova[destino]] = [nova[destino], nova[indice]];
    try {
      await api.post('/admin/menu/reordenar', { tipo, ids: nova });
      await atualizarTudo();
    } catch (e) {
      avisar(mensagemDeErro(e), 'erro');
    }
  }

  async function excluir() {
    if (!excluindo) return;
    try {
      await api.delete(`/admin/menu/${ROTA[excluindo.tipo]}/${excluindo.id}`);
      avisar(`${excluindo.nome} excluído.`);
      setExcluindo(null);
      atualizarTudo();
    } catch (e) {
      setExcluindo(null);
      avisar(mensagemDeErro(e), 'erro');
    }
  }

  function renderSubgrupo(s: ArvoreSubgrupo, irmaos: ArvoreSubgrupo[], si: number, grupoId: number, paiId: number | null) {
    const vazio = !s.paineis.length && !s.subgrupos.length;
    return (
      <section key={s.id} className={`menu-subgrupo menu-nivel-${s.nivel}`}>
        <div className="menu-linha menu-linha-subgrupo">
          <span className="menu-nome">{s.nome}</span>
          <AcessoMenu ids={s.grupos} nomes={nomeGrupoAcesso} herdado />
          <Acoes
            rotulo={s.nome}
            primeiro={si === 0}
            ultimo={si === irmaos.length - 1}
            onSubir={() => mover('subgrupo', irmaos.map((x) => x.id), si, -1)}
            onDescer={() => mover('subgrupo', irmaos.map((x) => x.id), si, 1)}
            onEditar={() => setModal({ tipo: 'subgrupo', item: s, grupoId, paiId })}
            onExcluir={() => setExcluindo({ tipo: 'subgrupo', id: s.id, nome: s.nome })}
          >
            {s.nivel < MAX_NIVEIS_SUBGRUPO && (
              <CButton
                color="secondary"
                variant="outline"
                size="sm"
                onClick={() => setModal({ tipo: 'subgrupo', grupoId, paiId: s.id })}
                title="Criar um subgrupo dentro deste"
              >
                <CIcon icon={cilPlus} className="me-1" />
                Subgrupo
              </CButton>
            )}
            <CButton color="secondary" variant="outline" size="sm" onClick={() => setModal({ tipo: 'painel', subgrupoId: s.id })}>
              <CIcon icon={cilPlus} className="me-1" />
              Painel
            </CButton>
          </Acoes>
        </div>
        {vazio && <p className="menu-vazio menu-vazio-painel">Nenhum painel neste subgrupo.</p>}
        {s.paineis.length > 0 && (
          <ul className="menu-paineis">
            {s.paineis.map((p, pi) => (
              <li key={p.id} className="menu-linha menu-linha-painel">
                <div className="menu-painel-info">
                  <Link to={`/painel/${p.id}`} className="menu-nome">
                    {p.nome}
                  </Link>
                  <div className="menu-acessos">
                    {!p.ativo && <CBadge color="secondary">Inativo</CBadge>}
                    {p.analiseId ? (
                      <CBadge color={p.visibilidade === 'privado' ? 'secondary' : 'info'} className="badge-leve">
                        {p.visibilidade === 'privado' ? `Privado${p.donoNome ? ` · ${p.donoNome}` : ''}` : 'Público: quem tem acesso ao subgrupo'}
                      </CBadge>
                    ) : p.grupos.length === 0 ? (
                      <CBadge color="warning" textColor="dark">
                        Só Gestores e Desenvolvedores
                      </CBadge>
                    ) : (
                      p.grupos.map((gid) => (
                        <CBadge key={gid} color="secondary" className="badge-leve">
                          {nomeGrupoAcesso.get(gid) ?? '—'}
                        </CBadge>
                      ))
                    )}
                  </div>
                </div>
                {p.analiseId ? (
                  <Link to={`/painel/${p.id}`} className="btn btn-sm btn-outline-secondary me-2 flex-shrink-0" title="Painel publicado a partir de uma análise: os gráficos são alterados na análise">
                    Ver análise
                  </Link>
                ) : (
                  <Link to={`/admin/paineis/${p.id}/montar`} className="btn btn-sm btn-outline-secondary me-2 flex-shrink-0">
                    Montar
                  </Link>
                )}
                <Acoes
                  rotulo={p.nome}
                  primeiro={pi === 0}
                  ultimo={pi === s.paineis.length - 1}
                  onSubir={() => mover('painel', s.paineis.map((x) => x.id), pi, -1)}
                  onDescer={() => mover('painel', s.paineis.map((x) => x.id), pi, 1)}
                  onEditar={() => setModal({ tipo: 'painel', item: p, subgrupoId: s.id })}
                  onExcluir={() => setExcluindo({ tipo: 'painel', id: p.id, nome: p.nome })}
                />
              </li>
            ))}
          </ul>
        )}
        {s.subgrupos.length > 0 && (
          <div className="menu-filhos">{s.subgrupos.map((f, fi) => renderSubgrupo(f, s.subgrupos, fi, grupoId, s.id))}</div>
        )}
      </section>
    );
  }

  return (
    <>
      <div className="pagina-cabecalho">
        <div>
          <h1 className="pagina-titulo">Menu e painéis</h1>
          <p className="pagina-descricao">
            Organize os painéis em Grupo › Subgrupo › Painel. Cada pessoa vê só o que os grupos de acesso dela liberam.
          </p>
        </div>
        <CButton color="primary" onClick={() => setModal({ tipo: 'grupo' })}>
          <CIcon icon={cilPlus} className="me-1" />
          Novo grupo do menu
        </CButton>
      </div>

      {erro && <CAlert color="danger">{erro}</CAlert>}

      {!arvore ? (
        <div className="py-5 text-center">
          <CSpinner color="primary" />
        </div>
      ) : arvore.length === 0 ? (
        <CCard className="estado-vazio">
          <CCardBody>
            <CIcon icon={cilListRich} size="3xl" className="estado-vazio-icone" />
            <h2>O menu ainda está vazio</h2>
            <p>
              Comece por um grupo, normalmente um setor como Financeiro ou Operações. Dentro dele você cria os
              subgrupos e, em cada subgrupo, os painéis.
            </p>
            <CButton color="primary" className="mt-3" onClick={() => setModal({ tipo: 'grupo' })}>
              Criar primeiro grupo
            </CButton>
          </CCardBody>
        </CCard>
      ) : (
        arvore.map((g, gi) => (
          <CCard key={g.id} className="mb-4 menu-grupo">
            <CCardHeader className="menu-linha menu-linha-grupo">
              <CIcon icon={iconeDoMenu(g.icone)} size="lg" className="menu-grupo-icone" />
              <span className="menu-nome">{g.nome}</span>
              <AcessoMenu ids={g.grupos} nomes={nomeGrupoAcesso} />
              <Acoes
                rotulo={g.nome}
                primeiro={gi === 0}
                ultimo={gi === arvore.length - 1}
                onSubir={() => mover('grupo', arvore.map((x) => x.id), gi, -1)}
                onDescer={() => mover('grupo', arvore.map((x) => x.id), gi, 1)}
                onEditar={() => setModal({ tipo: 'grupo', item: g })}
                onExcluir={() => setExcluindo({ tipo: 'grupo', id: g.id, nome: g.nome })}
              >
                <CButton
                  color="secondary"
                  variant="outline"
                  size="sm"
                  onClick={() => setModal({ tipo: 'subgrupo', grupoId: g.id, paiId: null })}
                >
                  <CIcon icon={cilPlus} className="me-1" />
                  Subgrupo
                </CButton>
              </Acoes>
            </CCardHeader>
            <CCardBody className="p-0">
              {g.subgrupos.length === 0 && <p className="menu-vazio">Nenhum subgrupo. Adicione um para criar painéis.</p>}
              {g.subgrupos.map((sg, si) => renderSubgrupo(sg, g.subgrupos, si, g.id, null))}
            </CCardBody>
          </CCard>
        ))
      )}

      {modal?.tipo === 'grupo' && (
        <ModalGrupoMenu item={modal.item} gruposAcesso={gruposAcesso} onFechar={() => setModal(null)} onSalvo={salvo} />
      )}
      {modal?.tipo === 'subgrupo' && arvore && (
        <ModalSubgrupo
          item={modal.item}
          grupoId={modal.grupoId}
          paiId={modal.paiId}
          arvore={arvore}
          gruposAcesso={gruposAcesso}
          onFechar={() => setModal(null)}
          onSalvo={salvo}
        />
      )}
      {modal?.tipo === 'painel' && arvore && (
        <ModalPainel
          item={modal.item}
          subgrupoId={modal.subgrupoId}
          arvore={arvore}
          gruposAcesso={gruposAcesso}
          onFechar={() => setModal(null)}
          onSalvo={salvo}
        />
      )}

      <Confirmar
        visivel={!!excluindo}
        titulo={`Excluir ${excluindo ? NOME_TIPO[excluindo.tipo] : ''}?`}
        acao="Excluir"
        perigoso
        onConfirmar={excluir}
        onFechar={() => setExcluindo(null)}
      >
        {excluindo?.tipo === 'painel' ? (
          <>
            O painel <strong>{excluindo.nome}</strong> sai do menu de todos e suas permissões são apagadas. Se for algo
            temporário, prefira marcá-lo como inativo.
          </>
        ) : (
          <>
            <strong>{excluindo?.nome}</strong> será removido do menu. Só é possível excluir quando ele está vazio.
          </>
        )}
      </Confirmar>
    </>
  );

  function salvo(texto: string) {
    setModal(null);
    avisar(texto);
    atualizarTudo();
  }
}

/* ---------- Botões de cada linha ---------- */

function Acoes(props: {
  rotulo: string;
  primeiro: boolean;
  ultimo: boolean;
  onSubir: () => void;
  onDescer: () => void;
  onEditar: () => void;
  onExcluir: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="menu-acoes">
      {props.children}
      <div className="btn-group" role="group" aria-label={`Ordem de ${props.rotulo}`}>
        <CButton
          color="secondary"
          variant="ghost"
          size="sm"
          disabled={props.primeiro}
          onClick={props.onSubir}
          aria-label={`Mover ${props.rotulo} para cima`}
          title="Mover para cima"
        >
          <CIcon icon={cilArrowTop} />
        </CButton>
        <CButton
          color="secondary"
          variant="ghost"
          size="sm"
          disabled={props.ultimo}
          onClick={props.onDescer}
          aria-label={`Mover ${props.rotulo} para baixo`}
          title="Mover para baixo"
        >
          <CIcon icon={cilArrowBottom} />
        </CButton>
      </div>
      <CDropdown alignment="end">
        <CDropdownToggle color="secondary" variant="ghost" size="sm" caret={false} aria-label={`Mais ações para ${props.rotulo}`}>
          <CIcon icon={cilOptions} />
        </CDropdownToggle>
        <CDropdownMenu>
          <CDropdownItem as="button" onClick={props.onEditar}>
            Editar
          </CDropdownItem>
          <CDropdownItem as="button" className="text-danger" onClick={props.onExcluir}>
            Excluir
          </CDropdownItem>
        </CDropdownMenu>
      </CDropdown>
    </div>
  );
}

/* ---------- Modais ---------- */

function useEnvio(onSalvo: (texto: string) => void) {
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const enviar = async (fn: () => Promise<unknown>, texto: string) => {
    setErro(null);
    setSalvando(true);
    try {
      await fn();
      onSalvo(texto);
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setSalvando(false);
    }
  };
  return { erro, salvando, enviar };
}

function Moldura(props: {
  titulo: string;
  erro: string | null;
  salvando: boolean;
  acao: string;
  onFechar: () => void;
  onEnviar: (e: FormEvent) => void;
  tamanho?: 'lg';
  children: ReactNode;
}) {
  return (
    <CModal visible onClose={props.onFechar} alignment="center" size={props.tamanho} backdrop="static">
      <CForm onSubmit={props.onEnviar} noValidate>
        <CModalHeader>
          <CModalTitle>{props.titulo}</CModalTitle>
        </CModalHeader>
        <CModalBody>
          {props.erro && <CAlert color="danger" className="py-2">{props.erro}</CAlert>}
          {props.children}
        </CModalBody>
        <CModalFooter>
          <CButton color="secondary" variant="ghost" onClick={props.onFechar}>
            Cancelar
          </CButton>
          <CLoadingButton type="submit" color="primary" loading={props.salvando}>
            {props.acao}
          </CLoadingButton>
        </CModalFooter>
      </CForm>
    </CModal>
  );
}

function ModalGrupoMenu({
  item,
  gruposAcesso,
  onFechar,
  onSalvo,
}: {
  item?: ArvoreGrupo;
  gruposAcesso: GrupoAcesso[];
  onFechar: () => void;
  onSalvo: (t: string) => void;
}) {
  const [nome, setNome] = useState(item?.nome ?? '');
  const [icone, setIcone] = useState(item?.icone ?? 'cilChartPie');
  const [grupos, setGrupos] = useState<number[]>(item?.grupos ?? []);
  const { erro, salvando, enviar } = useEnvio(onSalvo);

  return (
    <Moldura
      titulo={item ? `Editar ${item.nome}` : 'Novo grupo do menu'}
      acao={item ? 'Salvar alterações' : 'Criar grupo'}
      erro={erro}
      salvando={salvando}
      onFechar={onFechar}
      tamanho="lg"
      onEnviar={(e) => {
        e.preventDefault();
        const corpo = { nome, icone, grupos };
        enviar(
          () => (item ? api.put(`/admin/menu/grupos/${item.id}`, corpo) : api.post('/admin/menu/grupos', corpo)),
          item ? `${nome} atualizado.` : `Grupo ${nome} criado.`,
        );
      }}
    >
      <div className="mb-3">
        <CFormLabel htmlFor="m-nome">Nome</CFormLabel>
        <CFormInput id="m-nome" value={nome} maxLength={80} autoFocus onChange={(e) => setNome(e.target.value)} />
        <CFormText>Normalmente o setor, como Financeiro, Operações ou Comercial.</CFormText>
      </div>
      <div className="mb-3">
        <SeletorMultiplo
          id="m-acesso"
          rotulo="Grupos com acesso"
          opcoes={gruposAcesso.map((g) => ({ value: g.id, label: g.nome }))}
          valor={grupos}
          onChange={setGrupos}
          placeholder="Ninguém além de Gestores e Desenvolvedores"
        />
        <CFormText>Vale para todos os subgrupos dele: quem está nesses grupos pode publicar análises ali e vê as que forem públicas.</CFormText>
      </div>
      <fieldset>
        <legend className="form-label fs-6">Ícone no menu</legend>
        <div className="seletor-icones">
          {ICONES_MENU.map((i) => (
            <label key={i.nome} className={`seletor-icone ${icone === i.nome ? 'ativo' : ''}`} title={i.rotulo}>
              <input
                type="radio"
                name="icone"
                value={i.nome}
                checked={icone === i.nome}
                onChange={() => setIcone(i.nome)}
                className="visually-hidden"
              />
              <CIcon icon={i.icone} size="xl" />
              <span className="visually-hidden">{i.rotulo}</span>
            </label>
          ))}
        </div>
      </fieldset>
    </Moldura>
  );
}

function ModalSubgrupo(props: {
  item?: ArvoreSubgrupo;
  grupoId: number;
  paiId: number | null;
  arvore: ArvoreGrupo[];
  gruposAcesso: GrupoAcesso[];
  onFechar: () => void;
  onSalvo: (t: string) => void;
}) {
  const [nome, setNome] = useState(props.item?.nome ?? '');
  const [grupos, setGrupos] = useState<number[]>(props.item?.grupos ?? []);
  const [grupoId, setGrupoId] = useState(props.grupoId);
  const [paiId, setPaiId] = useState<number | null>(props.paiId);
  const { erro, salvando, enviar } = useEnvio(props.onSalvo);

  const planos = useMemo(() => planificar(props.arvore), [props.arvore]);
  const proprio = props.item ? planos.find((p) => p.id === props.item!.id) : undefined;
  // Destinos possíveis: no mesmo grupo, fora da própria subárvore e sem passar do limite de níveis
  const destinos = planos.filter(
    (p) =>
      p.grupoId === grupoId &&
      !(proprio?.subarvore ?? []).includes(p.id) &&
      p.nivel + (proprio?.altura ?? 1) <= MAX_NIVEIS_SUBGRUPO,
  );

  return (
    <Moldura
      titulo={props.item ? `Editar ${props.item.nome}` : 'Novo subgrupo'}
      acao={props.item ? 'Salvar alterações' : 'Criar subgrupo'}
      erro={erro}
      salvando={salvando}
      onFechar={props.onFechar}
      onEnviar={(e) => {
        e.preventDefault();
        const corpo = { nome, menuGrupoId: grupoId, subgrupoPaiId: paiId, grupos };
        enviar(
          () =>
            props.item ? api.put(`/admin/menu/subgrupos/${props.item.id}`, corpo) : api.post('/admin/menu/subgrupos', corpo),
          props.item ? `${nome} atualizado.` : `Subgrupo ${nome} criado.`,
        );
      }}
    >
      <div className="mb-3">
        <CFormLabel htmlFor="s-nome">Nome</CFormLabel>
        <CFormInput id="s-nome" value={nome} maxLength={80} autoFocus onChange={(e) => setNome(e.target.value)} />
        <CFormText>Uma área dentro do setor, como Contas a pagar ou Frota.</CFormText>
      </div>
      <div className="mb-3">
        <SeletorMultiplo
          id="s-acesso"
          rotulo="Grupos com acesso"
          opcoes={props.gruposAcesso.map((g) => ({ value: g.id, label: g.nome }))}
          valor={grupos}
          onChange={setGrupos}
          placeholder="Só os liberados no grupo do menu ou num subgrupo acima"
        />
        <CFormText>Quem está nesses grupos vê este subgrupo (mesmo vazio) ao publicar uma análise e vê as análises publicadas como públicas aqui. Vale também para os subgrupos de dentro.</CFormText>
      </div>
      <div className="mb-3">
        <CFormLabel htmlFor="s-grupo">Grupo do menu</CFormLabel>
        <CFormSelect
          id="s-grupo"
          value={grupoId}
          onChange={(e) => {
            setGrupoId(Number(e.target.value));
            setPaiId(null);
          }}
        >
          {props.arvore.map((g) => (
            <option key={g.id} value={g.id}>
              {g.nome}
            </option>
          ))}
        </CFormSelect>
      </div>
      <div>
        <CFormLabel htmlFor="s-pai">Dentro de</CFormLabel>
        <CFormSelect id="s-pai" value={paiId ?? ''} onChange={(e) => setPaiId(e.target.value ? Number(e.target.value) : null)}>
          <option value="">Direto no grupo</option>
          {destinos.map((d) => (
            <option key={d.id} value={d.id}>
              {d.caminho}
            </option>
          ))}
        </CFormSelect>
        <CFormText>
          Até {MAX_NIVEIS_SUBGRUPO} níveis de subgrupo. Ao mover, tudo o que está dentro dele vai junto.
        </CFormText>
      </div>
    </Moldura>
  );
}

function ModalPainel(props: {
  item?: ArvorePainel;
  subgrupoId: number;
  arvore: ArvoreGrupo[];
  gruposAcesso: GrupoAcesso[];
  onFechar: () => void;
  onSalvo: (t: string) => void;
}) {
  const [nome, setNome] = useState(props.item?.nome ?? '');
  const [descricao, setDescricao] = useState(props.item?.descricao ?? '');
  const [subgrupoId, setSubgrupoId] = useState(props.subgrupoId);
  const [ativo, setAtivo] = useState(props.item?.ativo ?? true);
  const [grupos, setGrupos] = useState<number[]>(props.item?.grupos ?? []);
  const [visibilidade, setVisibilidade] = useState(props.item?.visibilidade === 'privado' ? 'privado' : 'subgrupo');
  const deAnalise = !!props.item?.analiseId;
  const { erro, salvando, enviar } = useEnvio(props.onSalvo);

  return (
    <Moldura
      titulo={props.item ? `Editar ${props.item.nome}` : 'Novo painel'}
      acao={props.item ? 'Salvar alterações' : 'Criar painel'}
      erro={erro}
      salvando={salvando}
      onFechar={props.onFechar}
      tamanho="lg"
      onEnviar={(e) => {
        e.preventDefault();
        const corpo = { nome, descricao: descricao || null, menuSubgrupoId: subgrupoId, ativo, grupos, ...(deAnalise ? { visibilidade } : {}) };
        enviar(
          () => (props.item ? api.put(`/admin/menu/paineis/${props.item.id}`, corpo) : api.post('/admin/menu/paineis', corpo)),
          props.item ? `${nome} atualizado.` : `Painel ${nome} criado.`,
        );
      }}
    >
      <div className="row g-3">
        <div className="col-md-6">
          <CFormLabel htmlFor="p-nome">Nome</CFormLabel>
          <CFormInput id="p-nome" value={nome} maxLength={120} autoFocus onChange={(e) => setNome(e.target.value)} />
        </div>
        <div className="col-md-6">
          <CFormLabel htmlFor="p-subgrupo">Local no menu</CFormLabel>
          <CFormSelect id="p-subgrupo" value={subgrupoId} onChange={(e) => setSubgrupoId(Number(e.target.value))}>
            {props.arvore.map((g) => (
              <optgroup key={g.id} label={g.nome}>
                {planificar([g]).map((s) => (
                  <option key={s.id} value={s.id}>
                    {g.nome} › {s.caminho}
                  </option>
                ))}
              </optgroup>
            ))}
          </CFormSelect>
        </div>
        <div className="col-12">
          <CFormLabel htmlFor="p-descricao">Descrição (opcional)</CFormLabel>
          <CFormInput
            id="p-descricao"
            value={descricao}
            maxLength={255}
            onChange={(e) => setDescricao(e.target.value)}
          />
          <CFormText>Aparece abaixo do título do painel.</CFormText>
        </div>
        {deAnalise ? (
        <div className="col-12">
          <CFormLabel htmlFor="p-visibilidade">Quem vê</CFormLabel>
          <CFormSelect id="p-visibilidade" value={visibilidade} onChange={(e) => setVisibilidade(e.target.value as 'subgrupo' | 'privado')}>
            <option value="subgrupo">Público: todos com acesso a este subgrupo do menu</option>
            <option value="privado">Privado: só quem publicou{props.item?.donoNome ? ` (${props.item.donoNome})` : ''}</option>
          </CFormSelect>
          <CFormText>Painel publicado a partir de uma análise: o acesso segue o subgrupo do menu, não os grupos do painel.</CFormText>
        </div>
        ) : (
        <div className="col-12">
                    <SeletorMultiplo
            id="p-grupos"
                rotulo="Grupos com acesso"
            opcoes={props.gruposAcesso.map((g) => ({ value: g.id, label: g.nome }))}
            valor={grupos}
            onChange={setGrupos}
            placeholder={props.gruposAcesso.length ? 'Selecione os grupos' : 'Nenhum grupo de acesso cadastrado'}
          />
          <CFormText>Sem nenhum grupo, só Gestores e Desenvolvedores veem o painel.</CFormText>
        </div>
        )}
        <div className="col-12">
          <CFormSwitch id="p-ativo" label="Painel ativo" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
          <CFormText>Inativo sai do menu de todos, mas mantém a configuração e as permissões.</CFormText>
        </div>
      </div>
    </Moldura>
  );
}

/** Grupos de acesso de um grupo/subgrupo do menu, em etiquetas discretas. */
function AcessoMenu({ ids, nomes, herdado }: { ids?: number[]; nomes: Map<number, string>; herdado?: boolean }) {
  if (!ids) return null;
  return (
    <span className="menu-acesso-nivel" title="Grupos com acesso a este nível do menu (publicar análises e ver as públicas)">
      {ids.length ? (
        ids.map((id) => (
          <CBadge key={id} color="secondary" className="badge-leve">
            {nomes.get(id) ?? '—'}
          </CBadge>
        ))
      ) : (
        <span className="menu-acesso-vazio">{herdado ? 'Acesso do nível acima' : 'Sem grupos com acesso'}</span>
      )}
    </span>
  );
}
