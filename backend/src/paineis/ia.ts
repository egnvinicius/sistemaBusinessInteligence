import { config } from '../config.js';
import { ehExpressao } from './expressoes.js';
import { conferirColunas, visualSchema, type Visual } from './visuais.js';

/* =========================================================
   IA das análises (Claude). A IA recebe SÓ o pedido do usuário,
   o nome do cubo e as colunas (nome, tipo e descrição) — nenhum
   dado do banco sai da empresa. Ela devolve a configuração dos
   visuais; quem calcula os números é o próprio sistema.
   ========================================================= */

export interface ColunaCubo {
  nome: string;
  tipo: 'numero' | 'texto' | 'data';
  descricao?: string | null;
}

export interface VisualAtual {
  cuboId: number;
  tipo: string;
  titulo: string;
  config: Record<string, unknown>;
  layout: { x: number; y: number; w: number; h: number };
}

export class ErroIa extends Error {
  constructor(
    message: string,
    public status = 502,
  ) {
    super(message);
  }
}

const FERRAMENTA = {
  name: 'montar_analise',
  description: 'Devolve a lista COMPLETA de visuais da análise (os que ficam e os novos) e uma mensagem curta ao usuário.',
  input_schema: {
    type: 'object',
    properties: {
      mensagem: { type: 'string', description: 'Uma ou duas frases em português do Brasil explicando o que foi montado ou por que não foi possível.' },
      visuais: {
        type: 'array',
        maxItems: 12,
        items: {
          type: 'object',
          properties: {
            tipo: { type: 'string', enum: ['kpi', 'barra', 'linha', 'pizza', 'tabela'] },
            titulo: { type: 'string', description: 'Título curto, em português' },
            cubo: { type: 'integer', description: 'Id do cubo de onde vêm as colunas deste visual' },
            largura: { type: 'integer', minimum: 2, maximum: 12, description: 'Colunas da grade de 12' },
            altura: { type: 'integer', minimum: 2, maximum: 8, description: 'Linhas de 64px' },
            config: {
              type: 'object',
              properties: {
                medida: { type: 'string', description: 'kpi e pizza: coluna do valor' },
                medidas: { type: 'array', items: { type: 'string' }, maxItems: 8, description: 'barra e linha: colunas dos valores (séries)' },
                categoria: { type: 'string', description: 'barra, linha e pizza: coluna que agrupa' },
                agregacao: { type: 'string', enum: ['soma', 'media', 'minimo', 'maximo', 'contagem'] },
                formato: { type: 'string', enum: ['numero', 'inteiro', 'moeda', 'percentual'] },
                horizontal: { type: 'boolean' },
                empilhado: { type: 'boolean' },
                ordenar: { type: 'string', enum: ['categoria', 'valor_desc', 'valor_asc'] },
                limite: { type: 'integer', minimum: 1, maximum: 100, description: 'barra: máximo de categorias; pizza: máximo de fatias (2 a 12)' },
                rosca: { type: 'boolean' },
                colunas: { type: 'array', items: { type: 'string' }, description: 'tabela: colunas exibidas (vazio = todas)' },
                rotulo: { type: 'string', description: 'kpi: texto curto abaixo do número' },
                rotulos: { type: 'object', additionalProperties: { type: 'string' }, description: 'Nome exibido por coluna: {"coluna": "Nome"}' },
                filtrosVisual: {
                  type: 'array',
                  maxItems: 10,
                  description: 'Só as linhas que atendem entram no cálculo',
                  items: {
                    type: 'object',
                    properties: {
                      coluna: { type: 'string' },
                      condicao: {
                        type: 'string',
                        enum: ['igual', 'diferente', 'maior', 'maior_igual', 'menor', 'menor_igual', 'contem', 'nao_contem', 'vazio', 'nao_vazio'],
                      },
                      valor: { type: 'string' },
                      ligacao: { type: 'string', enum: ['e', 'ou'] },
                    },
                    required: ['coluna', 'condicao'],
                  },
                },
              },
            },
          },
          required: ['tipo', 'titulo', 'config'],
        },
      },
      filtros: {
        type: 'array',
        maxItems: 10,
        description: 'Lista COMPLETA dos filtros do topo da análise (os que ficam e os novos). Omita para manter os atuais.',
        items: {
          type: 'object',
          properties: {
            nome: { type: 'string', description: 'Nome curto exibido na barra, em português' },
            cubo: { type: 'integer' },
            coluna: { type: 'string', description: 'Nome técnico da coluna' },
            tipo: { type: 'string', enum: ['periodo', 'ano', 'mes', 'valores'], description: 'periodo, ano e mes: colunas de data; valores: escolher valores da coluna' },
          },
          required: ['nome', 'cubo', 'coluna', 'tipo'],
        },
      },
    },
    required: ['mensagem', 'visuais'],
  },
} as const;

