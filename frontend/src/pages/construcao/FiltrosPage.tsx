import { useCallback, useEffect, useState } from 'react';
import {
  CAlert,
  CBadge,
  CButton,
  CCard,
  CCardBody,
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
  CNav,
  CNavItem,
  CNavLink,
  CSpinner,
  CTable,
  CTableBody,
  CTableDataCell,
  CTableHead,
  CTableHeaderCell,
  CTableRow,
} from '@coreui/react-pro';
import CIcon from '@coreui/icons-react';
import { cilFilter, cilPlus } from '@coreui/icons';
import { api, mensagemDeErro } from '../../api/client';
import { Confirmar } from '../../components/Confirmar';
import { useAvisos } from '../../contexts/AvisosContext';

export interface FiltroCadastro {
  id: number;
  nome: string;
  parametro: string;
  tipo: 'periodo' | 'ano' | 'mes' | 'lista' | 'select';
  multiplo: boolean;
  tipoCodigo: 'texto' | 'numero';
  listaId: number | null;
  listaNome: string | null;
  selectTabela: string | null;
  selectColunaCodigo: string | null;
  selectColunaDescricao: string | null;
  padrao: string;
  anoInicial: number | null;
  parametrosSql: string[];
  paineis: { id: number; nome: string }[];
}

interface Lista {
  id: number;
  nome: string;
  itens: { codigo: string; descricao: string }[];
  filtros: string[];
}

const TIPOS: Record<FiltroCadastro['tipo'], string> = {
  periodo: 'Data (de/até)',
  ano: 'Ano',
  mes: 'Mês',
  lista: 'Lista da ferramenta',
  select: 'Tabela do bi_dados',
};

const PADROES: Record<FiltroCadastro['tipo'], [string, string][]> = {
  periodo: [
    ['nenhum', 'Em branco (todo o período)'],
    ['mes_atual', 'Mês atual'],
    ['mes_anterior', 'Mês anterior'],
    ['ultimos_30', 'Últimos 30 dias'],
    ['ultimos_90', 'Últimos 90 dias'],
    ['ano_atual', 'Ano atual'],
  ],
  ano: [
    ['nenhum', 'Todos'],
    ['atual', 'Ano atual'],
  ],
  mes: [
    ['nenhum', 'Todos'],
    ['atual', 'Mês atual'],
  ],
  lista: [['nenhum', 'Todos']],
  select: [['nenhum', 'Todos']],
};

