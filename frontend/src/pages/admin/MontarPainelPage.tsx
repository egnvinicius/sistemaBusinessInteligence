import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import GridLayout, { WidthProvider, type Layout } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import {
  CAlert,
  CButton,
  CCard,
  CCardBody,
  CFormCheck,
  CFormInput,
  CFormLabel,
  CFormSelect,
  CFormSwitch,
  CLoadingButton,
  CModal,
  CModalBody,
  CModalFooter,
  CModalHeader,
  CModalTitle,
  CSpinner,
} from '@coreui/react-pro';
import CIcon from '@coreui/icons-react';
import { cilBarChart, cilChartLine, cilChartPie, cilCopy, cilFilter, cilImage, cilMove, cilPencil, cilPlus, cilSpeedometer, cilTrash, cilViewColumn } from '@coreui/icons';
import { SeletorImagem } from '../../components/paineis/SeletorImagem';
import { api, mensagemDeErro } from '../../api/client';
import { SeletorMultiplo } from '../../components/SeletorMultiplo';
import { Visual, type DadosVisual, type TipoVisual } from '../../components/paineis/Visual';
import { ALTURA_LINHA, ESPACO } from '../../components/paineis/GradeVisuais';
import { EditorDestaques, SeletorCor } from '../../components/paineis/EditorDestaques';
import { useTema } from '../../contexts/TemaContext';
import { useAuth } from '../../contexts/AuthContext';
import { ehDesenvolvedor } from '../../types';
import { EditorFiltrosVisual } from '../../components/paineis/EditorFiltrosVisual';
import { EditorCalculadas, semReferencias, useCalculadas } from '../../components/paineis/ColunasCalculadas';
import { IncluirExistente, type ObjetoExistente } from '../../components/paineis/IncluirExistente';
import { ICONES_INDICADOR } from '../../lib/iconesPainel';
import { useAvisos } from '../../contexts/AvisosContext';
import { NOMES_AGREGACAO, NOMES_FORMATO, paletaDoTema } from '../../lib/graficos';

const Grade = WidthProvider(GridLayout);

interface ColunaConsulta {
  nome: string;
  tipo: 'numero' | 'texto' | 'data';
}
export interface ConsultaResumo {
  id: number;
  nome: string;
  descricao: string | null;
  colunas: ColunaConsulta[];
  parametros: string[];
}
interface FiltroResumo {
  id: number;
  nome: string;
  parametro: string;
  tipo: string;
  parametrosSql: string[];
}
/** Visual de outro painel, achado pela busca do "Incluir existente" */
interface ObjetoPainel extends ObjetoExistente {
  consultaId: number;
  painelId: number;
  filtros: { id: number; nome: string }[];
}

export interface VisualMontagem {
  chave: string;
  tipo: TipoVisual;
  titulo: string;
  consultaId: number;
  config: Record<string, any>;
  layout: { x: number; y: number; w: number; h: number };
}

export const TIPOS: { tipo: TipoVisual; nome: string; icone: string[]; uso: string; tamanho: { w: number; h: number } }[] = [
  { tipo: 'kpi', nome: 'Indicador', icone: cilSpeedometer, uso: 'Um número de destaque, com meta opcional', tamanho: { w: 3, h: 2 } },
  { tipo: 'barra', nome: 'Barras', icone: cilBarChart, uso: 'Comparar valores entre categorias', tamanho: { w: 6, h: 5 } },
  { tipo: 'linha', nome: 'Linhas', icone: cilChartLine, uso: 'Evolução ao longo do tempo', tamanho: { w: 6, h: 5 } },
  { tipo: 'pizza', nome: 'Pizza', icone: cilChartPie, uso: 'Participação de cada parte no total', tamanho: { w: 4, h: 5 } },
  { tipo: 'tabela', nome: 'Tabela', icone: cilViewColumn, uso: 'Os dados linha a linha', tamanho: { w: 6, h: 5 } },
  { tipo: 'imagem', nome: 'Imagem/logo', icone: cilImage, uso: 'Um logo ou uma figura da biblioteca', tamanho: { w: 2, h: 2 } },
];

let contador = 0;
export const novaChave = () => `n${Date.now()}${contador++}`;