export interface PainelParaIa {
  nome: string;
  descricao: string | null;
  visuais: { tipo: string; titulo: string; config: Record<string, unknown> }[];
}

/** Resumo dos painéis prontos para a IA: só a montagem (tipo, título, configuração), nunca dados. */
function resumoPaineis(paineis: PainelParaIa[]) {
  const MAX_PAINEIS = 15;
  const MAX_VISUAIS = 80;
  let restantes = MAX_VISUAIS;
  const linhas: string[] = [];
  for (const p of paineis.slice(0, MAX_PAINEIS)) {
    if (restantes <= 0) break;
    const vs = p.visuais.slice(0, restantes);
    restantes -= vs.length;
    linhas.push(`Painel "${p.nome}"${p.descricao ? ` (${p.descricao})` : ''}:`);
    for (const v of vs) {
      // Só o que define o visual; aparência (cores, tamanhos, ícones) fica de fora para economizar
      const { tituloCor, tituloTamanho, valorCor, valorTamanho, rotuloCor, rotuloTamanho, icone, iconeCor, iconeCorEscuro, iconeTamanho, cores, ...essencial } = v.config as any;
      linhas.push(`  - ${v.tipo} "${v.titulo}" ${JSON.stringify(essencial)}`);
    }
  }
  return linhas.length ? linhas.join('\n') : '(nenhum painel pronto usa este cubo)';
}

export interface CuboParaIa {
  id: number;
  nome: string;
  descricao: string | null;
  consultaId: number;
  colunas: ColunaCubo[];
}

export interface FiltroTopoIa {
  id: string;
  nome: string;
  cuboId: number;
  coluna: string;
  tipo: 'periodo' | 'ano' | 'mes' | 'valores';
  multiplo: boolean;
  padrao: string;
}

function instrucoes(cubos: CuboParaIa[], ligacoes: string[], atuais: VisualAtual[], filtros: FiltroTopoIa[], paineis: PainelParaIa[] = []) {
  const blocoCubos = cubos
    .map((cubo) => {
      const cols = cubo.colunas
        .map((c) => `- ${c.nome} (${c.tipo === 'numero' ? 'número' : c.tipo === 'data' ? 'data' : 'texto'})${c.descricao ? `: ${c.descricao}` : ''}`)
        .join('\n');
      return `Cubo ${cubo.id}: ${cubo.nome}${cubo.descricao ? ` — ${cubo.descricao}` : ''}\n${cols}`;
    })
    .join('\n\n');
  const linhasAtuais = atuais.length
    ? atuais.map((v, i) => `${i + 1}. [cubo ${v.cuboId}] ${v.tipo} "${v.titulo}" ${JSON.stringify(v.config)}`).join('\n')
    : '(nenhum ainda)';
  const linhasFiltros = filtros.length ? filtros.map((x) => `- "${x.nome}": cubo ${x.cuboId}, coluna ${x.coluna}, ${x.tipo}`).join('\n') : '(nenhum)';
  return `Você monta visualizações de BI numa ferramenta interna. Responda SEMPRE chamando a ferramenta montar_analise.

Cubos da análise. Colunas no formato "nome técnico (tipo): nome que o usuário conhece".
O usuário costuma citar as colunas pelo nome que conhece (a descrição); na configuração use SEMPRE o nome técnico, exatamente como está:

${blocoCubos}

Ligações entre os cubos (um filtro do topo atravessa a ligação e filtra os visuais do outro cubo):
${ligacoes.length ? ligacoes.join('\n') : '(nenhuma)'}

Visuais que a análise já tem:
${linhasAtuais}

Filtros do topo que a análise já tem (valem para todos os visuais):
${linhasFiltros}

Painéis prontos da empresa que usam estes mesmos dados (só a montagem; o usuário pode pedir "igual ao painel X"):
${resumoPaineis(paineis)}

Regras:
- Devolva a lista COMPLETA de visuais: mantenha os atuais (mesmo título, cubo e configuração), a menos que o usuário peça para mudar ou remover, e acrescente os novos.
- Cada visual usa as colunas de UM cubo: informe o id em "cubo". Um visual não junta colunas de dois cubos.
- Se o usuário citar um painel pronto, reaproveite a configuração dos visuais dele (mesmas colunas, agregações e filtros), aplicando só as mudanças pedidas.
- Use só as colunas acima. Se o pedido precisar de um dado que não existe nos cubos, não invente: explique na mensagem o que falta.
- "medida" e "medidas" devem ser colunas numéricas, exceto com agregação "contagem", que conta linhas de qualquer coluna.
- Tipos: kpi = um número de destaque; barra = comparar categorias; linha = evolução no tempo (categoria = coluna de data ou período); pizza = participação no total (até 6 fatias; precisa de uma coluna de categoria); tabela = detalhe linha a linha.
- Formato "moeda" para valores em reais, "inteiro" para contagens e quantidades, "percentual" quando o valor já é um percentual.
- Filtros do topo ("filtros"): quando o usuário quer escolher ou trocar algo para a análise toda (ex.: "com filtro de mês e ano", "por período", "escolher a filial"). Use tipo periodo, ano ou mes em colunas de data e valores nas demais. Ao mexer em filtros, devolva a lista completa; se não mexer, omita "filtros".
- Restrição fixa de um visual (ex.: "só Itajaí", "acima de 1000", "até 2 horas"): use filtrosVisual. Durações podem ser escritas como "00d 02:00". Não use "exec=".
- Tamanhos: kpi 3x2; barra, linha e pizza 6x5 (ou 4x5); tabela 12x6.
- Títulos curtos e em português do Brasil, usando os nomes que o usuário conhece (as descrições), nunca o nome técnico. Nunca devolva SQL.
- Em "rotulos", use a descrição de cada coluna como nome exibido (ex.: {"vl_frete": "Valor do frete"}).
- Os dados em si você não vê; a ferramenta calcula os números a partir da sua configuração.`;
}