export function FiltrosPage() {
  const [aba, setAba] = useState<'filtros' | 'listas'>('filtros');
  const [filtros, setFiltros] = useState<FiltroCadastro[] | null>(null);
  const [listas, setListas] = useState<Lista[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [editFiltro, setEditFiltro] = useState<Partial<FiltroCadastro> | null>(null);
  const [editLista, setEditLista] = useState<Partial<Lista> | null>(null);
  const [excluir, setExcluir] = useState<{ tipo: 'filtros' | 'listas'; id: number; nome: string } | null>(null);
  const avisar = useAvisos();

  const carregar = useCallback(() => {
    Promise.all([api.get<FiltroCadastro[]>('/catalogo/filtros'), api.get<Lista[]>('/catalogo/listas')])
      .then(([f, l]) => {
        setFiltros(f.data);
        setListas(l.data);
      })
      .catch((e) => setErro(mensagemDeErro(e)));
  }, []);
  useEffect(carregar, [carregar]);

  return (
    <>
      <div className="pagina-cabecalho">
        <div>
          <h1 className="pagina-titulo">Filtros e listas</h1>
          <p className="pagina-descricao">Filtros que os painéis podem exibir no topo. O valor escolhido chega às consultas como @PARAMETRO.</p>
        </div>
        <CButton color="primary" onClick={() => (aba === 'filtros' ? setEditFiltro({ tipo: 'ano', padrao: 'nenhum', multiplo: true, tipoCodigo: 'texto' }) : setEditLista({ nome: '', itens: [] }))}>
          <CIcon icon={cilPlus} className="me-1" />
          {aba === 'filtros' ? 'Novo filtro' : 'Nova lista'}
        </CButton>
      </div>
      {erro && <CAlert color="danger">{erro}</CAlert>}

      <CNav variant="underline-border" role="tablist" className="mb-4">
        <CNavItem>
          <CNavLink as="button" role="tab" active={aba === 'filtros'} aria-selected={aba === 'filtros'} onClick={() => setAba('filtros')}>
            Filtros <span className="aba-contagem">{filtros?.length ?? 0}</span>
          </CNavLink>
        </CNavItem>
        <CNavItem>
          <CNavLink as="button" role="tab" active={aba === 'listas'} aria-selected={aba === 'listas'} onClick={() => setAba('listas')}>
            Listas <span className="aba-contagem">{listas.length}</span>
          </CNavLink>
        </CNavItem>
      </CNav>

      {!filtros ? (
        <div className="py-5 text-center">
          <CSpinner color="primary" />
        </div>
      ) : aba === 'filtros' ? (
        filtros.length === 0 ? (
          <CCard className="estado-vazio">
            <CCardBody>
              <CIcon icon={cilFilter} size="3xl" className="estado-vazio-icone" />
              <h2>Nenhum filtro cadastrado</h2>
              <p>Comece pelos mais usados: período de emissão, ano, mês e filial.</p>
            </CCardBody>
          </CCard>
        ) : (
          <CCard>
            <CCardBody>
              <CTable hover responsive align="middle" className="mb-0 tabela-lista">
                <CTableHead>
                  <CTableRow>
                    <CTableHeaderCell>Filtro</CTableHeaderCell>
                    <CTableHeaderCell>No SQL</CTableHeaderCell>
                    <CTableHeaderCell>Tipo</CTableHeaderCell>
                    <CTableHeaderCell>Painéis</CTableHeaderCell>
                    <CTableHeaderCell />
                  </CTableRow>
                </CTableHead>
                <CTableBody>
                  {filtros.map((f) => (
                    <CTableRow key={f.id} className="linha-clicavel" onClick={() => setEditFiltro(f)}>
                      <CTableDataCell className="fw-semibold">{f.nome}</CTableDataCell>
                      <CTableDataCell>
                        {f.parametrosSql.map((p) => (
                          <code key={p} className="me-2">
                            @{p}
                          </code>
                        ))}
                      </CTableDataCell>
                      <CTableDataCell className="small">
                        {TIPOS[f.tipo]}
                        {f.tipo === 'lista' && `: ${f.listaNome}`}
                        {f.tipo === 'select' && `: ${f.selectTabela}`}
                        {(f.tipo === 'lista' || f.tipo === 'select') && (
                          <CBadge color="secondary" className="badge-leve ms-2">
                            {f.multiplo ? 'vários' : 'um'}
                          </CBadge>
                        )}
                      </CTableDataCell>
                      <CTableDataCell className="small">{f.paineis.length ? f.paineis.map((p) => p.nome).join(', ') : <span className="text-body-secondary">Nenhum</span>}</CTableDataCell>
                      <CTableDataCell className="text-end">
                        <CButton
                          size="sm"
                          color="danger"
                          variant="ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            setExcluir({ tipo: 'filtros', id: f.id, nome: f.nome });
                          }}
                        >
                          Excluir
                        </CButton>
                      </CTableDataCell>
                    </CTableRow>
                  ))}
                </CTableBody>
              </CTable>
            </CCardBody>
          </CCard>
        )
      ) : listas.length === 0 ? (
        <CCard className="estado-vazio">
          <CCardBody>
            <CIcon icon={cilFilter} size="3xl" className="estado-vazio-icone" />
            <h2>Nenhuma lista cadastrada</h2>
            <p>Listas guardam pares código e descrição mantidos aqui na ferramenta, como segmentos ou regiões.</p>
          </CCardBody>
        </CCard>
      ) : (
        <CCard>
          <CCardBody>
            <CTable hover responsive align="middle" className="mb-0 tabela-lista">
              <CTableHead>
                <CTableRow>
                  <CTableHeaderCell>Lista</CTableHeaderCell>
                  <CTableHeaderCell>Itens</CTableHeaderCell>
                  <CTableHeaderCell>Usada nos filtros</CTableHeaderCell>
                  <CTableHeaderCell />
                </CTableRow>
              </CTableHead>
              <CTableBody>
                {listas.map((l) => (
                  <CTableRow key={l.id} className="linha-clicavel" onClick={() => setEditLista(l)}>
                    <CTableDataCell className="fw-semibold">{l.nome}</CTableDataCell>
                    <CTableDataCell className="small">
                      {l.itens.length} · {l.itens.slice(0, 4).map((i) => i.descricao).join(', ')}
                      {l.itens.length > 4 && '…'}
                    </CTableDataCell>
                    <CTableDataCell className="small">{l.filtros.join(', ') || <span className="text-body-secondary">Nenhum</span>}</CTableDataCell>
                    <CTableDataCell className="text-end">
                      <CButton
                        size="sm"
                        color="danger"
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          setExcluir({ tipo: 'listas', id: l.id, nome: l.nome });
                        }}
                      >
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

      {editFiltro && (
        <ModalFiltro
          inicial={editFiltro}
          listas={listas}
          onFechar={() => setEditFiltro(null)}
          onSalvo={() => {
            setEditFiltro(null);
            avisar('Filtro salvo.');
            carregar();
          }}
        />
      )}
      {editLista && (
        <ModalLista
          inicial={editLista}
          onFechar={() => setEditLista(null)}
          onSalvo={() => {
            setEditLista(null);
            avisar('Lista salva.');
            carregar();
          }}
        />
      )}
      <Confirmar
        visivel={!!excluir}
        titulo={excluir?.tipo === 'filtros' ? 'Excluir filtro?' : 'Excluir lista?'}
        acao="Excluir"
        perigoso
        onFechar={() => setExcluir(null)}
        onConfirmar={async () => {
          try {
            await api.delete(`/catalogo/${excluir!.tipo}/${excluir!.id}`);
            avisar(`${excluir!.nome} excluído.`);
            carregar();
          } catch (e) {
            setErro(mensagemDeErro(e));
          } finally {
            setExcluir(null);
          }
        }}
      >
        <strong>{excluir?.nome}</strong> será excluído. Só é possível se não estiver em uso.
      </Confirmar>
    </>
  );
}

function ModalFiltro({ inicial, listas, onFechar, onSalvo }: { inicial: Partial<FiltroCadastro>; listas: Lista[]; onFechar: () => void; onSalvo: () => void }) {
  const [f, setF] = useState<Partial<FiltroCadastro>>(inicial);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [opcoes, setOpcoes] = useState<{ codigo: string | number; descricao: string }[] | null>(null);
  const set = (k: keyof FiltroCadastro, v: unknown) => setF((x) => ({ ...x, [k]: v }));
  const tipo = f.tipo ?? 'ano';
  const param = (f.parametro ?? '').toUpperCase();

  const salvar = async () => {
    setSalvando(true);
    setErro(null);
    try {
      const corpo = {
        nome: f.nome ?? '',
        parametro: f.parametro ?? '',
        tipo,
        multiplo: f.multiplo ?? true,
        tipoCodigo: f.tipoCodigo ?? 'texto',
        listaId: tipo === 'lista' ? (f.listaId ?? null) : null,
        selectTabela: f.selectTabela ?? null,
        selectColunaCodigo: f.selectColunaCodigo ?? null,
        selectColunaDescricao: f.selectColunaDescricao ?? null,
        padrao: f.padrao ?? 'nenhum',
        anoInicial: tipo === 'ano' && f.anoInicial ? Number(f.anoInicial) : null,
      };
      if (f.id) await api.put(`/catalogo/filtros/${f.id}`, corpo);
      else await api.post('/catalogo/filtros', corpo);
      onSalvo();
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setSalvando(false);
    }
  };

  const verOpcoes = async () => {
    try {
      const r = await api.get(`/catalogo/filtros/${f.id}/opcoes`);
      setOpcoes(r.data.opcoes ?? []);
    } catch (e) {
      setErro(mensagemDeErro(e));
    }
  };

  return (
    <CModal visible onClose={onFechar} alignment="center" size="lg">
      <CModalHeader>
        <CModalTitle>{f.id ? `Filtro ${inicial.nome}` : 'Novo filtro'}</CModalTitle>
      </CModalHeader>
      <CModalBody>
        <div className="row g-3">
          <div className="col-md-6">
            <CFormLabel htmlFor="fl-nome">Nome exibido no painel</CFormLabel>
            <CFormInput id="fl-nome" value={f.nome ?? ''} maxLength={80} onChange={(e) => set('nome', e.target.value)} placeholder="Ex.: Filial" />
          </div>
          <div className="col-md-6">
            <CFormLabel htmlFor="fl-param">Parâmetro no SQL</CFormLabel>
            <CFormInput id="fl-param" value={f.parametro ?? ''} maxLength={41} onChange={(e) => set('parametro', e.target.value.replace(/[^A-Za-z0-9_]/g, ''))} placeholder="FILIAIS" />
            <div className="form-text">
              {param ? (tipo === 'periodo' ? `Use @${param}_INI e @${param}_FIM no SQL.` : `Use @${param} no SQL.`) : 'Letras, números e _.'}
            </div>
          </div>
          <div className="col-md-6">
            <CFormLabel htmlFor="fl-tipo">Tipo</CFormLabel>
            <CFormSelect id="fl-tipo" value={tipo} onChange={(e) => setF((x) => ({ ...x, tipo: e.target.value as FiltroCadastro['tipo'], padrao: 'nenhum' }))}>
              {Object.entries(TIPOS).map(([k, n]) => (
                <option key={k} value={k}>
                  {n}
                </option>
              ))}
            </CFormSelect>
          </div>
          <div className="col-md-6">
            <CFormLabel htmlFor="fl-padrao">Valor ao abrir o painel</CFormLabel>
            <CFormSelect id="fl-padrao" value={f.padrao ?? 'nenhum'} onChange={(e) => set('padrao', e.target.value)}>
              {PADROES[tipo].map(([k, n]) => (
                <option key={k} value={k}>
                  {n}
                </option>
              ))}
            </CFormSelect>
          </div>
          {tipo === 'ano' && (
            <div className="col-md-6">
              <CFormLabel htmlFor="fl-ano">Primeiro ano da lista</CFormLabel>
              <CFormInput id="fl-ano" type="number" min={1950} max={2100} value={f.anoInicial ?? ''} placeholder="5 anos atrás" onChange={(e) => set('anoInicial', e.target.value ? Number(e.target.value) : null)} />
            </div>
          )}
          {tipo === 'lista' && (
            <div className="col-md-6">
              <CFormLabel htmlFor="fl-lista">Lista</CFormLabel>
              <CFormSelect id="fl-lista" value={f.listaId ?? ''} onChange={(e) => set('listaId', e.target.value ? Number(e.target.value) : null)}>
                <option value="">Escolha</option>
                {listas.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.nome} ({l.itens.length} itens)
                  </option>
                ))}
              </CFormSelect>
              {!listas.length && <div className="form-text">Cadastre uma lista na aba Listas.</div>}
            </div>
          )}
          {tipo === 'select' && (
            <>
              <div className="col-md-6">
                <CFormLabel htmlFor="fl-tab">Tabela no bi_dados</CFormLabel>
                <CFormInput id="fl-tab" value={f.selectTabela ?? ''} onChange={(e) => set('selectTabela', e.target.value)} placeholder="cadastros.filiais" />
              </div>
              <div className="col-md-3">
                <CFormLabel htmlFor="fl-cod">Coluna do código</CFormLabel>
                <CFormInput id="fl-cod" value={f.selectColunaCodigo ?? ''} onChange={(e) => set('selectColunaCodigo', e.target.value)} placeholder="cd_filial" />
              </div>
              <div className="col-md-3">
                <CFormLabel htmlFor="fl-desc">Coluna da descrição</CFormLabel>
                <CFormInput id="fl-desc" value={f.selectColunaDescricao ?? ''} onChange={(e) => set('selectColunaDescricao', e.target.value)} placeholder="nm_filial" />
              </div>
            </>
          )}
          {(tipo === 'lista' || tipo === 'select') && (
            <>
              <div className="col-md-6">
                <CFormLabel htmlFor="fl-tipocod">O código é</CFormLabel>
                <CFormSelect id="fl-tipocod" value={f.tipoCodigo ?? 'texto'} onChange={(e) => set('tipoCodigo', e.target.value)}>
                  <option value="texto">Texto</option>
                  <option value="numero">Número</option>
                </CFormSelect>
                <div className="form-text">Precisa combinar com o tipo da coluna comparada no SQL.</div>
              </div>
              <div className="col-md-6 d-flex align-items-center">
                <CFormSwitch id="fl-mult" label="Permitir marcar vários" checked={f.multiplo ?? true} onChange={(e) => set('multiplo', e.target.checked)} />
              </div>
              <div className="col-12">
                <div className="form-text">
                  {f.multiplo ?? true ? (
                    <>
                      No SQL: <code>(@{param || 'PARAM'} IS NULL OR coluna = ANY(@{param || 'PARAM'}))</code>
                    </>
                  ) : (
                    <>
                      No SQL: <code>(@{param || 'PARAM'} IS NULL OR coluna = @{param || 'PARAM'})</code>
                    </>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
        {f.id && (tipo === 'lista' || tipo === 'select') && (
          <div className="mt-3">
            <CButton size="sm" color="secondary" variant="outline" onClick={verOpcoes}>
              Ver opções
            </CButton>
            {opcoes && (
              <p className="small mt-2 mb-0">
                {opcoes.length} opções: {opcoes.slice(0, 12).map((o) => `${o.descricao} (${o.codigo})`).join(', ')}
                {opcoes.length > 12 && '…'}
              </p>
            )}
          </div>
        )}
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
        <CLoadingButton color="primary" loading={salvando} onClick={salvar}>
          {f.id ? 'Salvar' : 'Criar filtro'}
        </CLoadingButton>
      </CModalFooter>
    </CModal>
  );
}

/** Itens como texto: uma linha por item, "código;descrição" (dá para colar do Excel, com tab). */
const paraTexto = (itens: Lista['itens']) => itens.map((i) => `${i.codigo};${i.descricao}`).join('\n');
const doTexto = (t: string) =>
  t
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [codigo, ...resto] = l.split(/[;\t]/);
      return { codigo: codigo.trim(), descricao: (resto.join(' ').trim() || codigo).trim() };
    });

function ModalLista({ inicial, onFechar, onSalvo }: { inicial: Partial<Lista>; onFechar: () => void; onSalvo: () => void }) {
  const [nome, setNome] = useState(inicial.nome ?? '');
  const [texto, setTexto] = useState(paraTexto(inicial.itens ?? []));
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const itens = doTexto(texto);

  const salvar = async () => {
    setSalvando(true);
    setErro(null);
    try {
      const corpo = { nome, itens };
      if (inicial.id) await api.put(`/catalogo/listas/${inicial.id}`, corpo);
      else await api.post('/catalogo/listas', corpo);
      onSalvo();
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <CModal visible onClose={onFechar} alignment="center">
      <CModalHeader>
        <CModalTitle>{inicial.id ? `Lista ${inicial.nome}` : 'Nova lista'}</CModalTitle>
      </CModalHeader>
      <CModalBody>
        <div className="mb-3">
          <CFormLabel htmlFor="ls-nome">Nome</CFormLabel>
          <CFormInput id="ls-nome" value={nome} maxLength={80} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Segmentos" />
        </div>
        <CFormLabel htmlFor="ls-itens">Itens: um por linha, código;descrição</CFormLabel>
        <CFormTextarea id="ls-itens" rows={10} className="font-monospace" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={'01;Carga seca\n02;Frigorificada\n03;Granel'} />
        <div className="form-text">
          {itens.length} {itens.length === 1 ? 'item' : 'itens'}. O código é comparado com o dado; a descrição é o que o usuário lê. Dá para colar duas colunas do Excel.
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
        <CLoadingButton color="primary" loading={salvando} onClick={salvar}>
          {inicial.id ? 'Salvar' : 'Criar lista'}
        </CLoadingButton>
      </CModalFooter>
    </CModal>
  );
}
