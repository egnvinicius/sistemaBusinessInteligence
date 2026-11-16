import { Component, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Chart, type ChartConfiguration } from 'chart.js';
import CIcon from '@coreui/icons-react';
import { cilArrowBottom, cilArrowTop, cilChartLine, cilFilter, cilList } from '@coreui/icons';
import { useTema } from '../../contexts/TemaContext';
import { textoSobre } from '../../lib/cores';
import { iconeIndicador } from '../../lib/iconesPainel';
import { descreverFiltros } from '../../lib/filtrosVisual';
import { formatar, formatarCurto, paletaDoTema, rotuloCategoria, rotuloColuna, type Formato, type PaletaGrafico } from '../../lib/graficos';

/* ---------- Tipos compartilhados ---------- */

export type TipoVisual = 'kpi' | 'barra' | 'linha' | 'pizza' | 'tabela';

export interface DadosKpi {
  valor: number | null;
  meta: number | null;
  percentualMeta: number | null;
  linhas: number;
  aviso: string | null;
}
export interface DadosSeries {
  categorias: string[];
  series: { nome: string; valores: (number | null)[] }[];
  omitidas: number;
  aviso: string | null;
}
export interface DadosPizza {
  fatias: { nome: string; valor: number }[];
  aviso: string | null;
}
export interface EstiloDestaque {
  fundo?: string;
  fonte?: string;
  piscar?: boolean;
  legenda?: string;
}
export interface DadosTabela {
  colunas: { nome: string; tipo: 'numero' | 'texto' | 'data' }[];
  linhas: unknown[][];
  /** Destaques por linha (mesma ordem de `linhas`) */
  estilos?: ({ linha?: EstiloDestaque; marcador?: EstiloDestaque; celulas?: Record<number, EstiloDestaque> } | null)[];
  marcador?: boolean;
  total: number;
  aviso: string | null;
}
export type DadosVisual = DadosKpi | DadosSeries | DadosPizza | DadosTabela;

export interface DefinicaoVisual {
  tipo: TipoVisual;
  titulo: string;
  config: Record<string, any>;
}

interface Props extends DefinicaoVisual {
  dados?: DadosVisual;
  erro?: string | null;
  carregando?: boolean;
}

/** Um visual do painel: indicador, gráfico ou tabela, com estados de carga e erro. */
export function Visual(props: Props) {
  // Um erro ao desenhar um visual fica só nele, sem derrubar a tela
  return (
    <ProtecaoVisual chave={`${props.tipo}|${JSON.stringify(props.config)}`} titulo={props.titulo}>
      <VisualInterno {...props} dados={props.dados && dadosDoTipo(props.tipo, props.dados) ? props.dados : undefined} />
    </ProtecaoVisual>
  );
}

/** Confere se os dados têm o formato do tipo (ex.: ao trocar Barras por Pizza, a resposta antiga ainda é de barras). */
export function dadosDoTipo(tipo: TipoVisual, d: unknown): boolean {
  if (!d || typeof d !== 'object') return false;
  const x = d as Record<string, unknown>;
  switch (tipo) {
    case 'kpi':
      return 'valor' in x && 'linhas' in x;
    case 'barra':
    case 'linha':
      return Array.isArray(x.categorias) && Array.isArray(x.series);
    case 'pizza':
      return Array.isArray(x.fatias);
    case 'tabela':
      return Array.isArray(x.colunas) && Array.isArray(x.linhas);
  }
}

class ProtecaoVisual extends Component<{ chave: string; titulo: string; children: ReactNode }, { falhou: boolean; chave: string }> {
  state = { falhou: false, chave: this.props.chave };
  static getDerivedStateFromError() {
    return { falhou: true };
  }
  static getDerivedStateFromProps(p: { chave: string }, s: { falhou: boolean; chave: string }) {
    // Mudou a configuração: tenta desenhar de novo
    return p.chave !== s.chave ? { falhou: false, chave: p.chave } : null;
  }
  componentDidCatch(e: unknown) {
    console.warn('Falha ao desenhar o visual', this.props.titulo, e);
  }
  render() {
    if (!this.state.falhou) return this.props.children;
    return (
      <section className="visual" aria-label={this.props.titulo}>
        <header className="visual-cabeca">
          <h2 className="visual-titulo">{this.props.titulo}</h2>
        </header>
        <div className="visual-corpo">
          <div className="visual-estado visual-erro">Não foi possível desenhar este visual. Revise a configuração dele.</div>
        </div>
      </section>
    );
  }
}

