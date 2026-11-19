import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import GridLayout, { WidthProvider, type Layout } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import {
  CAlert,
  CBreadcrumb,
  CBreadcrumbItem,
  CButton,
  CFormInput,
  CFormTextarea,
  CLoadingButton,
  CModal,
  CModalBody,
  CModalFooter,
  CModalHeader,
  CModalTitle,
  CSpinner,
} from '@coreui/react-pro';
import CIcon from '@coreui/icons-react';
import {
  cilCalendar,
  cilCopy,
  cilFilter,
  cilLink,
  cilLinkBroken,
  cilMove,
  cilPencil,
  cilPlus,
  cilSend,
  cilShareBoxed,
  cilSpeedometer,
  cilScreenDesktop,
  cilTrash,
  cilX,
} from '@coreui/icons';
import { api, detalheDoErro, mensagemDeErro } from '../../api/client';
import { useAvisos } from '../../contexts/AvisosContext';
import { BarraFiltros, type ValoresFiltros } from '../../components/paineis/BarraFiltros';
import { EditorFiltrosVisual } from '../../components/paineis/EditorFiltrosVisual';
import { IncluirExistente, type ObjetoExistente } from '../../components/paineis/IncluirExistente';
import { ALTURA_LINHA, ESPACO, GradeVisuais } from '../../components/paineis/GradeVisuais';
import { Visual, type DadosVisual } from '../../components/paineis/Visual';
import { configPadrao, EditorVisual, novaChave, TIPOS, type ConsultaResumo, type VisualMontagem } from '../admin/MontarPainelPage';
import { EditorFiltrosTopo } from './EditorFiltrosTopo';
import { ModalLigacao } from './ModalLigacao';
import { ModalPublicar, type PainelPublicado } from './ModalPublicar';
import {
  colunasEmComum,
  LIGACOES_VAZIAS,
  mesmoPar,
  rotulo,
  type Coluna,
  type CuboInfo,
  type FiltroTopo,
  type LigacoesCfg,
  type Modelo,
  type Ponta,
} from './modelo';

const Grade = WidthProvider(GridLayout);
const MAX_CUBOS = 6;

interface PainelPronto {
  id: number;
  nome: string;
  descricao: string | null;
  cuboId: number;
  visuais: { tipo: VisualMontagem['tipo']; titulo: string; config: Record<string, any>; layout: VisualMontagem['layout'] }[];
  foraDoCubo: number;
  semExpressao: string[];
}
interface Conversa {
  pedido: string;
  mensagem?: string;
  avisos?: string[];
  erro?: string;
  /** Motivo técnico (Gestor e Desenvolvedor) */
  detalhe?: string | null;
}

const MARCA_TIPO: Record<Coluna['tipo'], string> = { numero: '123', texto: 'Aa', data: '' };

/** Sugestões de pedido com as colunas do próprio cubo, escritas com os nomes que o usuário conhece. */
function sugestoes(colunas: Coluna[]) {
  // Valores de verdade (valor, quantidade, total) antes de códigos e números de identificação
  // Colunas descritas no cubo vêm primeiro: são as que o Desenvolvedor considerou importantes
  const pontos = (c: Coluna) =>
    (c.descricao?.trim() ? 3 : 0) +
    (/^(vl|valor|vlr|total|receita|frete|custo)/i.test(c.nome) ? 2 : /^(qtd|quant|peso)/i.test(c.nome) ? 1 : 0) -
    (/^(cd|id|codigo|cod|nr|num|ano|mes|seq)(_|$)/i.test(c.nome) ? 4 : 0);
  const num = colunas.filter((c) => c.tipo === 'numero').sort((a, b) => pontos(b) - pontos(a));
  const periodo = /^(dt|data|anomes|ano_?mes|mes|ano|periodo|competencia)/i;
  const tempo = colunas.find((c) => c.tipo === 'data') ?? colunas.find((c) => periodo.test(c.nome));
  // Categorias: textos que não são período nem código
  const txt = colunas
    .filter((c) => c.tipo === 'texto' && !periodo.test(c.nome) && !/^(cd|id|codigo|cod)(_|$)/i.test(c.nome))
    .sort((a, b) => Number(!!b.descricao?.trim()) - Number(!!a.descricao?.trim()));
  const valor = num[0];
  const s: string[] = [];
  if (valor) s.push(`Total de ${rotulo(valor)} em destaque`);
  if (valor && tempo) s.push(`Evolução de ${rotulo(valor)} por ${rotulo(tempo)}, com filtro de mês e ano`);
  if (valor && txt[0]) s.push(`Ranking de ${rotulo(txt[0])} por ${rotulo(valor)}, só os 10 maiores`);
  if (valor && txt[1]) s.push(`Participação de cada ${rotulo(txt[1])} no ${rotulo(valor)}`);
  else if (!valor && txt[0]) s.push(`Quantidade de registros por ${rotulo(txt[0])}`);
  return s.slice(0, 4);
}

/** Visual de outra análise da pessoa, achado pelo "Incluir existente" */
interface ObjetoAnalise extends ObjetoExistente {
  cuboId: number;
  cuboNome: string | null;
  analiseId: number;
}

