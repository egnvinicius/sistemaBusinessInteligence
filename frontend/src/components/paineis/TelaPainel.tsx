import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { CButton } from '@coreui/react-pro';
import CIcon from '@coreui/icons-react';
import { cilFullscreen, cilFullscreenExit, cilReload } from '@coreui/icons';
import { mensagemDeErro } from '../../api/client';
import { useTema } from '../../contexts/TemaContext';
import { BarraFiltros, valoresIniciais, type FiltroPainel, type ValoresFiltros } from './BarraFiltros';
import { GradeVisuais } from './GradeVisuais';
import type { DadosVisual, TipoVisual } from './Visual';

export interface VisualDefinido {
  id: number;
  tipo: TipoVisual;
  titulo: string;
  config: Record<string, any>;
  layout: { x: number; y: number; w: number; h: number };
}

export interface DefinicaoTela {
  fundoClaro?: string | null;
  fundoEscuro?: string | null;
  filtros: FiltroPainel[];
  visuais: VisualDefinido[];
}

type Resultado = Record<number, { dados?: DadosVisual; erro?: string }>;

const hora = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });

interface Props {
  titulo: string;
  descricao?: string | null;
  /** Breadcrumb ou outro conteúdo acima do título */
  antes?: ReactNode;
  /** Botões extras no cabeçalho (Montar, Editar…) */
  acoes?: ReactNode;
  def: DefinicaoTela;
  carregarDados: (valores: ValoresFiltros, automatico?: boolean) => Promise<{ id: number; dados?: DadosVisual; erro?: string }[]>;
  /** O que mostrar quando não há visuais */
  vazio: ReactNode;
}

/**
 * Tela de leitura de um painel (ou de uma análise): filtros no topo, visuais em grade,
 * recarregar e tela cheia. Em tela cheia (torres de controle), atualiza sozinha a cada 5 minutos.
 */
export function TelaPainel({ titulo, descricao, antes, acoes, def, carregarDados, vazio }: Props) {
  const [valores, setValores] = useState<ValoresFiltros>(() => valoresIniciais(def.filtros));
  const [resultado, setResultado] = useState<Resultado>({});
  const [carregando, setCarregando] = useState(false);
  const [atualizadoEm, setAtualizadoEm] = useState<Date | null>(null);
  const pedido = useRef(0);
  const valoresRef = useRef<ValoresFiltros>(valores);
  const { tema } = useTema();
  const tela = useRef<HTMLDivElement>(null);
  const [telaCheia, setTelaCheia] = useState(false);

  useEffect(() => {
    const aoMudar = () => setTelaCheia(document.fullscreenElement === tela.current && !!tela.current);
    document.addEventListener('fullscreenchange', aoMudar);
    return () => document.removeEventListener('fullscreenchange', aoMudar);
  }, []);

  const alternarTelaCheia = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    else tela.current?.requestFullscreen().catch(() => undefined);
  };

  const carregar = useCallback(
    async (v: ValoresFiltros, automatico = false) => {
      if (!def.visuais.length) return;
      const n = ++pedido.current;
      setCarregando(true);
      try {
        const r = await carregarDados(v, automatico);
        if (n !== pedido.current) return; // chegou uma resposta mais nova
        setResultado(Object.fromEntries(r.map((x) => [x.id, { dados: x.dados, erro: x.erro }])));
        setAtualizadoEm(new Date());
      } catch (e) {
        if (n !== pedido.current) return;
        const msg = mensagemDeErro(e);
        setResultado(Object.fromEntries(def.visuais.map((x) => [x.id, { erro: msg }])));
      } finally {
        if (n === pedido.current) setCarregando(false);
      }
    },
    [def, carregarDados],
  );

  valoresRef.current = valores;

  // Filtros mudaram: espera um instante (várias marcações seguidas) e atualiza
  useEffect(() => {
    const t = window.setTimeout(() => carregar(valores), Object.keys(resultado).length ? 450 : 0);
    return () => window.clearTimeout(t);
  }, [valores, def]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!telaCheia) return;
    const t = window.setInterval(() => carregar(valoresRef.current, true), 5 * 60_000);
    return () => window.clearInterval(t);
  }, [telaCheia, carregar]);

  const fundo = tema === 'escuro' ? def.fundoEscuro : def.fundoClaro;

  return (
    <>
      {antes}
      <div className="pagina-cabecalho painel-cabecalho">
        <div>
          <h1 className="pagina-titulo">{titulo}</h1>
          {descricao && <p className="pagina-descricao">{descricao}</p>}
        </div>
        <div className="painel-cabecalho-acoes">
          {atualizadoEm && <span className="painel-atualizado">Dados das {hora.format(atualizadoEm)}</span>}
          {def.visuais.length > 0 && (
            <CButton color="secondary" variant="ghost" size="sm" onClick={() => carregar(valores)} disabled={carregando} title="Recarregar os dados">
              <CIcon icon={cilReload} />
              <span className="visually-hidden">Recarregar</span>
            </CButton>
          )}
          {def.visuais.length > 0 && (
            <CButton color="secondary" variant="outline" size="sm" onClick={alternarTelaCheia} title="Mostrar só o painel, em tela cheia (Esc para sair)">
              <CIcon icon={cilFullscreen} className="me-1" />
              Tela cheia
            </CButton>
          )}
          {acoes}
        </div>
      </div>

      {def.visuais.length === 0 ? (
        vazio
      ) : (
        <div ref={tela} className={`painel-tela${fundo ? ' com-fundo' : ''}`} style={fundo ? ({ '--painel-fundo': fundo } as CSSProperties) : undefined}>
          <div className="painel-tela-titulo">
            <h2>{titulo}</h2>
            <div className="d-flex align-items-center gap-3">
              {atualizadoEm && <span>Dados das {hora.format(atualizadoEm)} · atualiza a cada 5 min</span>}
              <CButton color="secondary" variant="outline" size="sm" onClick={alternarTelaCheia}>
                <CIcon icon={cilFullscreenExit} className="me-1" />
                Sair da tela cheia
              </CButton>
            </div>
          </div>
          <BarraFiltros filtros={def.filtros} valores={valores} onChange={setValores} atualizando={carregando && Object.keys(resultado).length > 0} />
          <GradeVisuais
            itens={def.visuais.map((v) => ({
              chave: String(v.id),
              layout: v.layout,
              visual: { tipo: v.tipo, titulo: v.titulo, config: v.config, dados: resultado[v.id]?.dados, erro: resultado[v.id]?.erro },
            }))}
          />
        </div>
      )}
    </>
  );
}