function VisualInterno({ tipo, titulo, config, dados, erro, carregando }: Props) {
  const { tema } = useTema();
  const paleta = paletaDoTema(tema);
  const [verTabela, setVerTabela] = useState(false);
  const formato = (config.formato ?? 'numero') as Formato;
  const temGrafico = tipo === 'barra' || tipo === 'linha' || tipo === 'pizza';
  const vazio = dados && estaVazio(tipo, dados);

  return (
    <section className={`visual visual--${tipo}`} aria-label={titulo}>
      <header className="visual-cabeca">
        <h2
          className="visual-titulo"
          style={{ ...(config.tituloCor ? { color: config.tituloCor } : {}), ...(config.tituloTamanho ? { fontSize: `${config.tituloTamanho}px` } : {}) }}
        >
          {titulo}
        </h2>
        {config.filtrosVisual?.length > 0 && (
          <span className="visual-filtrado" title={`Filtrado: ${descreverFiltros(config.filtrosVisual, config.rotulos)}`}>
            <CIcon icon={cilFilter} size="sm" />
            <span className="visually-hidden">Filtrado: {descreverFiltros(config.filtrosVisual, config.rotulos)}</span>
          </span>
        )}
        {temGrafico && dados && !vazio && (
          <button
            type="button"
            className="visual-alternar"
            onClick={() => setVerTabela((v) => !v)}
            aria-pressed={verTabela}
            title={verTabela ? 'Ver gráfico' : 'Ver dados em tabela'}
          >
            <CIcon icon={verTabela ? cilChartLine : cilList} />
            <span className="visually-hidden">{verTabela ? 'Ver gráfico' : 'Ver dados em tabela'}</span>
          </button>
        )}
      </header>
      <div className="visual-corpo">
        {erro ? (
          <div className="visual-estado visual-erro">{erro}</div>
        ) : !dados ? (
          <div className="visual-estado">{carregando !== false ? <span className="visual-carregando" aria-label="Carregando" /> : 'Sem dados.'}</div>
        ) : vazio ? (
          <div className="visual-estado">Nenhum dado para os filtros escolhidos.</div>
        ) : tipo === 'kpi' ? (
          <Kpi d={dados as DadosKpi} formato={formato} config={config} tema={tema} />
        ) : tipo === 'tabela' ? (
          <Tabela d={dados as DadosTabela} formato={formato} rotulos={config.rotulos} />
        ) : verTabela ? (
          <TabelaDoGrafico tipo={tipo} d={dados} formato={formato} rotulos={config.rotulos} />
        ) : (
          <Grafico tipo={tipo} config={config} d={dados} paleta={paleta} formato={formato} />
        )}
      </div>
      {dados && (dados.aviso || (tipo === 'barra' && (dados as DadosSeries).omitidas > 0)) && (
        <footer className="visual-rodape">
          {dados.aviso ?? `Mostrando as ${config.limite} primeiras categorias; ${(dados as DadosSeries).omitidas} ficaram de fora.`}
        </footer>
      )}
    </section>
  );
}

function estaVazio(tipo: TipoVisual, d: DadosVisual) {
  if (tipo === 'kpi') return (d as DadosKpi).valor === null && (d as DadosKpi).linhas === 0;
  if (tipo === 'pizza') return !(d as DadosPizza).fatias.length;
  if (tipo === 'tabela') return !(d as DadosTabela).linhas.length;
  return !(d as DadosSeries).categorias.length;
}

/* ---------- Indicador ---------- */