/**
 * Modelos que não aceitam obrigar o uso da ferramenta (tool_choice "tool"/"any"),
 * como os de raciocínio estendido. Descoberto na primeira recusa e lembrado até reiniciar.
 */
export const modelosSemToolChoice = new Set<string>();

export async function enviar(corpo: Record<string, unknown>) {
  const controle = new AbortController();
  const tempo = setTimeout(() => controle.abort(), 120_000);
  try {
    const resposta = await fetch(`${config.anthropicUrl.replace(/\/$/, '')}/v1/messages`, {
      method: 'POST',
      signal: controle.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': config.anthropicApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(corpo),
    });
    return { resposta, corpo: (await resposta.json().catch(() => null)) as any };
  } catch (e) {
    throw new ErroIa((e as Error).name === 'AbortError' ? 'A IA demorou demais para responder. Tente de novo.' : 'Não foi possível falar com o serviço de IA. Verifique a conexão do servidor com a internet.');
  } finally {
    clearTimeout(tempo);
  }
}

/** Lê a análise da resposta: pela ferramenta ou, se o modelo respondeu em texto, pelo JSON dentro dele. */
function lerAnalise(corpo: any): { mensagem?: string; visuais?: any[]; filtros?: any[] } | null {
  const uso = corpo?.content?.find((c: any) => c.type === 'tool_use' && c.name === FERRAMENTA.name);
  if (uso?.input) return uso.input;
  const texto = (corpo?.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');
  const inicio = texto.indexOf('{');
  const fim = texto.lastIndexOf('}');
  if (inicio < 0 || fim <= inicio) return null;
  try {
    const j = JSON.parse(texto.slice(inicio, fim + 1));
    return Array.isArray(j?.visuais) ? j : null;
  } catch {
    return null;
  }
}

/** Chama o Claude e devolve os visuais propostos (ainda não validados). */
async function chamarClaude(sistema: string, pedido: string) {
  if (!config.anthropicApiKey) throw new ErroIa('A IA não está configurada. Peça ao administrador para informar a chave ANTHROPIC_API_KEY.', 503);
  const modelo = config.anthropicModelo;
  const base = { model: modelo, max_tokens: 8000, tools: [FERRAMENTA], messages: [{ role: 'user', content: pedido }] };
  const semObrigar = {
    ...base,
    system: `${sistema}\n\nResponda chamando a ferramenta montar_analise uma única vez, sem texto fora dela.`,
    tool_choice: { type: 'auto' },
  };

  let r = modelosSemToolChoice.has(modelo)
    ? await enviar(semObrigar)
    : await enviar({ ...base, system: sistema, tool_choice: { type: 'tool', name: FERRAMENTA.name } });
  // Modelo que não aceita obrigar a ferramenta: repete sem obrigar
  if (r.resposta.status === 400 && /tool_choice/i.test(r.corpo?.error?.message ?? '') && !modelosSemToolChoice.has(modelo)) {
    modelosSemToolChoice.add(modelo);
    r = await enviar(semObrigar);
  }

  const { resposta, corpo } = r;
  if (!resposta.ok) {
    const motivo = corpo?.error?.message ?? `HTTP ${resposta.status}`;
    if (resposta.status === 401 || resposta.status === 403) throw new ErroIa('A chave da IA foi recusada. Confira ANTHROPIC_API_KEY.', 503);
    if (resposta.status === 404 || /model/i.test(motivo) && resposta.status === 400) throw new ErroIa(`O modelo "${modelo}" não está disponível para esta chave. Confira ANTHROPIC_MODEL. (${motivo})`, 503);
    if (resposta.status === 429) throw new ErroIa('O limite de uso da IA foi atingido agora. Tente de novo em alguns minutos.', 429);
    if (resposta.status === 529 || resposta.status >= 500) throw new ErroIa('O serviço de IA está sobrecarregado. Tente de novo em instantes.');
    throw new ErroIa(`A IA recusou o pedido: ${motivo}`);
  }
  const entrada = lerAnalise(corpo);
  if (!entrada) throw new ErroIa('A IA não devolveu uma análise. Tente descrever o pedido de outro jeito.');
  return {
    entrada,
    tokens: { entrada: corpo?.usage?.input_tokens ?? null, saida: corpo?.usage?.output_tokens ?? null },
  };
}

/** Nome exibido das colunas de tabela e das séries = descrição do cubo, quando a IA não definiu outro. */
function comRotulos(v: Visual, colunas: ColunaCubo[]): Visual {
  const cfg = v.config as any;
  const usadas: string[] =
    v.tipo === 'tabela' ? (cfg.colunas?.length ? cfg.colunas : colunas.map((c) => c.nome)) : v.tipo === 'barra' || v.tipo === 'linha' ? cfg.medidas ?? [] : [];
  if (!usadas.length) return v;
  const rotulos = { ...(cfg.rotulos ?? {}) };
  for (const n of usadas) {
    const desc = colunas.find((c) => c.nome === n)?.descricao?.trim();
    if (desc && !rotulos[n]) rotulos[n] = desc.slice(0, 80);
  }
  return { ...v, config: { ...cfg, rotulos } };
}

/** Posiciona na grade: quem já existia (mesmo título) fica onde estava; os novos vão para baixo, da esquerda para a direita. */
function posicionar(visuais: { titulo: string; largura?: number; altura?: number; tipo: string }[], atuais: VisualAtual[]) {
  const TAMANHO: Record<string, [number, number]> = { kpi: [3, 2], barra: [6, 5], linha: [6, 5], pizza: [4, 5], tabela: [12, 6] };
  let fundo = atuais.reduce((m, v) => Math.max(m, v.layout.y + v.layout.h), 0);
  let x = 0;
  let alturaLinha = 0;
  let ultimoKpi: boolean | null = null;
  return visuais.map((v) => {
    const antes = atuais.find((a) => a.titulo.trim().toLowerCase() === v.titulo.trim().toLowerCase());
    if (antes) return antes.layout;
    const [wp, hp] = TAMANHO[v.tipo] ?? [6, 5];
    const w = Math.min(12, Math.max(2, Math.round(v.largura ?? wp)));
    const h = Math.min(8, Math.max(2, Math.round(v.altura ?? hp)));
    // Indicadores ficam numa faixa própria, sem dividir a linha com gráficos altos
    const kpi = v.tipo === 'kpi';
    if (x + w > 12 || (ultimoKpi !== null && kpi !== ultimoKpi && x > 0)) {
      fundo += alturaLinha;
      x = 0;
      alturaLinha = 0;
    }
    ultimoKpi = kpi;
    const l = { x, y: fundo, w, h };
    x += w;
    alturaLinha = Math.max(alturaLinha, h);
    return l;
  });
}

/**
 * Pede à IA e devolve só visuais válidos para os cubos. O que vier errado
 * (cubo ou coluna inexistente, medida de texto, exec=) é descartado com um aviso.
 */
export async function montarComIa(
  cubos: CuboParaIa[],
  ligacoes: string[],
  pedido: string,
  atuais: VisualAtual[],
  filtrosAtuais: FiltroTopoIa[],
  paineis: PainelParaIa[] = [],
) {
  const { entrada, tokens } = await chamarClaude(instrucoes(cubos, ligacoes, atuais, filtrosAtuais, paineis), pedido);
  const propostos = (Array.isArray(entrada.visuais) ? entrada.visuais : []).slice(0, 12);
  const layouts = posicionar(
    propostos.map((p) => ({ titulo: String(p?.titulo ?? ''), largura: p?.largura, altura: p?.altura, tipo: String(p?.tipo ?? '') })),
    atuais,
  );
  const visuais: (Visual & { cuboId: number })[] = [];
  const avisos: string[] = [];
  const porId = new Map(cubos.map((c) => [c.id, c]));
  propostos.forEach((p, i) => {
    // Sem cubo informado: o do visual de mesmo título, ou o primeiro da análise
    const antes = atuais.find((a) => a.titulo.trim().toLowerCase() === String(p?.titulo ?? '').trim().toLowerCase());
    const cubo = porId.get(Number(p?.cubo)) ?? (antes ? porId.get(antes.cuboId) : undefined) ?? cubos[0];
    const cfg = { ...(p?.config ?? {}) };
    if (Array.isArray(cfg.filtrosVisual)) {
      const qtd = cfg.filtrosVisual.length;
      cfg.filtrosVisual = cfg.filtrosVisual.filter((f: any) => !ehExpressao(f?.valor));
      if (cfg.filtrosVisual.length < qtd) avisos.push(`"${p?.titulo}": um filtro com exec= foi ignorado.`);
    }
    const r = visualSchema.safeParse({ tipo: p?.tipo, titulo: p?.titulo, consultaId: cubo.consultaId, config: cfg, layout: layouts[i] });
    if (!r.success) {
      avisos.push(`Um visual sugerido ("${p?.titulo ?? 'sem título'}") veio incompleto e ficou de fora.`);
      return;
    }
    const problema = conferirColunas(r.data, cubo.colunas);
    if (problema) {
      avisos.push(`${problema} O visual ficou de fora.`);
      return;
    }
    visuais.push({ ...comRotulos(r.data, cubo.colunas), cuboId: cubo.id });
  });

  // Filtros do topo: só quando a IA mexeu neles
  let filtros: FiltroTopoIa[] | null = null;
  if (Array.isArray(entrada.filtros)) {
    filtros = [];
    for (const x of entrada.filtros.slice(0, 10)) {
      const cubo = porId.get(Number(x?.cubo)) ?? (cubos.length === 1 ? cubos[0] : undefined);
      const col = cubo?.colunas.find((c) => c.nome === x?.coluna);
      const tipo = ['periodo', 'ano', 'mes', 'valores'].includes(x?.tipo) ? (x.tipo as FiltroTopoIa['tipo']) : null;
      if (!cubo || !col || !tipo || (tipo === 'valores') === (col.tipo === 'data')) {
        avisos.push(`O filtro "${x?.nome ?? x?.coluna ?? '?'}" sugerido não combina com as colunas e ficou de fora.`);
        continue;
      }
      const igual = filtrosAtuais.find((a) => a.cuboId === cubo.id && a.coluna === col.nome && a.tipo === tipo);
      if (filtros.some((a) => a.cuboId === cubo.id && a.coluna === col.nome && a.tipo === tipo)) continue;
      filtros.push(
        igual
          ? { ...igual, nome: String(x?.nome || igual.nome).slice(0, 60) }
          : {
              id: `f${Date.now().toString(36)}${filtros.length}`,
              nome: String(x?.nome || col.descricao || col.nome).slice(0, 60),
              cuboId: cubo.id,
              coluna: col.nome,
              tipo,
              multiplo: true,
              padrao: 'nenhum',
            },
      );
    }
  }
  return { visuais, filtros, mensagem: String(entrada.mensagem ?? '').slice(0, 600), avisos, tokens, modelo: config.anthropicModelo };
}