export function MontarPainelPage() {
  const { id } = useParams();
  const avisar = useAvisos();
  const [painel, setPainel] = useState<{
    id: number;
    nome: string;
    analiseId?: number | null;
    analiseNome?: string | null;
    analiseDono?: string | null;
    analiseDoUsuario?: boolean;
  } | null>(null);
  const [fundos, setFundos] = useState<{ fundoClaro: string | null; fundoEscuro: string | null }>({ fundoClaro: null, fundoEscuro: null });
  const { tema } = useTema();
  const [consultas, setConsultas] = useState<ConsultaResumo[]>([]);
  const [filtros, setFiltros] = useState<FiltroResumo[]>([]);
  const [filtrosIds, setFiltrosIds] = useState<number[]>([]);
  const [visuais, setVisuais] = useState<VisualMontagem[]>([]);
  const [alterado, setAlterado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [editando, setEditando] = useState<VisualMontagem | null>(null);
  const [filtrando, setFiltrando] = useState<VisualMontagem | null>(null);
  const [incluindo, setIncluindo] = useState(false);
  const [levarFiltros, setLevarFiltros] = useState(true);
  const { usuario } = useAuth();
  const [previas, setPrevias] = useState<Record<string, { dados?: DadosVisual; erro?: string }>>({});
  const chavesPrevia = useRef<Record<string, string>>({});

  useEffect(() => {
    Promise.all([api.get(`/paineis/${id}/montagem`), api.get<ConsultaResumo[]>('/catalogo/consultas'), api.get<FiltroResumo[]>('/catalogo/filtros')])
      .then(([m, c, f]) => {
        setPainel({ id: m.data.id, nome: m.data.nome, analiseId: m.data.analiseId, analiseNome: m.data.analiseNome, analiseDono: m.data.analiseDono, analiseDoUsuario: m.data.analiseDoUsuario });
        setFundos({ fundoClaro: m.data.fundoClaro ?? null, fundoEscuro: m.data.fundoEscuro ?? null });
        setFiltrosIds(m.data.filtros.map((x: FiltroResumo) => x.id));
        setVisuais(m.data.visuais.map((v: any) => ({ chave: String(v.id), tipo: v.tipo, titulo: v.titulo, consultaId: v.consultaId, config: v.config, layout: v.layout })));
        setConsultas(c.data);
        setFiltros(f.data);
      })
      .catch((e) => setErro(mensagemDeErro(e)));
  }, [id]);

  // Aviso ao fechar a aba com alterações não salvas
  useEffect(() => {
    if (!alterado) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [alterado]);

  // Prévias: recalcula só os visuais cuja definição ou filtros mudaram
  useEffect(() => {
    for (const v of visuais) {
      const chave = JSON.stringify([v.tipo, v.consultaId, v.config, filtrosIds]);
      if (chavesPrevia.current[v.chave] === chave) continue;
      chavesPrevia.current[v.chave] = chave;
      setPrevias((p) => ({ ...p, [v.chave]: {} }));
      api
        .post('/paineis/montagem/previa', { visual: { ...v, titulo: v.titulo || 'Visual' }, filtrosIds, painelId: Number(id) })
        .then((r) => chavesPrevia.current[v.chave] === chave && setPrevias((p) => ({ ...p, [v.chave]: { dados: r.data.dados, erro: r.data.erro } })))
        .catch((e) => chavesPrevia.current[v.chave] === chave && setPrevias((p) => ({ ...p, [v.chave]: { erro: mensagemDeErro(e) } })));
    }
  }, [visuais, filtrosIds]);

  const alterar = (fn: (v: VisualMontagem[]) => VisualMontagem[]) => {
    setVisuais(fn);
    setAlterado(true);
  };

  const aoMoverGrade = useCallback((layout: Layout[]) => {
    setVisuais((atual) => {
      let mudou = false;
      const novo = atual.map((v) => {
        const l = layout.find((x) => x.i === v.chave);
        if (!l || (l.x === v.layout.x && l.y === v.layout.y && l.w === v.layout.w && l.h === v.layout.h)) return v;
        mudou = true;
        return { ...v, layout: { x: l.x, y: l.y, w: l.w, h: l.h } };
      });
      if (mudou) setAlterado(true);
      return mudou ? novo : atual;
    });
  }, []);

  const salvar = async () => {
    setSalvando(true);
    setErro(null);
    try {
      await api.put(`/paineis/${id}/montagem`, {
        ...fundos,
        filtros: filtrosIds,
        visuais: visuais.map(({ tipo, titulo, consultaId, config, layout }) => ({ tipo, titulo, consultaId, config, layout })),
      });
      setAlterado(false);
      avisar('Painel salvo. Quem tem acesso já vê a nova versão.');
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setSalvando(false);
    }
  };

  const layout: Layout[] = useMemo(
    () =>
      visuais.map((v) => ({
        i: v.chave,
        ...v.layout,
        minW: v.tipo === 'kpi' || v.tipo === 'imagem' ? 1 : 3,
        minH: v.tipo === 'kpi' || v.tipo === 'imagem' ? 1 : 3,
      })),
    [visuais],
  );

  // Parâmetros usados pelas consultas do painel que nenhum filtro escolhido atende
  const parametrosSemFiltro = useMemo(() => {
    const atendidos = new Set(filtros.filter((f) => filtrosIds.includes(f.id)).flatMap((f) => f.parametrosSql.map((p) => p.toLowerCase())));
    const usados = new Set(visuais.flatMap((v) => consultas.find((c) => c.id === v.consultaId)?.parametros ?? []));
    return [...usados].filter((p) => !atendidos.has(p.toLowerCase()));
  }, [filtros, filtrosIds, visuais, consultas]);

  if (erro && !painel) return <CAlert color="danger">{erro}</CAlert>;
  if (!painel) {
    return (
      <div className="py-5 text-center">
        <CSpinner color="primary" />
      </div>
    );
  }

  const fundo = visuais.reduce((m, v) => Math.max(m, v.layout.y + v.layout.h), 0);

  if (painel.analiseId) {
    return (
      <CCard className="estado-vazio">
        <CCardBody>
          <h2>{painel.nome} mostra uma análise publicada</h2>
          <p>
            Os gráficos e filtros vêm da análise <strong>{painel.analiseNome}</strong>
            {painel.analiseDono ? <>, de {painel.analiseDono}</> : null}. Para mudar o que aparece, edite a análise; o painel acompanha na hora. Nome, local no menu e
            grupos com acesso continuam em Administração › Menu.
          </p>
          <div className="d-flex justify-content-center gap-2 mt-3">
            <Link to={`/painel/${painel.id}`} className="btn btn-outline-secondary">
              Ver painel
            </Link>
            {painel.analiseDoUsuario && (
              <Link to={`/analises/${painel.analiseId}`} className="btn btn-primary">
                Editar a análise
              </Link>
            )}
          </div>
        </CCardBody>
      </CCard>
    );
  }

  return (
    <>
      <div className="pagina-cabecalho">
        <div>
          <h1 className="pagina-titulo">Montar: {painel.nome}</h1>
          <p className="pagina-descricao">Arraste pelos cantos para mover e pela borda inferior direita para redimensionar. A prévia usa os valores iniciais dos filtros.</p>
        </div>
        <div className="d-flex gap-2 align-items-center">
          {alterado && <span className="barra-acoes-aviso">Alterações não salvas</span>}
          <Link to={`/painel/${painel.id}`} className="btn btn-outline-secondary">
            Ver painel
          </Link>
          <CLoadingButton color="primary" loading={salvando} disabled={!alterado} onClick={salvar}>
            Salvar painel
          </CLoadingButton>
        </div>
      </div>

      {erro && <CAlert color="danger">{erro}</CAlert>}

      <CCard className="mb-3">
        <CCardBody className="montador-filtros">
          <div className="montador-filtros-campo">
            <SeletorMultiplo
              id="m-filtros"
              rotulo="Filtros do painel"
              placeholder={filtros.length ? 'Escolha os filtros que aparecem no topo do painel' : 'Nenhum filtro cadastrado'}
              opcoes={filtros.map((f) => ({ value: f.id, label: `${f.nome} (@${f.parametro})` }))}
              valor={filtrosIds}
              onChange={(ids) => {
                setFiltrosIds(ids);
                setAlterado(true);
              }}
            />
          </div>
          {parametrosSemFiltro.length > 0 && (
            <p className="montador-nota">
              As consultas usam {parametrosSemFiltro.map((p) => `@${p}`).join(', ')}, mas o painel não tem esse filtro: nesses casos a consulta
              traz todos os dados.
            </p>
          )}
          <div className="fundo-painel w-100">
            <span className="form-label mb-0">Fundo do painel</span>
            <SeletorCor
              id="fundo-claro"
              rotulo="Tema claro"
              opcional
              textoAutomatico="Padrão do sistema"
              valor={fundos.fundoClaro}
              onChange={(v) => {
                setFundos((f) => ({ ...f, fundoClaro: v }));
                setAlterado(true);
              }}
            />
            <SeletorCor
              id="fundo-escuro"
              rotulo="Tema escuro"
              opcional
              textoAutomatico="Padrão do sistema"
              valor={fundos.fundoEscuro}
              onChange={(v) => {
                setFundos((f) => ({ ...f, fundoEscuro: v }));
                setAlterado(true);
              }}
            />
          </div>
        </CCardBody>
      </CCard>

      {visuais.length === 0 ? (
        <CCard className="estado-vazio">
          <CCardBody>
            <CIcon icon={cilBarChart} size="3xl" className="estado-vazio-icone" />
            <h2>Painel vazio</h2>
            <p>
              {consultas.length
                ? 'Adicione indicadores, gráficos e tabelas. Cada visual lê uma consulta já cadastrada.'
                : 'Ainda não há consultas cadastradas. Um Desenvolvedor precisa criar as consultas em "Consultas de painel" antes.'}
            </p>
            {consultas.length > 0 && (
              <div className="d-flex flex-wrap justify-content-center gap-2 mt-3">
                <CButton color="primary" onClick={() => setEditando(novoVisual('barra', consultas[0], fundo))}>
                  Adicionar primeiro visual
                </CButton>
                <CButton color="primary" variant="outline" onClick={() => setIncluindo(true)}>
                  <CIcon icon={cilCopy} className="me-1" />
                  Incluir existente
                </CButton>
              </div>
            )}
          </CCardBody>
        </CCard>
      ) : (
        <>
          <div
            className="montador-grade"
            style={(tema === 'escuro' ? fundos.fundoEscuro : fundos.fundoClaro) ? { backgroundColor: (tema === 'escuro' ? fundos.fundoEscuro : fundos.fundoClaro)! } : undefined}
          >
            <Grade
              layout={layout}
              cols={12}
              rowHeight={ALTURA_LINHA}
              margin={[ESPACO, ESPACO]}
              containerPadding={[0, 0]}
              draggableHandle=".montador-arrastar"
              onLayoutChange={aoMoverGrade}
              compactType="vertical"
              resizeHandles={['se']}
            >
              {visuais.map((v) => (
                <div key={v.chave} className="montador-item">
                  <div className="montador-ferramentas">
                    <button type="button" className="montador-arrastar" title="Arrastar para mover" aria-label={`Mover ${v.titulo}`}>
                      <CIcon icon={cilMove} />
                    </button>
                    <button type="button" title="Configurar" aria-label={`Configurar ${v.titulo}`} onClick={() => setEditando(v)}>
                      <CIcon icon={cilPencil} />
                    </button>
                    {v.tipo !== 'imagem' && (
                      <button
                        type="button"
                        title="Filtros do visual"
                        aria-label={`Filtros de ${v.titulo}`}
                        className={v.config.filtrosVisual?.length ? 'com-filtro' : undefined}
                        onClick={() => setFiltrando(v)}
                      >
                        <CIcon icon={cilFilter} />
                        {v.config.filtrosVisual?.length > 0 && <span className="montador-contagem">{v.config.filtrosVisual.length}</span>}
                      </button>
                    )}
                    <button
                      type="button"
                      title="Duplicar"
                      aria-label={`Duplicar ${v.titulo}`}
                      onClick={() => alterar((a) => [...a, { ...v, chave: novaChave(), titulo: `${v.titulo} (cópia)`, layout: { ...v.layout, y: fundo } }])}
                    >
                      <CIcon icon={cilCopy} />
                    </button>
                    <button type="button" title="Remover" aria-label={`Remover ${v.titulo}`} onClick={() => alterar((a) => a.filter((x) => x.chave !== v.chave))}>
                      <CIcon icon={cilTrash} />
                    </button>
                  </div>
                  <Visual tipo={v.tipo} titulo={v.titulo} config={v.config} dados={previas[v.chave]?.dados} erro={previas[v.chave]?.erro} />
                </div>
              ))}
            </Grade>
          </div>
          <div className="mt-3">
            <CButton color="primary" variant="outline" onClick={() => setEditando(novoVisual('barra', consultas[0], fundo))} disabled={!consultas.length}>
              <CIcon icon={cilPlus} className="me-1" />
              Adicionar visual
            </CButton>
            <CButton color="primary" variant="outline" className="ms-2" onClick={() => setIncluindo(true)}>
              <CIcon icon={cilCopy} className="me-1" />
              Incluir existente
            </CButton>
          </div>
        </>
      )}

      {incluindo && (
        <IncluirExistente<ObjetoPainel>
          destino={{ no: 'no painel', neste: 'neste painel' }}
          tipos={TIPOS}
          buscar={async (busca, tipo) => {
            const r = await api.get('/paineis/montagem/objetos', { params: { busca, tipo: tipo || undefined, painelId: painel.id } });
            return r.data.map((o: any) => ({
              ...o,
              origem: o.painelId === painel.id ? `${o.painelNome} (este painel)` : o.painelNome,
              detalhe: o.tipo === 'imagem' ? o.local : [o.local, o.consultaNome].filter(Boolean).join(' · '),
            }));
          }}
          previa={async (o) => {
            const ids = [...new Set([...filtrosIds, ...(levarFiltros ? o.filtros.map((x) => x.id) : [])])];
            const r = await api.post('/paineis/montagem/previa', {
              visual: { tipo: o.tipo, titulo: o.titulo, consultaId: o.consultaId, config: o.config, layout: { x: 0, y: 0, w: 6, h: 4 } },
              filtrosIds: ids,
              painelId: o.painelId,
            });
            return { dados: r.data.dados, erro: r.data.erro };
          }}
          extra={(o) => {
            const faltam = o.filtros.filter((x) => !filtrosIds.includes(x.id));
            if (!faltam.length) return null;
            return (
              <CFormCheck
                className="mt-2"
                id="ie-filtros"
                checked={levarFiltros}
                onChange={(e) => setLevarFiltros(e.target.checked)}
                label={`Incluir também ${faltam.length === 1 ? 'o filtro' : 'os filtros'} ${faltam.map((x) => `"${x.nome}"`).join(', ')}, que a consulta usa e este painel ainda não tem`}
              />
            );
          }}
          onFechar={() => setIncluindo(false)}
          onIncluir={(o, titulo) => {
            const t = TIPOS.find((x) => x.tipo === o.tipo)!;
            const tamanho = o.layout ? { w: Math.min(12, o.layout.w), h: o.layout.h } : t.tamanho;
            const novo: VisualMontagem = { chave: novaChave(), tipo: o.tipo, titulo, consultaId: o.consultaId, config: structuredClone(o.config), layout: { x: 0, y: fundo, ...tamanho } };
            alterar((a) => [...a, novo]);
            const faltam = o.filtros.filter((x) => !filtrosIds.includes(x.id)).map((x) => x.id);
            if (levarFiltros && faltam.length) setFiltrosIds((ids) => [...ids, ...faltam]);
            setIncluindo(false);
            avisar(`"${titulo}" incluído no painel. Salve para gravar.`);
          }}
        />
      )}

      {filtrando && (
        <EditorFiltrosVisual
          visual={filtrando}
          colunas={consultas.find((x) => x.id === filtrando.consultaId)?.colunas ?? []}
          filtrosIds={filtrosIds}
          painelId={painel.id}
          podeExec={ehDesenvolvedor(usuario)}
          onFechar={() => setFiltrando(null)}
          onAplicar={(f) => {
            alterar((a) => a.map((x) => (x.chave === filtrando.chave ? { ...x, config: { ...x.config, filtrosVisual: f } } : x)));
            setFiltrando(null);
          }}
        />
      )}

      {editando && (
        <EditorVisual
          painelId={painel.id}
          inicial={editando}
          consultas={consultas}
          filtrosIds={filtrosIds}
          novo={!visuais.some((v) => v.chave === editando.chave)}
          onFechar={() => setEditando(null)}
          onAplicar={(v) => {
            alterar((a) => (a.some((x) => x.chave === v.chave) ? a.map((x) => (x.chave === v.chave ? v : x)) : [...a, v]));
            setEditando(null);
          }}
        />
      )}
    </>
  );
}

export function configPadrao(tipo: TipoVisual, c?: ConsultaResumo): Record<string, any> {
  const num = c?.colunas.filter((x) => x.tipo === 'numero') ?? [];
  const cat = c?.colunas.find((x) => x.tipo !== 'numero') ?? c?.colunas[0];
  const base = { agregacao: 'soma', formato: 'numero' };
  switch (tipo) {
    case 'kpi':
      return { ...base, medida: num[0]?.nome ?? '', meta: null, rotulo: null };
    case 'barra':
      return { ...base, categoria: cat?.nome ?? '', medidas: num[0] ? [num[0].nome] : [], horizontal: false, empilhado: false, ordenar: 'categoria', limite: null };
    case 'linha':
      return { ...base, categoria: cat?.nome ?? '', medidas: num[0] ? [num[0].nome] : [] };
    case 'pizza':
      return { ...base, categoria: cat?.nome ?? '', medida: num[0]?.nome ?? '', rosca: true, limite: 6 };
    case 'imagem':
      return { imagem: null, imagemEscuro: null, ajuste: 'conter', alinhamento: 'centro', mostrarTitulo: false, descricao: null };
    default:
      return { colunas: [], rotulos: {}, destaques: [], formato: 'numero' };
  }
}

function novoVisual(tipo: TipoVisual, c: ConsultaResumo, y: number): VisualMontagem {
  const t = TIPOS.find((x) => x.tipo === tipo)!;
  return { chave: novaChave(), tipo, titulo: '', consultaId: c.id, config: configPadrao(tipo, c), layout: { x: 0, y, ...t.tamanho } };
}

/* ---------- Configuração de um visual ---------- */

export type PreviaVisual = (v: VisualMontagem) => Promise<{ dados?: DadosVisual; erro?: string }>;

export function EditorVisual({
  painelId,
  inicial,
  consultas,
  filtrosIds,
  novo,
  onFechar,
  onAplicar,
  buscarPrevia,
  rotuloOrigem = 'Consulta',
}: {
  painelId?: number;
  /** Nome do campo de origem dos dados ("Consulta" nos painéis, "Cubo" nas análises) */
  rotuloOrigem?: string;
  inicial: VisualMontagem;
  consultas: ConsultaResumo[];
  filtrosIds?: number[];
  novo: boolean;
  onFechar: () => void;
  onAplicar: (v: VisualMontagem) => void;
  /** Prévia do visual; sem ela, usa a prévia do montador de painéis */
  buscarPrevia?: PreviaVisual;
}) {
  const [v, setV] = useState(inicial);
  const { tema: temaEditor } = useTema();
  const [previa, setPrevia] = useState<{ dados?: DadosVisual; erro?: string }>({});
  const [erro, setErro] = useState<string | null>(null);
  const consulta = consultas.find((c) => c.id === v.consultaId);
  const colunasOrigem = consulta?.colunas ?? [];
  const c = v.config;
  const setC = (k: string, val: unknown) => setV((x) => ({ ...x, config: { ...x.config, [k]: val } }));
  // Colunas calculadas: as por linha entram como colunas comuns; as agregadas só como valor
  const calc = useCalculadas(c.calculadas, colunasOrigem);
  const colunas: ColunaConsulta[] = [...colunasOrigem, ...calc.porLinha];
  const numericas = colunas.filter((x) => x.tipo === 'numero');
  const valores: ColunaConsulta[] = [...numericas, ...calc.agregadas];
  const valoresContagem: ColunaConsulta[] = [...colunas, ...calc.agregadas];
  const nomeColuna = calc.nomeDe;

  useEffect(() => {
    let ativo = true;
    setPrevia({});
    const t = window.setTimeout(() => {
      const pedido: Promise<{ dados?: DadosVisual; erro?: string }> = buscarPrevia
        ? buscarPrevia({ ...v, titulo: v.titulo || 'Visual' })
        : api
            .post('/paineis/montagem/previa', { visual: { ...v, titulo: v.titulo || 'Visual' }, filtrosIds: filtrosIds ?? [], painelId })
            .then((r) => ({ dados: r.data.dados, erro: r.data.erro }));
      pedido.then((r) => ativo && setPrevia(r)).catch((e) => ativo && setPrevia({ erro: mensagemDeErro(e) }));
    }, 300);
    return () => {
      ativo = false;
      window.clearTimeout(t);
    };
  }, [v.tipo, v.consultaId, JSON.stringify(v.config), filtrosIds]); // eslint-disable-line react-hooks/exhaustive-deps

  const trocarTipo = (tipo: TipoVisual) => {
    if (tipo === v.tipo) return;
    const t = TIPOS.find((x) => x.tipo === tipo)!;
    setPrevia({});
    setV((x) => ({ ...x, tipo, config: { ...configPadrao(tipo, consulta), filtrosVisual: x.config.filtrosVisual ?? [], calculadas: x.config.calculadas ?? [], tituloCor: x.config.tituloCor ?? null, tituloTamanho: x.config.tituloTamanho ?? null }, layout: novo ? { ...x.layout, ...t.tamanho } : x.layout }));
  };

  const aplicar = () => {
    if (!v.titulo.trim()) return setErro(v.tipo === 'imagem' ? 'Dê um nome à imagem (é o texto lido por leitores de tela e o título, se mostrado).' : 'Dê um título ao visual.');
    if (v.tipo === 'imagem' && !c.imagem) return setErro('Escolha a imagem.');
    if (v.tipo !== 'imagem' && previa.erro && !previa.dados) return setErro(previa.erro);
    onAplicar({ ...v, titulo: v.titulo.trim() });
  };

  const selColuna = (id: string, rotulo: string, chave: string, lista: ColunaConsulta[], opcional = false) => (
    <div className="mb-3">
      <CFormLabel htmlFor={id}>{rotulo}</CFormLabel>
      <CFormSelect id={id} value={c[chave] ?? ''} onChange={(e) => setC(chave, e.target.value || null)}>
        {opcional ? <option value="">Nenhuma</option> : !c[chave] && <option value="">Escolha</option>}
        {lista.map((x) => (
          <option key={x.nome} value={x.nome}>
            {nomeColuna(x.nome)}
          </option>
        ))}
      </CFormSelect>
    </div>
  );

  const medidasSel: string[] = c.medidas ?? [];
  const paleta = paletaDoTema(temaEditor);
  const medidasMultiplas = (
    <fieldset className="mb-3">
      <legend className="form-label fs-6">Valores (até 8 séries)</legend>
      {valores.length === 0 && <p className="text-body-secondary small">A consulta não tem colunas numéricas.</p>}
      {valores.length > 0 && (
        <div className="colunas-series">
          <span className="colunas-tabela-cab">Coluna no banco</span>
          <span className="colunas-tabela-cab">Nome exibido</span>
          <span className="colunas-tabela-cab">Cor</span>
          {valores.map((x) => {
            const marcada = medidasSel.includes(x.nome);
            const corPadrao = paleta.series[Math.max(0, medidasSel.indexOf(x.nome)) % paleta.series.length];
            return (
              <div key={x.nome} className="colunas-tabela-linha">
                <CFormCheck
                  id={`m-med-${x.nome}`}
                  label={calc.rotulos[x.nome] ?? x.nome}
                  checked={marcada}
                  disabled={!marcada && medidasSel.length >= 8}
                  onChange={(e) => setC('medidas', e.target.checked ? [...medidasSel, x.nome] : medidasSel.filter((m) => m !== x.nome))}
                />
                <CFormInput
                  size="sm"
                  aria-label={`Nome exibido para ${x.nome}`}
                  placeholder={nomeColuna(x.nome)}
                  maxLength={80}
                  disabled={!marcada}
                  value={c.rotulos?.[x.nome] ?? ''}
                  onChange={(e) => {
                    const r = { ...(c.rotulos ?? {}) };
                    if (e.target.value) r[x.nome] = e.target.value;
                    else delete r[x.nome];
                    setC('rotulos', r);
                  }}
                />
                <div className="cor-serie">
                  <input
                    type="color"
                    className="destaque-outra"
                    aria-label={`Cor de ${x.nome}`}
                    disabled={!marcada}
                    value={c.cores?.[x.nome] ?? corPadrao}
                    onChange={(e) => setC('cores', { ...(c.cores ?? {}), [x.nome]: e.target.value })}
                  />
                  {c.cores?.[x.nome] && (
                    <button
                      type="button"
                      className="btn btn-link btn-sm p-0"
                      onClick={() => {
                        const k = { ...(c.cores ?? {}) };
                        delete k[x.nome];
                        setC('cores', k);
                      }}
                    >
                      Padrão
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div className="form-text">Sem cor escolhida, a série usa a paleta do sistema, que já é legível para daltonismo nos dois temas.</div>
    </fieldset>
  );

  /** Cor e tamanho (px) de um texto do visual. */
  const estiloTexto = (id: string, rotulo: string, chaveCor: string, chaveTam: string, min: number, max: number, dica: string) => (
    <div className="estilo-texto">
      <SeletorCor id={`${id}-cor`} rotulo={rotulo} opcional textoAutomatico="Cor padrão" valor={c[chaveCor] ?? null} onChange={(val) => setC(chaveCor, val)} />
      <label className="estilo-tamanho">
        <span className="destaque-rotulo">Tamanho</span>
        <CFormInput
          size="sm"
          type="number"
          min={min}
          max={max}
          placeholder={dica}
          value={c[chaveTam] ?? ''}
          onChange={(e) => setC(chaveTam, e.target.value ? Math.max(min, Math.min(max, Number(e.target.value))) : null)}
        />
        <span className="text-body-secondary small">px</span>
      </label>
    </div>
  );

  const aparencia = (
    <fieldset className="mb-3 aparencia-visual">
      <legend className="form-label fs-6">Aparência</legend>
      {estiloTexto('m-tit', 'Título', 'tituloCor', 'tituloTamanho', 10, 48, '14')}
      {v.tipo === 'kpi' && (
        <>
          {estiloTexto('m-val', 'Valor', 'valorCor', 'valorTamanho', 14, 160, '35')}
          {estiloTexto('m-txt', 'Texto abaixo', 'rotuloCor', 'rotuloTamanho', 9, 48, '13')}
          <div className="mt-2">
            <span className="destaque-rotulo">Ícone ao lado do valor</span>
            <div className="icones-indicador" role="radiogroup" aria-label="Ícone ao lado do valor">
              <button type="button" role="radio" aria-checked={!c.icone} className={!c.icone ? 'ativo' : ''} onClick={() => setC('icone', null)} title="Sem ícone">
                <span className="small">Nenhum</span>
              </button>
              <button type="button" role="radio" aria-checked={c.icone === 'circulo'} className={c.icone === 'circulo' ? 'ativo' : ''} onClick={() => setC('icone', 'circulo')} title="Círculo de situação">
                <span className="icone-circulo-amostra" style={{ backgroundColor: (temaEditor === 'escuro' ? (c.iconeCorEscuro ?? c.iconeCor) : (c.iconeCor ?? c.iconeCorEscuro)) ?? 'var(--bi-primary)' }} />
              </button>
              {ICONES_INDICADOR.map((i) => (
                <button key={i.nome} type="button" role="radio" aria-checked={c.icone === i.nome} className={c.icone === i.nome ? 'ativo' : ''} onClick={() => setC('icone', i.nome)} title={i.rotulo} aria-label={i.rotulo}>
                  <CIcon icon={i.icone} />
                </button>
              ))}
            </div>
          </div>
          {c.icone && (
            <div className="estilo-texto">
              <SeletorCor id="m-ico-cor" rotulo="Ícone, tema claro" opcional textoAutomatico="Igual ao tema escuro, ou cor principal" valor={c.iconeCor ?? null} onChange={(val) => setC('iconeCor', val)} />
              <SeletorCor id="m-ico-cor-escuro" rotulo="Ícone, tema escuro" opcional textoAutomatico="Igual ao tema claro, ou cor principal" valor={c.iconeCorEscuro ?? null} onChange={(val) => setC('iconeCorEscuro', val)} />
              <label className="estilo-tamanho">
                <span className="destaque-rotulo">Tamanho</span>
                <CFormInput
                  size="sm"
                  type="number"
                  min={12}
                  max={240}
                  value={c.iconeTamanho ?? 48}
                  onChange={(e) => setC('iconeTamanho', Math.max(12, Math.min(240, Number(e.target.value) || 48)))}
                />
                <span className="text-body-secondary small">px</span>
              </label>
            </div>
          )}
        </>
      )}
    </fieldset>
  );

  const agregacaoFormato = (
    <div className="row g-2 mb-3">
      <div className="col-6">
        <CFormLabel htmlFor="m-agreg">Agregação</CFormLabel>
        <CFormSelect id="m-agreg" value={c.agregacao ?? 'soma'} onChange={(e) => setC('agregacao', e.target.value)}>
          {Object.entries(NOMES_AGREGACAO).map(([k, n]) => (
            <option key={k} value={k}>
              {n}
            </option>
          ))}
        </CFormSelect>
      </div>
      <div className="col-6">
        <CFormLabel htmlFor="m-formato">Formato dos valores</CFormLabel>
        <CFormSelect id="m-formato" value={c.formato ?? 'numero'} onChange={(e) => setC('formato', e.target.value)}>
          {Object.entries(NOMES_FORMATO).map(([k, n]) => (
            <option key={k} value={k}>
              {n}
            </option>
          ))}
        </CFormSelect>
      </div>
      {[c.medida, c.meta, ...(c.medidas ?? [])].some((m) => m && calc.agregadas.some((a) => a.nome === m)) && (
        <div className="form-text col-12 mt-0">Colunas calculadas com SOMA, CONTAR e afins já trazem o próprio cálculo: a agregação escolhida não muda o valor delas.</div>
      )}
    </div>
  );

  return (
    <CModal visible size="xl" onClose={onFechar} alignment="center" backdrop="static">
      <CModalHeader>
        <CModalTitle>{novo ? 'Novo visual' : 'Configurar visual'}</CModalTitle>
      </CModalHeader>
      <CModalBody>
        <div className="tipos-visual" role="radiogroup" aria-label="Tipo de visual">
          {TIPOS.map((t) => (
            <button key={t.tipo} type="button" role="radio" aria-checked={v.tipo === t.tipo} className={v.tipo === t.tipo ? 'ativo' : ''} onClick={() => trocarTipo(t.tipo)}>
              <CIcon icon={t.icone} size="lg" />
              <strong>{t.nome}</strong>
              <span>{t.uso}</span>
            </button>
          ))}
        </div>
        <div className="editor-visual">
          <div className="editor-visual-campos">
            <div className="mb-3">
              <CFormLabel htmlFor="m-titulo">Título</CFormLabel>
              <CFormInput id="m-titulo" value={v.titulo} maxLength={120} onChange={(e) => setV((x) => ({ ...x, titulo: e.target.value }))} placeholder="Ex.: Faturamento por filial" />
            </div>
            <div className={`mb-3${(consultas.length === 1 && buscarPrevia) || v.tipo === 'imagem' ? ' d-none' : ''}`}>
              <CFormLabel htmlFor="m-consulta">{rotuloOrigem}</CFormLabel>
              <CFormSelect
                id="m-consulta"
                value={v.consultaId}
                onChange={(e) => {
                  const nova = consultas.find((x) => x.id === Number(e.target.value));
                  setPrevia({});
                  setV((x) => ({ ...x, consultaId: Number(e.target.value), config: configPadrao(x.tipo, nova) }));
                }}
              >
                {consultas.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.nome}
                  </option>
                ))}
              </CFormSelect>
              {consulta?.descricao && <div className="form-text">{consulta.descricao}</div>}
            </div>
            {v.tipo !== 'imagem' && (
              <EditorCalculadas
                calculadas={c.calculadas ?? []}
                colunas={colunasOrigem}
                info={calc.info}
                onChange={(lista, removida) =>
                  setV((x) => ({ ...x, config: { ...(removida ? semReferencias(x.config, removida) : x.config), calculadas: lista } }))
                }
              />
            )}

            {v.tipo === 'imagem' && (
              <>
                <SeletorImagem id="m-imagem" rotulo="Imagem" valor={c.imagem ?? null} onChange={(k) => setC('imagem', k)} />
                <SeletorImagem
                  id="m-imagem-escuro"
                  rotulo="No tema escuro (opcional)"
                  opcaoVazia="A mesma"
                  semAtalho
                  valor={c.imagemEscuro ?? null}
                  onChange={(k) => setC('imagemEscuro', k)}
                />
                <div className="row g-2 mb-3">
                  <div className="col-6">
                    <CFormLabel htmlFor="m-ajuste">Ajuste</CFormLabel>
                    <CFormSelect id="m-ajuste" value={c.ajuste ?? 'conter'} onChange={(e) => setC('ajuste', e.target.value)}>
                      <option value="conter">Caber inteira no espaço</option>
                      <option value="preencher">Preencher o espaço (corta as bordas)</option>
                      <option value="original">Tamanho original</option>
                    </CFormSelect>
                  </div>
                  <div className="col-6">
                    <CFormLabel htmlFor="m-alinhar">Alinhamento</CFormLabel>
                    <CFormSelect id="m-alinhar" value={c.alinhamento ?? 'centro'} onChange={(e) => setC('alinhamento', e.target.value)}>
                      <option value="centro">Centro</option>
                      <option value="esquerda">Esquerda</option>
                      <option value="direita">Direita</option>
                    </CFormSelect>
                  </div>
                </div>
                <div className="mb-3">
                  <CFormLabel htmlFor="m-alt">Descrição para leitores de tela (opcional)</CFormLabel>
                  <CFormInput id="m-alt" value={c.descricao ?? ''} maxLength={200} placeholder="Sem descrição, usa o título" onChange={(e) => setC('descricao', e.target.value || null)} />
                </div>
                <CFormSwitch id="m-mostrar-titulo" className="mb-3" label="Mostrar o título acima da imagem" checked={!!c.mostrarTitulo} onChange={(e) => setC('mostrarTitulo', e.target.checked)} />
              </>
            )}
            {v.tipo === 'kpi' && (
              <>
                {selColuna('m-medida', 'Valor', 'medida', c.agregacao === 'contagem' ? valoresContagem : valores)}
                {agregacaoFormato}
                {selColuna('m-meta', 'Meta (opcional)', 'meta', valores, true)}
                <div className="mb-3">
                  <CFormLabel htmlFor="m-rotulo">Texto abaixo do número (opcional)</CFormLabel>
                  <CFormInput id="m-rotulo" value={c.rotulo ?? ''} maxLength={80} onChange={(e) => setC('rotulo', e.target.value || null)} />
                </div>
              </>
            )}
            {(v.tipo === 'barra' || v.tipo === 'linha') && (
              <>
                {selColuna('m-cat', v.tipo === 'linha' ? 'Eixo horizontal (período ou categoria)' : 'Categoria', 'categoria', colunas)}
                {medidasMultiplas}
                {agregacaoFormato}
                {v.tipo === 'barra' && (
                  <>
                    <div className="row g-2 mb-3">
                      <div className="col-7">
                        <CFormLabel htmlFor="m-ordem">Ordem das barras</CFormLabel>
                        <CFormSelect id="m-ordem" value={c.ordenar ?? 'categoria'} onChange={(e) => setC('ordenar', e.target.value)}>
                          <option value="categoria">Pela categoria</option>
                          <option value="valor_desc">Maior valor primeiro</option>
                          <option value="valor_asc">Menor valor primeiro</option>
                        </CFormSelect>
                      </div>
                      <div className="col-5">
                        <CFormLabel htmlFor="m-limite">Mostrar até</CFormLabel>
                        <CFormInput
                          id="m-limite"
                          type="number"
                          min={1}
                          max={100}
                          placeholder="Todas"
                          value={c.limite ?? ''}
                          onChange={(e) => setC('limite', e.target.value ? Math.min(100, Math.max(1, Number(e.target.value))) : null)}
                        />
                      </div>
                    </div>
                    <CFormSwitch id="m-horiz" label="Barras deitadas (bom para nomes longos)" checked={!!c.horizontal} onChange={(e) => setC('horizontal', e.target.checked)} />
                    {(c.medidas ?? []).length > 1 && (
                      <CFormSwitch id="m-empilhar" label="Empilhar as séries" checked={!!c.empilhado} onChange={(e) => setC('empilhado', e.target.checked)} />
                    )}
                  </>
                )}
              </>
            )}
            {v.tipo === 'pizza' && (
              <>
                {selColuna('m-cat', 'Categoria (fatias)', 'categoria', colunas)}
                {selColuna('m-medida', 'Valor', 'medida', c.agregacao === 'contagem' ? valoresContagem : valores)}
                {agregacaoFormato}
                <div className="mb-3">
                  <CFormLabel htmlFor="m-fatias">Máximo de fatias</CFormLabel>
                  <CFormSelect id="m-fatias" value={c.limite ?? 6} onChange={(e) => setC('limite', Number(e.target.value))}>
                    {[3, 4, 5, 6, 7, 8].map((n) => (
                      <option key={n} value={n}>
                        {n} (as demais viram "Outros")
                      </option>
                    ))}
                  </CFormSelect>
                </div>
                <CFormSwitch id="m-rosca" label="Formato de rosca" checked={c.rosca !== false} onChange={(e) => setC('rosca', e.target.checked)} />
              </>
            )}
            {v.tipo === 'tabela' && (
              <>
                <fieldset className="mb-3">
                  <legend className="form-label fs-6">Colunas (nenhuma marcada = todas)</legend>
                  <div className="colunas-tabela">
                    <span className="colunas-tabela-cab">Coluna no banco</span>
                    <span className="colunas-tabela-cab">Nome exibido</span>
                    {colunas.map((x) => {
                      const marcada = (c.colunas ?? []).includes(x.nome);
                      const visivel = marcada || !(c.colunas ?? []).length;
                      return (
                        <div key={x.nome} className="colunas-tabela-linha">
                          <CFormCheck
                            id={`m-col-${x.nome}`}
                            label={calc.rotulos[x.nome] ?? x.nome}
                            checked={marcada}
                            onChange={(e) => setC('colunas', e.target.checked ? [...(c.colunas ?? []), x.nome] : (c.colunas ?? []).filter((m: string) => m !== x.nome))}
                          />
                          <CFormInput
                            size="sm"
                            aria-label={`Nome exibido para ${x.nome}`}
                            placeholder={nomeColuna(x.nome)}
                            maxLength={80}
                            disabled={!visivel}
                            value={c.rotulos?.[x.nome] ?? ''}
                            onChange={(e) => {
                              const rotulos = { ...(c.rotulos ?? {}) };
                              if (e.target.value) rotulos[x.nome] = e.target.value;
                              else delete rotulos[x.nome];
                              setC('rotulos', rotulos);
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                  <div className="form-text">Em branco, a tabela usa o nome da coluna. A ordem das colunas segue a ordem em que foram marcadas.</div>
                </fieldset>
                <div className="mb-3">
                  <CFormLabel htmlFor="m-formato">Formato dos números</CFormLabel>
                  <CFormSelect id="m-formato" value={c.formato ?? 'numero'} onChange={(e) => setC('formato', e.target.value)}>
                    {Object.entries(NOMES_FORMATO).map(([k, n]) => (
                      <option key={k} value={k}>
                        {n}
                      </option>
                    ))}
                  </CFormSelect>
                </div>
              </>
            )}
            {(v.tipo !== 'imagem' || c.mostrarTitulo) && aparencia}
          </div>
          <div className="editor-visual-previa">
            <span className="editor-visual-previa-rotulo">Prévia</span>
            <div className="editor-visual-previa-area" style={{ height: v.tipo === 'kpi' ? 170 : v.tipo === 'imagem' ? 220 : 360 }}>
              <Visual tipo={v.tipo} titulo={v.titulo || 'Sem título'} config={v.config} dados={previa.dados} erro={previa.erro} />
            </div>
          </div>
        </div>
        {v.tipo === 'tabela' && (
          <EditorDestaques
            regras={c.destaques ?? []}
            colunas={colunas}
            colunasExibidas={(c.colunas ?? []).length ? c.colunas : colunas.map((x) => x.nome)}
            onChange={(r) => setC('destaques', r)}
          />
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
        <CButton color="primary" onClick={aplicar}>
          {novo ? 'Adicionar ao painel' : 'Aplicar'}
        </CButton>
      </CModalFooter>
    </CModal>
  );
}