function Kpi({ d, formato, config, tema }: { d: DadosKpi; formato: Formato; config: Record<string, any>; tema: string }) {
  // Cor do ícone por tema; se só uma foi escolhida, vale para os dois
  const corIcone = (tema === 'escuro' ? (config.iconeCorEscuro ?? config.iconeCor) : (config.iconeCor ?? config.iconeCorEscuro)) ?? 'var(--bi-primary)';
  const pct = d.percentualMeta;
  const acima = pct !== null && pct >= 100;
  const icone = config.icone === 'circulo' ? null : iconeIndicador(config.icone);
  const tamIcone = Number(config.iconeTamanho) || 48;
  const px = (n: unknown) => (n ? `${n}px` : undefined);
  return (
    <div className={`kpi${config.icone ? ' kpi-com-icone' : ''}`}>
      {config.icone === 'circulo' && (
        <span className="kpi-icone kpi-circulo" aria-hidden="true" style={{ width: tamIcone, height: tamIcone, backgroundColor: corIcone }} />
      )}
      {icone && (
        <span className="kpi-icone" aria-hidden="true" style={{ color: corIcone }}>
          <CIcon icon={icone} width={tamIcone} height={tamIcone} />
        </span>
      )}
      <div className="kpi-textos">
        <div className="kpi-valor" title={formatar(d.valor, formato)} style={{ color: config.valorCor ?? undefined, fontSize: config.valorTamanho ? `min(${config.valorTamanho}px, 17cqw)` : undefined }}>
          {formatarCurto(d.valor, formato)}
        </div>
        {config.rotulo && (
          <div className="kpi-rotulo" style={{ color: config.rotuloCor ?? undefined, fontSize: px(config.rotuloTamanho) }}>
            {config.rotulo}
          </div>
        )}
        {d.meta !== null && d.meta !== undefined && (
          <div className="kpi-meta">
            <span className={`kpi-status ${acima ? 'bom' : 'abaixo'}`}>
              <CIcon icon={acima ? cilArrowTop : cilArrowBottom} size="sm" />
              {formatar(pct, 'percentual')} da meta
            </span>
            <span className="kpi-meta-valor">Meta {formatarCurto(d.meta, formato)}</span>
            <div
              className="kpi-barra"
              role="progressbar"
              aria-valuenow={Math.round(pct ?? 0)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Atingimento da meta"
            >
              <span style={{ width: `${Math.min(100, Math.max(0, pct ?? 0))}%` }} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- Gráficos ---------- */

function Grafico({
  tipo,
  config,
  d,
  paleta,
  formato,
}: {
  tipo: 'barra' | 'linha' | 'pizza';
  config: Record<string, any>;
  d: DadosVisual;
  paleta: PaletaGrafico;
  formato: Formato;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const grafico = useRef<Chart | null>(null);

  const cfg = useMemo(() => montarConfig(tipo, config, d, paleta, formato), [tipo, config, d, paleta, formato]);

  useEffect(() => {
    if (!canvas.current) return;
    grafico.current?.destroy();
    grafico.current = new Chart(canvas.current, cfg);
    return () => {
      grafico.current?.destroy();
      grafico.current = null;
    };
  }, [cfg]);

  const descricao =
    tipo === 'pizza'
      ? `Gráfico de pizza com ${(d as DadosPizza).fatias.length} fatias.`
      : `Gráfico de ${tipo === 'barra' ? 'barras' : 'linhas'} com ${(d as DadosSeries).categorias.length} categorias e ${(d as DadosSeries).series.length} ${(d as DadosSeries).series.length === 1 ? 'série' : 'séries'}. Use o botão de tabela para ver os valores.`;

  return (
    <div className="visual-grafico">
      <canvas ref={canvas} role="img" aria-label={descricao} />
    </div>
  );
}

function montarConfig(
  tipo: 'barra' | 'linha' | 'pizza',
  config: Record<string, any>,
  d: DadosVisual,
  p: PaletaGrafico,
  formato: Formato,
): ChartConfiguration {
  const fonte = { family: "'IBM Plex Sans', system-ui, sans-serif", size: 12 };
  const tooltip = {
    backgroundColor: p.superficie,
    titleColor: p.texto,
    bodyColor: p.texto,
    borderColor: p.eixo,
    borderWidth: 1,
    padding: 10,
    boxPadding: 4,
    usePointStyle: true,
    titleFont: { ...fonte, weight: 600 as const },
    bodyFont: fonte,
  };

  if (tipo === 'pizza') {
    const pz = d as DadosPizza;
    const total = pz.fatias.reduce((a, b) => a + b.valor, 0);
    return {
      type: config.rosca === false ? 'pie' : 'doughnut',
      data: {
        labels: pz.fatias.map((f) => f.nome),
        datasets: [
          {
            data: pz.fatias.map((f) => f.valor),
            backgroundColor: pz.fatias.map((_, i) => p.series[i % p.series.length]),
            borderColor: p.superficie,
            borderWidth: 2,
            hoverOffset: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 250 },
        ...(config.rosca === false ? {} : { cutout: '62%' }),
        plugins: {
          legend: {
            position: 'right',
            labels: {
              color: p.texto,
              font: fonte,
              usePointStyle: true,
              pointStyle: 'circle',
              pointStyleWidth: 9,
              boxWidth: 9,
              boxHeight: 9,
              padding: 12,
              generateLabels: (chart) =>
                pz.fatias.map((f, i) => ({
                  text: `${f.nome}  ${formatar((f.valor / total) * 100, 'percentual')}`,
                  fillStyle: p.series[i % p.series.length],
                  strokeStyle: p.series[i % p.series.length],
                  fontColor: p.texto,
                  hidden: !chart.getDataVisibility(i),
                  index: i,
                  pointStyle: 'circle',
                })),
            },
            onClick: (_e, item, legend) => {
              legend.chart.toggleDataVisibility(item.index!);
              legend.chart.update();
            },
          },
          tooltip: {
            ...tooltip,
            callbacks: {
              label: (c) => ` ${c.label}: ${formatar(c.parsed as number, formato)} (${formatar(((c.parsed as number) / total) * 100, 'percentual')})`,
            },
          },
        },
      },
    };
  }

  const s = d as DadosSeries;
  const horizontal = tipo === 'barra' && !!config.horizontal;
  const empilhado = tipo === 'barra' && !!config.empilhado && s.series.length > 1;
  const varias = s.series.length > 1;
  const eixoValor = {
    beginAtZero: tipo === 'barra',
    stacked: empilhado,
    grid: { color: p.grade, drawTicks: false },
    border: { display: false },
    ticks: { color: p.textoSecundario, font: fonte, padding: 8, maxTicksLimit: 6, callback: (v: string | number) => formatarCurto(Number(v), formato) },
  };
  const eixoCategoria = {
    stacked: empilhado,
    grid: { display: false },
    border: { color: p.eixo },
    ticks: { color: p.textoSecundario, font: fonte, autoSkip: true, maxRotation: 0, autoSkipPadding: 12 },
  };

  return {
    type: tipo === 'barra' ? 'bar' : 'line',
    data: {
      labels: s.categorias.map(rotuloCategoria),
      datasets: s.series.map((serie, i) => {
        const cor = config.cores?.[serie.nome] ?? p.series[i % p.series.length];
        return tipo === 'barra'
          ? {
              label: config.rotulos?.[serie.nome]?.trim() || rotuloColuna(serie.nome),
              data: serie.valores,
              backgroundColor: cor,
              hoverBackgroundColor: cor,
              borderRadius: empilhado ? 0 : 4,
              borderSkipped: 'start' as const,
              borderColor: p.superficie,
              borderWidth: empilhado ? { top: 2 } : 0,
              maxBarThickness: 40,
              categoryPercentage: 0.72,
              barPercentage: varias && !empilhado ? 0.92 : 1,
            }
          : {
              label: config.rotulos?.[serie.nome]?.trim() || rotuloColuna(serie.nome),
              data: serie.valores,
              borderColor: cor,
              backgroundColor: cor,
              borderWidth: 2,
              pointRadius: s.categorias.length > 24 ? 0 : 3,
              pointHoverRadius: 5,
              pointBorderColor: p.superficie,
              pointBorderWidth: 2,
              tension: 0.2,
              spanGaps: true,
            };
      }),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 250 },
      indexAxis: horizontal ? 'y' : 'x',
      interaction: { mode: 'index', intersect: false, axis: horizontal ? 'y' : 'x' },
      layout: { padding: { top: 4, right: 8 } },
      scales: horizontal ? { x: eixoValor, y: eixoCategoria } : { x: eixoCategoria, y: eixoValor },
      plugins: {
        legend: {
          display: varias,
          position: 'top',
          align: 'start',
          labels: { color: p.texto, font: fonte, usePointStyle: true, pointStyle: 'rectRounded', boxWidth: 10, boxHeight: 10, pointStyleWidth: 12, padding: 14 },
        },
        tooltip: {
          ...tooltip,
          callbacks: {
            title: (itens: any[]) => (itens[0] ? s.categorias[itens[0].dataIndex] && rotuloCategoria(s.categorias[itens[0].dataIndex]) : ''),
            label: (c: any) => ` ${c.dataset.label}: ${formatar(horizontal ? c.parsed.x : c.parsed.y, formato)}`,
          },
        },
      },
    } as any,
  };
}

/* ---------- Tabelas ---------- */

function celula(v: unknown, tipo: string, formato: Formato) {
  if (v === null || v === undefined) return '—';
  if (tipo === 'numero' && typeof v === 'number') return formatar(v, formato);
  if (tipo === 'data' && typeof v === 'string') return rotuloCategoria(v.slice(0, 10));
  return String(v);
}

const ordenador = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });

/** Cor e efeito de um destaque; sem cor de fonte escolhida, usa a de melhor contraste com o fundo. */
function estiloCss(e?: EstiloDestaque): CSSProperties | undefined {
  if (!e) return undefined;
  return {
    ...(e.fundo ? { backgroundColor: e.fundo } : {}),
    ...(e.fonte ? { color: e.fonte } : e.fundo ? { color: textoSobre(e.fundo) } : {}),
  };
}

type Ordem = { coluna: number; sentido: 'desc' | 'asc' } | null;

function Tabela({ d, formato, rotulos }: { d: DadosTabela; formato: Formato; rotulos?: Record<string, string> }) {
  const [ordem, setOrdem] = useState<Ordem>(null);

  // Clique no título: decrescente → crescente → sem ordenação
  const alternar = (j: number) =>
    setOrdem((o) => (!o || o.coluna !== j ? { coluna: j, sentido: 'desc' } : o.sentido === 'desc' ? { coluna: j, sentido: 'asc' } : null));

  const indices = useMemo(() => {
    const idx = d.linhas.map((_, i) => i);
    if (!ordem) return idx;
    const { coluna: j, sentido } = ordem;
    const fator = sentido === 'asc' ? 1 : -1;
    return idx.sort((a, b) => {
      const x = d.linhas[a][j];
      const y = d.linhas[b][j];
      const vx = x === null || x === undefined || x === '';
      const vy = y === null || y === undefined || y === '';
      if (vx || vy) return vx === vy ? a - b : vx ? 1 : -1; // vazios sempre no fim
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : ordenador.compare(String(x), String(y));
      return c * fator || a - b;
    });
  }, [d.linhas, ordem]);

  return (
    <div className="visual-tabela" tabIndex={0}>
      <table>
        <thead>
          <tr>
            {d.marcador && (
              <th scope="col" className="tabela-marcador">
                <span className="visually-hidden">Destaque</span>
              </th>
            )}
            {d.colunas.map((c, j) => {
              const ativa = ordem?.coluna === j ? ordem.sentido : null;
              return (
                <th
                  key={c.nome}
                  className={c.tipo === 'numero' ? 'num' : ''}
                  scope="col"
                  aria-sort={ativa === 'asc' ? 'ascending' : ativa === 'desc' ? 'descending' : 'none'}
                >
                  <button type="button" className="tabela-ordenar" onClick={() => alternar(j)} title="Ordenar">
                    {rotulos?.[c.nome]?.trim() || rotuloColuna(c.nome)}
                    <CIcon icon={ativa === 'asc' ? cilArrowTop : cilArrowBottom} size="sm" className={`tabela-seta ${ativa ? 'ativa' : ''}`} aria-hidden="true" />
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {indices.map((i) => {
            const l = d.linhas[i];
            const e = d.estilos?.[i];
            return (
              <tr key={i} className={e?.linha?.piscar ? 'destaque-piscar' : undefined} style={estiloCss(e?.linha)} title={e?.linha?.legenda}>
                {d.marcador && (
                  <td className="tabela-marcador">
                    {e?.marcador && (
                      <span
                        className={`marcador${e.marcador.piscar ? ' destaque-piscar' : ''}`}
                        style={{ backgroundColor: e.marcador.fundo ?? e.marcador.fonte }}
                        title={e.marcador.legenda}
                      >
                        {e.marcador.legenda && <span className="visually-hidden">{e.marcador.legenda}</span>}
                      </span>
                    )}
                  </td>
                )}
                {l.map((v, j) => {
                  const ec = e?.celulas?.[j];
                  return (
                    <td
                      key={j}
                      className={`${d.colunas[j].tipo === 'numero' ? 'num' : ''}${ec?.piscar ? ' destaque-piscar' : ''}`}
                      style={estiloCss(ec)}
                      title={ec?.legenda}
                    >
                      {celula(v, d.colunas[j].tipo, formato)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TabelaDoGrafico({ tipo, d, formato, rotulos }: { tipo: TipoVisual; d: DadosVisual; formato: Formato; rotulos?: Record<string, string> }) {
  if (tipo === 'pizza') {
    const pz = d as DadosPizza;
    return (
      <Tabela
        formato={formato}
        d={{ colunas: [{ nome: 'categoria', tipo: 'texto' }, { nome: 'valor', tipo: 'numero' }], linhas: pz.fatias.map((f) => [f.nome, f.valor]), total: pz.fatias.length, aviso: null }}
      />
    );
  }
  const s = d as DadosSeries;
  return (
    <Tabela
      formato={formato}
      rotulos={rotulos}
      d={{
        colunas: [{ nome: 'categoria', tipo: 'texto' }, ...s.series.map((x) => ({ nome: x.nome, tipo: 'numero' as const }))],
        linhas: s.categorias.map((c, i) => [rotuloCategoria(c), ...s.series.map((x) => x.valores[i])]),
        total: s.categorias.length,
        aviso: null,
      }}
    />
  );
}