export function AnalisePage() {
  const { id } = useParams();
  const nova = !id;
  const [busca] = useSearchParams();
  const navigate = useNavigate();
  const avisar = useAvisos();

  // O que define a análise
  const [nome, setNome] = useState('');
  const [cubosIds, setCubosIds] = useState<number[]>([]);
  const [filtrosTopo, setFiltrosTopo] = useState<FiltroTopo[]>([]);
  const [ligacoes, setLigacoes] = useState<LigacoesCfg>(LIGACOES_VAZIAS);
  const [visuais, setVisuais] = useState<VisualMontagem[]>([]);
  const [valores, setValores] = useState<ValoresFiltros>({});
  const [painel, setPainel] = useState<PainelPublicado | null>(null);

  // O que o servidor devolve a partir da definição
  const [carregada, setCarregada] = useState(false);
  const [modelo, setModelo] = useState<Modelo | null>(null);
  const [resultado, setResultado] = useState<Record<string, { dados?: DadosVisual; erro?: string }>>({});
  const [carregando, setCarregando] = useState(false);

  const [alterado, setAlterado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const [paineis, setPaineis] = useState<PainelPronto[] | null>(null);
  const [escolherPainel, setEscolherPainel] = useState(false);
  const [escolherCubo, setEscolherCubo] = useState(false);
  const [cubosLiberados, setCubosLiberados] = useState<CuboInfo[] | null>(null);
  const [editandoFiltros, setEditandoFiltros] = useState(false);
  const [ligando, setLigando] = useState<{ a: Ponta; b: Ponta } | null>(null);
  const [publicando, setPublicando] = useState(false);

  const [pedido, setPedido] = useState('');
  const [pensando, setPensando] = useState(false);
  const [conversa, setConversa] = useState<Conversa[]>([]);
  const [editando, setEditando] = useState<VisualMontagem | null>(null);
  const [filtrando, setFiltrando] = useState<VisualMontagem | null>(null);
  const [incluindo, setIncluindo] = useState(false);
  const campoPedido = useRef<HTMLTextAreaElement>(null);
  // Em telas estreitas os visuais ficam empilhados (sem arrastar)
  const [estreita, setEstreita] = useState(() => window.matchMedia('(max-width: 767.98px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767.98px)');
    const h = () => setEstreita(mq.matches);
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, []);
  const pedidoDados = useRef(0);
  const pedidoModelo = useRef(0);

  // Carrega a análise salva (ou o cubo escolhido para uma nova)
  useEffect(() => {
    let ativo = true;
    setCarregada(false);
    setModelo(null);
    (async () => {
      try {
        if (nova) {
          const cuboId = Number(busca.get('cubo'));
          if (!cuboId) throw new Error('Escolha um cubo para começar.');
          setCubosIds([cuboId]);
          setNome('');
        } else {
          const a = (await api.get(`/analises/${id}`)).data;
          if (!ativo) return;
          const cubos: number[] = a.cubos?.length ? a.cubos : [a.cuboId];
          setNome(a.nome);
          setCubosIds(cubos);
          setFiltrosTopo(a.filtrosTopo ?? []);
          setLigacoes({ ...LIGACOES_VAZIAS, ...(a.ligacoes ?? {}) });
          setVisuais(a.visuais.map((v: any) => ({ ...v, chave: novaChave(), consultaId: v.cuboId ?? cubos[0] })));
          setValores(a.filtros ?? {});
          setPainel(a.painel ?? null);
        }
        if (ativo) setCarregada(true);
      } catch (e) {
        if (ativo) setErro(e instanceof Error && !('isAxiosError' in e) ? e.message : mensagemDeErro(e));
      }
    })();
    return () => {
      ativo = false;
    };
  }, [id, nova, busca]);

  // Cubos, ligações e barra de filtros: recalculados quando a definição muda
  const assinaturaModelo = JSON.stringify([cubosIds, filtrosTopo, ligacoes]);
  useEffect(() => {
    if (!carregada || !cubosIds.length) return;
    const n = ++pedidoModelo.current;
    api
      .post<Modelo>('/analises/modelo', { cubos: cubosIds, filtrosTopo, ligacoes, filtros: valores })
      .then((r) => {
        if (n !== pedidoModelo.current) return;
        setModelo(r.data);
        setErro(null);
        // Filtros novos começam no valor inicial deles
        setValores((v) => {
          const faltando = r.data.filtros.filter((f) => !(f.parametro in v));
          return faltando.length ? { ...v, ...Object.fromEntries(faltando.map((f) => [f.parametro, f.padrao])) } : v;
        });
        setNome((x) => x || `Análise de ${r.data.cubos[0]?.nome ?? 'dados'}`);
      })
      .catch((e) => n === pedidoModelo.current && setErro(mensagemDeErro(e)));
  }, [carregada, assinaturaModelo]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!alterado) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [alterado]);

  const definicao = useCallback(
    (lista: VisualMontagem[]) => ({ cubos: cubosIds, filtrosTopo, ligacoes, visuais: corpoVisuais(lista), filtros: valores }),
    [cubosIds, filtrosTopo, ligacoes, valores],
  );

  // Recalcula quando muda o que afeta os números (não a posição na grade)
  const assinatura = JSON.stringify([assinaturaModelo, visuais.map((v) => [v.chave, v.tipo, v.consultaId, v.config]), valores]);
  useEffect(() => {
    if (!modelo || !visuais.length) {
      setResultado({});
      return;
    }
    const n = ++pedidoDados.current;
    const t = window.setTimeout(async () => {
      setCarregando(true);
      try {
        const r = await api.post('/analises/dados', definicao(visuais));
        if (n !== pedidoDados.current) return;
        setResultado(Object.fromEntries(r.data.visuais.map((x: any, i: number) => [visuais[i]?.chave, { dados: x.dados, erro: x.erro }])));
      } catch (e) {
        if (n !== pedidoDados.current) return;
        const msg = mensagemDeErro(e);
        setResultado(Object.fromEntries(visuais.map((v) => [v.chave, { erro: msg }])));
      } finally {
        if (n === pedidoDados.current) setCarregando(false);
      }
    }, 350);
    return () => window.clearTimeout(t);
  }, [modelo, assinatura]); // eslint-disable-line react-hooks/exhaustive-deps

  const alterar = (fn: (v: VisualMontagem[]) => VisualMontagem[]) => {
    setVisuais(fn);
    setAlterado(true);
  };
  const mudarModelo = <T,>(set: (fn: (x: T) => T) => void, fn: (x: T) => T) => {
    set(fn);
    setAlterado(true);
  };

  const pedirIa = async (texto = pedido) => {
    if (!modelo || !texto.trim() || pensando) return;
    const item: Conversa = { pedido: texto.trim() };
    setConversa((c) => [...c, item]);
    setPedido('');
    setPensando(true);
    try {
      const { filtros: _f, ...corpo } = definicao(visuais);
      const r = await api.post('/analises/ia', { ...corpo, pedido: item.pedido });
      // Mantém a chave dos visuais que continuaram (mesmo título), para não piscar
      const antigos = new Map(visuais.map((v) => [v.titulo.trim().toLowerCase(), v.chave]));
      const novos: VisualMontagem[] = r.data.visuais.map((v: any) => ({
        chave: antigos.get(String(v.titulo).trim().toLowerCase()) ?? novaChave(),
        tipo: v.tipo,
        titulo: v.titulo,
        consultaId: v.cuboId,
        config: v.config,
        layout: v.layout,
      }));
      const filtrosNovos: FiltroTopo[] | null = r.data.filtrosTopo;
      const avisos: string[] = [...(r.data.avisos ?? [])];
      if (filtrosNovos) {
        const antes = new Set(filtrosTopo.map((f) => f.id));
        const criados = filtrosNovos.filter((f) => !antes.has(f.id));
        if (criados.length) avisos.unshift(`Filtros no topo: ${criados.map((f) => f.nome).join(', ')}.`);
        mudarModelo(setFiltrosTopo, () => filtrosNovos);
      }
      setConversa((c) => c.map((x) => (x === item ? { ...x, mensagem: r.data.mensagem, avisos } : x)));
      if (novos.length || visuais.length) alterar(() => novos);
    } catch (e) {
      setConversa((c) => c.map((x) => (x === item ? { ...x, erro: mensagemDeErro(e), detalhe: detalheDoErro(e) } : x)));
    } finally {
      setPensando(false);
      campoPedido.current?.focus();
    }
  };

  const abrirPaineis = async () => {
    setEscolherPainel(true);
    setPaineis(null);
    try {
      setPaineis((await api.post<PainelPronto[]>('/analises/paineis-prontos', { cubos: cubosIds })).data);
    } catch (e) {
      setEscolherPainel(false);
      setErro(mensagemDeErro(e));
    }
  };

  /** Copia os visuais do painel: análise vazia recebe o layout do painel; senão, os visuais entram embaixo. */
  const usarPainel = (p: PainelPronto) => {
    const deslocar = visuais.length ? visuais.reduce((m, v) => Math.max(m, v.layout.y + v.layout.h), 0) : 0;
    const titulos = new Set(visuais.map((v) => v.titulo.trim().toLowerCase()));
    const copias: VisualMontagem[] = p.visuais.map((v) => ({
      chave: novaChave(),
      tipo: v.tipo,
      titulo: titulos.has(v.titulo.trim().toLowerCase()) ? `${v.titulo} (${p.nome})` : v.titulo,
      consultaId: p.cuboId,
      config: v.config,
      layout: { ...v.layout, y: v.layout.y + deslocar },
    }));
    alterar((a) => [...a, ...copias]);
    if (nova && !visuais.length && modelo && nome === `Análise de ${modelo.cubos[0]?.nome}`) setNome(`${p.nome} (minha versão)`);
    setConversa((c) => [
      ...c,
      {
        pedido: `Começar a partir do painel "${p.nome}"`,
        mensagem: `Trouxe ${copias.length} ${copias.length === 1 ? 'visual' : 'visuais'} do painel. Agora é só pedir os ajustes, por exemplo "troque por cliente" ou "só o último trimestre".`,
        avisos: [
          ...(p.foraDoCubo ? [`${p.foraDoCubo} ${p.foraDoCubo === 1 ? 'visual do painel usa' : 'visuais do painel usam'} dados que não estão neste cubo e ficaram de fora.`] : []),
          ...(p.semExpressao.length
            ? [`${p.semExpressao.map((t) => `"${t}"`).join(', ')}: o filtro calculado (exec=) do painel não vale nas análises e foi retirado, por isso o número pode ser diferente do painel. Peça à IA o filtro que você precisa.`]
            : []),
        ],
      },
    ]);
    setEscolherPainel(false);
  };

  /* ---------- Cubos e ligações ---------- */

  const abrirCubos = async () => {
    setEscolherCubo(true);
    if (cubosLiberados) return;
    try {
      setCubosLiberados((await api.get<CuboInfo[]>('/analises/cubos')).data);
    } catch (e) {
      setEscolherCubo(false);
      setErro(mensagemDeErro(e));
    }
  };

  const adicionarCubo = (c: CuboInfo) => {
    mudarModelo(setCubosIds, (l) => (l.includes(c.id) ? l : [...l, c.id]));
    setEscolherCubo(false);
  };

  const usoDoCubo = (cuboId: number) => visuais.filter((v) => v.consultaId === cuboId).length + filtrosTopo.filter((f) => f.cuboId === cuboId).length;

  const removerCubo = (cuboId: number) => {
    mudarModelo(setCubosIds, (l) => l.filter((x) => x !== cuboId));
    mudarModelo(setLigacoes, (l) => ({
      manuais: l.manuais.filter((m) => m.a.cuboId !== cuboId && m.b.cuboId !== cuboId),
      desligadas: l.desligadas.filter((d) => !d.includes(cuboId)),
    }));
  };

  const desligar = (a: number, b: number) =>
    mudarModelo(setLigacoes, (l) => ({
      manuais: l.manuais.filter((m) => !mesmoPar(m.a.cuboId, m.b.cuboId, a, b)),
      desligadas: [...l.desligadas.filter((d) => !mesmoPar(d[0], d[1], a, b)), [a, b] as [number, number]],
    }));

  const ligar = (pa: Ponta, pb: Ponta) => {
    mudarModelo(setLigacoes, (l) => ({
      manuais: [...l.manuais.filter((m) => !mesmoPar(m.a.cuboId, m.b.cuboId, pa.cuboId, pb.cuboId)), { a: pa, b: pb }],
      desligadas: l.desligadas.filter((d) => !mesmoPar(d[0], d[1], pa.cuboId, pb.cuboId)),
    }));
    setLigando(null);
  };

  const voltarAutomatica = (a: number, b: number) =>
    mudarModelo(setLigacoes, (l) => ({
      manuais: l.manuais.filter((m) => !mesmoPar(m.a.cuboId, m.b.cuboId, a, b)),
      desligadas: l.desligadas.filter((d) => !mesmoPar(d[0], d[1], a, b)),
    }));

  const aoTeclar = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      pedirIa();
    }
  };

  /** Salva e devolve o id (para "Visualizar" logo em seguida). */
  const salvar = async (): Promise<number | null> => {
    if (!modelo) return null;
    setSalvando(true);
    setErro(null);
    try {
      const corpo = { nome: nome.trim() || `Análise de ${modelo.cubos[0]?.nome}`, ...definicao(visuais) };
      if (nova) {
        const r = await api.post('/analises', corpo);
        setAlterado(false);
        avisar('Análise salva em Minhas análises.');
        navigate(`/analises/${r.data.id}`, { replace: true });
        return r.data.id;
      }
      await api.put(`/analises/${id}`, corpo);
      setAlterado(false);
      avisar('Análise salva.');
      return Number(id);
    } catch (e) {
      setErro(mensagemDeErro(e));
      return null;
    } finally {
      setSalvando(false);
    }
  };

  const visualizar = async () => {
    const alvo = nova || alterado ? await salvar() : Number(id);
    if (alvo) navigate(`/analises/${alvo}/ver`);
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

  const layout: Layout[] = useMemo(
    () => visuais.map((v) => ({ i: v.chave, ...v.layout, minW: v.tipo === 'kpi' ? 2 : v.tipo === 'imagem' ? 1 : 3, minH: v.tipo === 'imagem' ? 1 : 2 })),
    [visuais],
  );

  const consultas: ConsultaResumo[] = useMemo(
    () => (modelo ? modelo.cubos.map((c) => ({ id: c.id, nome: c.nome, descricao: c.descricao, colunas: c.colunas, parametros: [] })) : []),
    [modelo],
  );

  /** Prévia de um visual (editor manual) com os filtros escolhidos na análise. */
  const buscarPrevia = useCallback(
    async (v: { tipo: string; titulo: string; config: Record<string, any>; layout: any; consultaId?: number }) => {
      const r = await api.post('/analises/dados', definicao([v as VisualMontagem]));
      return { dados: r.data.visuais[0]?.dados, erro: r.data.visuais[0]?.erro };
    },
    [definicao],
  );

  if (erro && !modelo) {
    return (
      <>
        <CAlert color="danger">{erro}</CAlert>
        <Link to="/analises">Voltar para Minhas análises</Link>
      </>
    );
  }
  if (!modelo) {
    return (
      <div className="py-5 text-center">
        <CSpinner color="primary" />
      </div>
    );
  }

  const cubos = modelo.cubos;
  const variosCubos = cubos.length > 1;
  const nomeCubo = (cuboId: number) => cubos.find((c) => c.id === cuboId)?.nome ?? '';
  const colunaRotulo = (p: Ponta) => {
    const c = cubos.find((x) => x.id === p.cuboId)?.colunas.find((x) => x.nome === p.coluna);
    return c ? rotulo(c) : p.coluna;
  };
  const fundo = visuais.reduce((m, v) => Math.max(m, v.layout.y + v.layout.h), 0);
  const ideias = sugestoes(cubos[0]?.colunas ?? []);
  const pares = cubos.flatMap((a, i) => cubos.slice(i + 1).map((b) => [a, b] as const));

  return (
    <>
      <CBreadcrumb className="mb-2">
        <CBreadcrumbItem>
          <Link to="/analises">Minhas análises</Link>
        </CBreadcrumbItem>
        <CBreadcrumbItem active>{nova ? 'Nova análise' : nome}</CBreadcrumbItem>
      </CBreadcrumb>
      <div className="analise-cabecalho">
        <CFormInput
          className="analise-nome"
          aria-label="Nome da análise"
          value={nome}
          maxLength={120}
          onChange={(e) => {
            setNome(e.target.value);
            setAlterado(true);
          }}
        />
        <div className="d-flex align-items-center flex-wrap gap-2">
          {alterado && <span className="barra-acoes-aviso">Alterações não salvas</span>}
          {!nova && (
            <CButton color="danger" variant="ghost" onClick={() => setExcluindo(true)}>
              Excluir
            </CButton>
          )}
          {(
            <CButton
              color="secondary"
              variant="outline"
              disabled={nova}
              title={nova ? 'Salve a análise antes de publicar' : 'Mostrar esta análise como painel no menu, só para você ou para todos com acesso ao local'}
              onClick={() => setPublicando(true)}
            >
              <CIcon icon={cilShareBoxed} className="me-1" />
              {painel ? (painel.visibilidade === 'subgrupo' ? 'Publicado no menu' : 'No meu menu') : 'Publicar como painel'}
            </CButton>
          )}
          <CButton color="secondary" variant="outline" disabled={!visuais.length || salvando} onClick={visualizar} title="Ver só os gráficos, com os filtros no topo e tela cheia">
            <CIcon icon={cilScreenDesktop} className="me-1" />
            {nova || alterado ? 'Salvar e visualizar' : 'Visualizar'}
          </CButton>
          <CLoadingButton color="primary" loading={salvando} disabled={!alterado && !nova} onClick={salvar}>
            {nova ? 'Salvar análise' : 'Salvar'}
          </CLoadingButton>
        </div>
      </div>
      {erro && <CAlert color="danger">{erro}</CAlert>}

      <div className="analise-layout">
        <aside className="analise-lateral" aria-label="Dados e pedidos à IA">
          <section className="analise-cubo">
            <div className="analise-cubos-titulo">
              <h2>{variosCubos ? 'Dados da análise' : cubos[0]?.nome}</h2>
              <CButton color="secondary" variant="ghost" size="sm" onClick={abrirCubos} disabled={cubos.length >= MAX_CUBOS} title="Juntar outro cubo a esta análise">
                <CIcon icon={cilPlus} className="me-1" />
                Cubo
              </CButton>
            </div>
            {!variosCubos && cubos[0]?.descricao && <p>{cubos[0].descricao}</p>}
            {cubos.map((cubo, i) => (
              <details key={cubo.id} className="analise-cubo-bloco" open={i === 0 || cubos.length <= 2}>
                <summary>
                  {variosCubos ? (
                    <>
                      <span className="analise-cubo-nome">{cubo.nome}</span>
                      {i > 0 && (
                        <button
                          type="button"
                          className="analise-cubo-remover"
                          aria-label={`Tirar ${cubo.nome} da análise`}
                          title={usoDoCubo(cubo.id) ? 'Há visuais ou filtros usando este cubo' : `Tirar ${cubo.nome} da análise`}
                          disabled={usoDoCubo(cubo.id) > 0}
                          onClick={(e) => {
                            e.preventDefault();
                            removerCubo(cubo.id);
                          }}
                        >
                          <CIcon icon={cilX} size="sm" />
                        </button>
                      )}
                    </>
                  ) : (
                    <span className="analise-cubo-nome">Colunas disponíveis</span>
                  )}
                </summary>
                <ul className="analise-colunas">
                  {cubo.colunas.map((c) => (
                    <li key={c.nome}>
                      <button
                        type="button"
                        title={`${rotulo(c)} · coluna ${c.nome} (clique para usar no pedido)`}
                        onClick={() => {
                          setPedido((p) => (p ? `${p.replace(/\s*$/, '')} ${rotulo(c)}` : rotulo(c)));
                          campoPedido.current?.focus();
                        }}
                      >
                        <span className={`analise-tipo tipo-${c.tipo}`} aria-label={c.tipo === 'numero' ? 'número' : c.tipo}>
                          {c.tipo === 'data' ? <CIcon icon={cilCalendar} size="sm" /> : MARCA_TIPO[c.tipo]}
                        </span>
                        <span className="analise-coluna-titulo">{rotulo(c)}</span>
                        {c.descricao?.trim() && <span className="analise-coluna-tecnico">{c.nome}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            ))}

            {variosCubos && (
              <div className="analise-ligacoes">
                <h3>Ligações</h3>
                <ul>
                  {pares.map(([a, b]) => {
                    const l = modelo.ligacoes.find((x) => mesmoPar(x.a.cuboId, x.b.cuboId, a.id, b.id));
                    const desligada = ligacoes.desligadas.some((d) => mesmoPar(d[0], d[1], a.id, b.id));
                    const comuns = colunasEmComum(a, b);
                    if (l) {
                      return (
                        <li key={`${a.id}-${b.id}`} className="ligacao-ativa">
                          <CIcon icon={cilLink} size="sm" className="ligacao-icone" />
                          <span className="ligacao-texto">
                            {nomeCubo(l.a.cuboId)}.<strong>{colunaRotulo(l.a)}</strong> = {nomeCubo(l.b.cuboId)}.<strong>{colunaRotulo(l.b)}</strong>
                            <span className="ligacao-origem">{l.origem === 'auto' ? 'automática' : 'escolhida por você'}</span>
                          </span>
                          <span className="ligacao-acoes">
                            <button type="button" onClick={() => setLigando({ a: l.a, b: l.b })}>
                              Trocar
                            </button>
                            {l.origem === 'manual' && comuns.length > 0 && (
                              <button type="button" onClick={() => voltarAutomatica(a.id, b.id)}>
                                Automática
                              </button>
                            )}
                            <button type="button" onClick={() => desligar(a.id, b.id)}>
                              Desligar
                            </button>
                          </span>
                        </li>
                      );
                    }
                    return (
                      <li key={`${a.id}-${b.id}`} className="ligacao-sem">
                        <CIcon icon={cilLinkBroken} size="sm" className="ligacao-icone" />
                        <span className="ligacao-texto">
                          {a.nome} e {b.nome} {desligada ? 'desligados por você' : 'sem coluna em comum'}
                          <span className="ligacao-origem">os filtros de um não chegam ao outro</span>
                        </span>
                        <span className="ligacao-acoes">
                          {desligada && comuns.length > 0 && (
                            <button type="button" onClick={() => voltarAutomatica(a.id, b.id)}>
                              Religar
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setLigando({ a: { cuboId: a.id, coluna: a.colunas[0]?.nome ?? '' }, b: { cuboId: b.id, coluna: b.colunas[0]?.nome ?? '' } })}
                          >
                            Ligar
                          </button>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </section>

          <section className="analise-ia">
            <h3>Pedir à IA</h3>
            {modelo.iaDisponivel && <p className="analise-ia-nota">A IA vê só os nomes das colunas; os números são calculados aqui.</p>}
            {!modelo.iaDisponivel ? (
              <p className="small text-body-secondary mb-0">
                A IA não está configurada neste servidor. Você ainda pode montar os visuais pelo botão "Adicionar visual".
              </p>
            ) : (
              <>
                {conversa.length > 0 && (
                  <ol className="analise-conversa" aria-live="polite">
                    {conversa.map((c, i) => (
                      <li key={i}>
                        <p className="analise-pedido">{c.pedido}</p>
                        {c.erro ? (
                          <>
                            <p className="analise-resposta erro">{c.erro}</p>
                            {c.detalhe && (
                              <p className="analise-detalhe">
                                Resposta do serviço: <code className="erro-ia-detalhe">{c.detalhe}</code>
                              </p>
                            )}
                          </>
                        ) : c.mensagem !== undefined ? (
                          <>
                            <p className="analise-resposta">{c.mensagem || 'Pronto.'}</p>
                            {c.avisos?.map((a) => (
                              <p key={a} className="analise-aviso">
                                {a}
                              </p>
                            ))}
                          </>
                        ) : (
                          <p className="analise-resposta pensando">
                            <CSpinner size="sm" className="me-2" />
                            Montando…
                          </p>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
                <CFormTextarea
                  ref={campoPedido}
                  rows={3}
                  aria-label="O que você quer ver?"
                  placeholder={visuais.length ? 'Peça mudanças: "troque a pizza por barras", "adicione filtro de mês"…' : 'O que você quer ver? Ex.: faturamento por mês e por filial'}
                  value={pedido}
                  maxLength={2000}
                  onChange={(e) => setPedido(e.target.value)}
                  onKeyDown={aoTeclar}
                  disabled={pensando}
                />
                <div className="analise-ia-acoes">
                  <span className="small text-body-secondary">Enter envia · Shift+Enter quebra linha</span>
                  <CLoadingButton color="primary" size="sm" loading={pensando} disabled={!pedido.trim()} onClick={() => pedirIa()}>
                    <CIcon icon={cilSend} className="me-1" />
                    Gerar
                  </CLoadingButton>
                </div>
                {!visuais.length && !conversa.length && ideias.length > 0 && (
                  <div className="analise-ideias">
                    <span className="small text-body-secondary">Ideias:</span>
                    {ideias.map((s) => (
                      <button key={s} type="button" onClick={() => pedirIa(s)}>
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </section>
        </aside>

        <div className="analise-principal">
          <div className="analise-topo">
            {modelo.filtros.length > 0 ? (
              <BarraFiltros
                filtros={modelo.filtros}
                valores={valores}
                onChange={(v) => {
                  setValores(v);
                  setAlterado(true);
                }}
                atualizando={carregando && visuais.length > 0}
              />
            ) : (
              <p className="analise-topo-vazio">Sem filtros no topo. Com eles, trocar o mês ou a filial muda todos os visuais de uma vez.</p>
            )}
            <CButton color="secondary" variant="outline" size="sm" className="analise-topo-botao" onClick={() => setEditandoFiltros(true)}>
              <CIcon icon={cilFilter} className="me-1" />
              {filtrosTopo.length ? 'Filtros' : 'Adicionar filtro'}
            </CButton>
          </div>
          {visuais.length === 0 ? (
            <div className="analise-vazia">
              <h2>Comece pelo pedido à IA</h2>
              <p>
                Descreva ao lado o que você quer ver usando as colunas do cubo, ou parta de um painel pronto e peça os ajustes. Os gráficos aparecem aqui, e você
                pode arrastar, redimensionar e ajustar cada um.
              </p>
              <div className="d-flex flex-wrap justify-content-center gap-2">
                <CButton color="primary" variant="outline" onClick={abrirPaineis}>
                  <CIcon icon={cilSpeedometer} className="me-1" />
                  Começar a partir de um painel
                </CButton>
                <CButton color="secondary" variant="outline" onClick={() => setEditando({ ...novoVisual(cubos[0], fundo) })}>
                  <CIcon icon={cilPlus} className="me-1" />
                  Adicionar visual manualmente
                </CButton>
                <CButton color="secondary" variant="outline" onClick={() => setIncluindo(true)}>
                  <CIcon icon={cilCopy} className="me-1" />
                  Incluir existente
                </CButton>
              </div>
            </div>
          ) : estreita ? (
            <GradeVisuais
              itens={visuais.map((v) => ({
                chave: v.chave,
                layout: v.layout,
                visual: { tipo: v.tipo, titulo: v.titulo, config: v.config, dados: resultado[v.chave]?.dados, erro: resultado[v.chave]?.erro },
              }))}
            />
          ) : (
            <>
              <div className="montador-grade analise-grade">
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
                        {variosCubos && <span className="montador-cubo" title={`Dados de ${nomeCubo(v.consultaId)}`}>{nomeCubo(v.consultaId)}</span>}
                        <button type="button" className="montador-arrastar" title="Arrastar para mover" aria-label={`Mover ${v.titulo}`}>
                          <CIcon icon={cilMove} />
                        </button>
                        <button type="button" title="Configurar" aria-label={`Configurar ${v.titulo}`} onClick={() => setEditando(v)}>
                          <CIcon icon={cilPencil} />
                        </button>
                        {v.tipo !== 'imagem' && <button
                          type="button"
                          title="Filtros só deste visual"
                          aria-label={`Filtros de ${v.titulo}`}
                          className={v.config.filtrosVisual?.length ? 'com-filtro' : undefined}
                          onClick={() => setFiltrando(v)}
                        >
                          <CIcon icon={cilFilter} />
                          {v.config.filtrosVisual?.length > 0 && <span className="montador-contagem">{v.config.filtrosVisual.length}</span>}
                        </button>}
                        <button type="button" title="Remover" aria-label={`Remover ${v.titulo}`} onClick={() => alterar((a) => a.filter((x) => x.chave !== v.chave))}>
                          <CIcon icon={cilTrash} />
                        </button>
                      </div>
                      <Visual tipo={v.tipo} titulo={v.titulo} config={v.config} dados={resultado[v.chave]?.dados} erro={resultado[v.chave]?.erro} />
                    </div>
                  ))}
                </Grade>
              </div>
              <div className="mt-3 d-flex flex-wrap gap-2">
                <CButton color="secondary" variant="outline" size="sm" onClick={() => setEditando(novoVisual(cubos[0], fundo))}>
                  <CIcon icon={cilPlus} className="me-1" />
                  Adicionar visual manualmente
                </CButton>
                <CButton color="secondary" variant="outline" size="sm" onClick={() => setIncluindo(true)}>
                  <CIcon icon={cilCopy} className="me-1" />
                  Incluir existente
                </CButton>
                <CButton color="secondary" variant="outline" size="sm" onClick={abrirPaineis}>
                  <CIcon icon={cilSpeedometer} className="me-1" />
                  Trazer visuais de um painel
                </CButton>
              </div>
            </>
          )}
        </div>
      </div>

      {editando && (
        <EditorVisual
          inicial={editando}
          consultas={consultas}
          rotuloOrigem="Cubo"
          novo={!visuais.some((v) => v.chave === editando.chave)}
          buscarPrevia={buscarPrevia}
          onFechar={() => setEditando(null)}
          onAplicar={(v) => {
            alterar((a) => (a.some((x) => x.chave === v.chave) ? a.map((x) => (x.chave === v.chave ? v : x)) : [...a, v]));
            setEditando(null);
          }}
        />
      )}
      {incluindo && (
        <IncluirExistente<ObjetoAnalise>
          destino={{ no: 'na análise', neste: 'nesta análise' }}
          tipos={TIPOS}
          buscar={async (texto, tipo) => {
            const r = await api.get('/analises/objetos', { params: { busca: texto, tipo: tipo || undefined, analiseId: id } });
            return r.data.map((o: any) => ({
              ...o,
              origem: String(o.analiseId) === id ? `${o.analiseNome} (esta análise)` : o.analiseNome,
              detalhe: o.tipo === 'imagem' ? 'Imagem' : o.cuboNome,
            }));
          }}
          previa={async (o) => {
            // Calcula no cubo de origem, sem os filtros do topo desta análise
            const cuboId = o.tipo === 'imagem' ? cubos[0].id : o.cuboId;
            const r = await api.post('/analises/dados', { cubos: [cuboId], visuais: [{ cuboId, tipo: o.tipo, titulo: o.titulo, config: o.config, layout: { x: 0, y: 0, w: 6, h: 4 } }] });
            return { dados: r.data.visuais[0]?.dados, erro: r.data.visuais[0]?.erro };
          }}
          extra={(o) =>
            o.tipo !== 'imagem' && !cubosIds.includes(o.cuboId) ? (
              <div className="form-text mt-2">O cubo "{o.cuboNome}" entra também nesta análise. Confira as ligações e os filtros do topo depois de incluir.</div>
            ) : null
          }
          onFechar={() => setIncluindo(false)}
          onIncluir={(o, titulo) => {
            const t = TIPOS.find((x) => x.tipo === o.tipo)!;
            const cuboId = o.tipo === 'imagem' ? (cubosIds.includes(o.cuboId) ? o.cuboId : cubos[0].id) : o.cuboId;
            if (!cubosIds.includes(cuboId)) mudarModelo(setCubosIds, (l) => (l.includes(cuboId) ? l : [...l, cuboId]));
            const tamanho = o.layout ? { w: Math.min(12, o.layout.w), h: o.layout.h } : t.tamanho;
            alterar((a) => [...a, { chave: novaChave(), tipo: o.tipo, titulo, consultaId: cuboId, config: structuredClone(o.config), layout: { x: 0, y: fundo, ...tamanho } }]);
            setIncluindo(false);
            avisar(`"${titulo}" incluído na análise.`);
          }}
        />
      )}
      {filtrando && (
        <EditorFiltrosVisual
          visual={filtrando}
          colunas={cubos.find((c) => c.id === filtrando.consultaId)?.colunas ?? []}
          podeExec={false}
          buscarPrevia={buscarPrevia}
          onFechar={() => setFiltrando(null)}
          onAplicar={(f) => {
            alterar((a) => a.map((x) => (x.chave === filtrando.chave ? { ...x, config: { ...x.config, filtrosVisual: f } } : x)));
            setFiltrando(null);
          }}
        />
      )}
      {editandoFiltros && (
        <EditorFiltrosTopo
          filtros={filtrosTopo}
          cubos={cubos}
          ligacoes={modelo.ligacoes}
          onFechar={() => setEditandoFiltros(false)}
          onAplicar={(f) => {
            mudarModelo(setFiltrosTopo, () => f);
            setEditandoFiltros(false);
          }}
        />
      )}
      {ligando && <ModalLigacao cubos={cubos} inicial={ligando} onFechar={() => setLigando(null)} onAplicar={ligar} />}
      {publicando && !nova && (
        <ModalPublicar
          analiseId={Number(id)}
          nomeAnalise={nome}
          painel={painel}
          alterada={alterado}
          onFechar={() => setPublicando(false)}
          onMudou={(p) => {
            setPainel(p);
            setPublicando(false);
          }}
        />
      )}

      <CModal visible={escolherCubo} onClose={() => setEscolherCubo(false)} alignment="center" size="lg" scrollable>
        <CModalHeader>
          <CModalTitle>Juntar outro cubo</CModalTitle>
        </CModalHeader>
        <CModalBody>
          {!cubosLiberados ? (
            <div className="py-4 text-center">
              <CSpinner color="primary" />
            </div>
          ) : (
            (() => {
              const outros = cubosLiberados.filter((c) => !cubosIds.includes(c.id));
              if (!outros.length) return <p className="lista-vazia mb-0">Todos os cubos liberados para você já estão nesta análise.</p>;
              return (
                <>
                  <p className="small text-body-secondary">
                    Cada visual usa os dados de um cubo. Cubos com uma coluna em comum (como o código do veículo) ficam ligados, e os filtros do topo valem para os
                    dois.
                  </p>
                  <div className="cubos-escolha">
                    {outros.map((c) => {
                      const ligaCom = cubos
                        .map((x) => ({ cubo: x, comuns: colunasEmComum(c, x) }))
                        .filter((x) => x.comuns.length);
                      return (
                        <button key={c.id} type="button" onClick={() => adicionarCubo(c)}>
                          <strong>{c.nome}</strong>
                          {c.descricao && <span className="cubos-desc">{c.descricao}</span>}
                          <span className={`cubos-ligacao${ligaCom.length ? '' : ' sem'}`}>
                            <CIcon icon={ligaCom.length ? cilLink : cilLinkBroken} size="sm" className="me-1" />
                            {ligaCom.length
                              ? `Liga com ${ligaCom.map((x) => `${x.cubo.nome} por ${x.comuns[0]}`).join(' e ')}`
                              : 'Sem coluna em comum: dá para ligar à mão depois'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </>
              );
            })()
          )}
        </CModalBody>
      </CModal>

      <CModal visible={escolherPainel} onClose={() => setEscolherPainel(false)} alignment="center" size="lg" scrollable>
        <CModalHeader>
          <CModalTitle>Começar a partir de um painel</CModalTitle>
        </CModalHeader>
        <CModalBody>
          {!paineis ? (
            <div className="py-4 text-center">
              <CSpinner color="primary" />
            </div>
          ) : paineis.length === 0 ? (
            <p className="lista-vazia mb-0">Nenhum painel que você acessa usa os dados {variosCubos ? 'destes cubos' : 'deste cubo'}.</p>
          ) : (
            <>
              <p className="small text-body-secondary">
                Os visuais do painel são copiados para a sua análise; o painel original não muda. A IA também conhece estes painéis: você pode pedir "igual ao painel X, mas por cliente".
              </p>
              <div className="cubos-escolha">
                {paineis.map((p) => (
                  <button key={`${p.id}-${p.cuboId}`} type="button" onClick={() => usarPainel(p)}>
                    <strong>
                      {p.nome}
                      {variosCubos && <span className="cubos-desc"> · dados de {nomeCubo(p.cuboId)}</span>}
                    </strong>
                    {p.descricao && <span className="cubos-desc">{p.descricao}</span>}
                    <span className="cubos-colunas">
                      {p.visuais.map((v) => v.titulo).join(' · ')}
                      {p.foraDoCubo > 0 && ` · e mais ${p.foraDoCubo} que não usam este cubo`}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </CModalBody>
      </CModal>

      <CModal visible={excluindo} onClose={() => setExcluindo(false)} alignment="center">
        <CModalHeader>
          <CModalTitle>Excluir análise?</CModalTitle>
        </CModalHeader>
        <CModalBody>
          A análise <strong>{nome}</strong> será excluída. Os dados dos cubos não são afetados.
          {painel && <p className="mt-2 mb-0 text-danger">Ela está publicada como o painel "{painel.nome}": tire do menu antes de excluir.</p>}
        </CModalBody>
        <CModalFooter>
          <CButton color="secondary" variant="ghost" onClick={() => setExcluindo(false)}>
            Cancelar
          </CButton>
          <CButton
            color="danger"
            onClick={async () => {
              try {
                await api.delete(`/analises/${id}`);
                setAlterado(false);
                avisar('Análise excluída.');
                navigate('/analises');
              } catch (e) {
                setExcluindo(false);
                setErro(mensagemDeErro(e));
              }
            }}
          >
            Excluir análise
          </CButton>
        </CModalFooter>
      </CModal>
    </>
  );
}

function novoVisual(cubo: CuboInfo, y: number): VisualMontagem {
  const t = TIPOS.find((x) => x.tipo === 'barra')!;
  const c = { id: cubo.id, nome: cubo.nome, descricao: cubo.descricao, colunas: cubo.colunas, parametros: [] };
  return { chave: novaChave(), tipo: 'barra', titulo: '', consultaId: cubo.id, config: configPadrao('barra', c), layout: { x: 0, y, ...t.tamanho } };
}

/** O que vai para a API: sem a chave local; consultaId aqui é o id do cubo do visual (o servidor confere). */
function corpoVisuais(visuais: VisualMontagem[]) {
  return visuais.map(({ tipo, titulo, config, layout, consultaId }) => ({ cuboId: consultaId, tipo, titulo: titulo || 'Visual', config, layout }));
}
