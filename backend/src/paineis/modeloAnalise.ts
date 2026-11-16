import { z } from 'zod';
import { executarConsulta } from './consultas.js';
import { filtrarPorConds, type Cond } from './condicoes.js';
import { anosDaTabela, calcularVisualDaTabela, distintosDaTabela } from './cuboTabela.js';
import { filtrosDoCubo, type CuboLinha } from './cubos.js';
import { valorPadrao, valoresParaParametros, type Filtro } from './filtros.js';
import { calcularVisual, conferirColunas, type Visual } from './visuais.js';
import { filtrosComOpcoes } from '../routes/paineis.js';

/* =========================================================
   Modelo da análise: vários cubos, ligações entre eles e
   filtros no topo que valem para todos os visuais.

   Um filtro mora numa coluna de um cubo. Nos visuais de outros
   cubos ele chega pelas ligações (como no Power BI): filtrar
   Modelo em Veículos filtra Manutenção pelos cd_veiculo desses
   veículos. Visual sem caminho até o cubo do filtro não é filtrado
   e mostra um aviso.
   ========================================================= */

export const MAX_CUBOS = 6;
export const MAX_FILTROS_TOPO = 10;
/** Chaves que um filtro pode levar de um cubo a outro pela ligação. */
const MAX_CHAVES = 100_000;
const MAX_OPCOES = 1000;

export const PADROES_TOPO = ['nenhum', 'mes_atual', 'mes_anterior', 'ultimos_30', 'ultimos_90', 'ano_atual', 'atual'] as const;

export const filtroTopoSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,24}$/, 'Filtro inválido.'),
  nome: z.string().trim().min(1, 'Dê um nome ao filtro.').max(60),
  cuboId: z.number().int().positive(),
  coluna: z.string().min(1).max(63),
  /** periodo, ano e mes: colunas de data; valores: escolher valores da coluna */
  tipo: z.enum(['periodo', 'ano', 'mes', 'valores']),
  multiplo: z.boolean().default(true),
  padrao: z.enum(PADROES_TOPO).default('nenhum'),
});
export type FiltroTopo = z.infer<typeof filtroTopoSchema>;

const ponta = z.object({ cuboId: z.number().int().positive(), coluna: z.string().min(1).max(63) });
export const ligacoesSchema = z
  .object({
    manuais: z.array(z.object({ a: ponta, b: ponta })).max(30).default([]),
    desligadas: z.array(z.tuple([z.number().int().positive(), z.number().int().positive()])).max(60).default([]),
  })
  .default({ manuais: [], desligadas: [] });
export type LigacoesCfg = z.infer<typeof ligacoesSchema>;

export interface Ligacao {
  a: { cuboId: number; coluna: string };
  b: { cuboId: number; coluna: string };
  origem: 'auto' | 'manual';
  /** Outras colunas de mesmo nome que também poderiam ligar os dois cubos */
  alternativas: string[];
}

/** Parâmetro do filtro do topo na barra de filtros (não colide com os @parâmetros das consultas). */
export const parametroTopo = (f: Pick<FiltroTopo, 'id'>) => `topo:${f.id}`;

const par = (x: number, y: number) => (x < y ? `${x}-${y}` : `${y}-${x}`);

/** Nome com cara de chave (cd_, id_, codigo, _id…) tem preferência na ligação automática. */
const pareceChave = (n: string) => /^(cd|id|cod|codigo|nr|num)(_|$)|_(id|cd|cod|codigo)$/i.test(n);

/**
 * Ligações em vigor: as manuais e, para cada par de cubos sem ligação manual nem
 * desligado pelo usuário, uma automática pela coluna de mesmo nome e tipo (datas não).
 * Cada par de cubos tem no máximo uma ligação, como no Power BI.
 */
export function ligacoesEfetivas(cubos: CuboLinha[], cfg: LigacoesCfg): Ligacao[] {
  const porId = new Map(cubos.map((c) => [c.id, c]));
  const existe = (p: { cuboId: number; coluna: string }) => porId.get(p.cuboId)?.colunas.some((c) => c.nome === p.coluna);
  const manuais = new Map<string, Ligacao>();
  for (const m of cfg.manuais) {
    if (m.a.cuboId === m.b.cuboId || !existe(m.a) || !existe(m.b)) continue;
    manuais.set(par(m.a.cuboId, m.b.cuboId), { a: m.a, b: m.b, origem: 'manual', alternativas: [] });
  }
  const desligadas = new Set(cfg.desligadas.map(([x, y]) => par(x, y)));
  const saida: Ligacao[] = [];
  for (let i = 0; i < cubos.length; i++) {
    for (let j = i + 1; j < cubos.length; j++) {
      const A = cubos[i];
      const B = cubos[j];
      const k = par(A.id, B.id);
      if (manuais.has(k)) {
        saida.push(manuais.get(k)!);
        continue;
      }
      if (desligadas.has(k)) continue;
      const candidatas = A.colunas
        .filter((c) => c.tipo !== 'data' && B.colunas.some((d) => d.nome.toLowerCase() === c.nome.toLowerCase() && d.tipo === c.tipo))
        .sort((x, y) => Number(pareceChave(y.nome)) - Number(pareceChave(x.nome)));
      if (!candidatas.length) continue;
      const escolhida = candidatas[0];
      const emB = B.colunas.find((d) => d.nome.toLowerCase() === escolhida.nome.toLowerCase())!;
      saida.push({
        a: { cuboId: A.id, coluna: escolhida.nome },
        b: { cuboId: B.id, coluna: emB.nome },
        origem: 'auto',
        alternativas: candidatas.slice(1).map((c) => c.nome),
      });
    }
  }
  return saida;
}

type Passo = { de: { cuboId: number; coluna: string }; para: { cuboId: number; coluna: string } };

/** Caminho mais curto de um cubo a outro pelas ligações (null se não há). */
export function caminho(ligs: Ligacao[], de: number, para: number): Passo[] | null {
  if (de === para) return [];
  const anterior = new Map<number, Passo>();
  const fila = [de];
  const vistos = new Set([de]);
  while (fila.length) {
    const atual = fila.shift()!;
    for (const l of ligs) {
      const passo: Passo | null = l.a.cuboId === atual ? { de: l.a, para: l.b } : l.b.cuboId === atual ? { de: l.b, para: l.a } : null;
      if (!passo || vistos.has(passo.para.cuboId)) continue;
      vistos.add(passo.para.cuboId);
      anterior.set(passo.para.cuboId, passo);
      if (passo.para.cuboId === para) {
        const r: Passo[] = [];
        let c = para;
        while (c !== de) {
          const p = anterior.get(c)!;
          r.unshift(p);
          c = p.de.cuboId;
        }
        return r;
      }
      fila.push(passo.para.cuboId);
    }
  }
  return null;
}

/* ---------- Valores escolhidos → condição ---------- */

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** Filtro "de mentira" para reaproveitar padrões e opções dos filtros cadastrados. */
const comoFiltro = (f: FiltroTopo): Filtro =>
  ({
    id: 0,
    nome: f.nome,
    parametro: parametroTopo(f),
    tipo: f.tipo === 'valores' ? 'select' : f.tipo,
    multiplo: f.multiplo,
    tipo_codigo: 'texto',
    lista_id: null,
    select_tabela: null,
    select_coluna_codigo: null,
    select_coluna_descricao: null,
    padrao: f.padrao,
    ano_inicial: null,
  }) as Filtro;

export const padraoTopo = (f: FiltroTopo) => valorPadrao(comoFiltro(f));

export function condicaoDoFiltro(f: FiltroTopo, valores: Record<string, unknown>): Cond | null {
  const k = parametroTopo(f);
  const bruto = k in (valores ?? {}) ? valores[k] : padraoTopo(f);
  if (f.tipo === 'periodo') {
    const v = (bruto ?? {}) as { de?: unknown; ate?: unknown };
    const de = typeof v.de === 'string' && DATA.test(v.de) ? v.de : null;
    const ate = typeof v.ate === 'string' && DATA.test(v.ate) ? v.ate : null;
    return de || ate ? { coluna: f.coluna, tipo: 'periodo', de, ate } : null;
  }
  if (f.tipo === 'ano' || f.tipo === 'mes') {
    const n = Number(bruto);
    const ok = bruto !== null && bruto !== '' && Number.isInteger(n) && (f.tipo === 'ano' ? n > 1900 && n < 2200 : n >= 1 && n <= 12);
    return ok ? { coluna: f.coluna, tipo: f.tipo, valor: n } : null;
  }
  const lista = (Array.isArray(bruto) ? bruto : bruto === null || bruto === undefined || bruto === '' ? [] : [bruto])
    .slice(0, MAX_OPCOES)
    .filter((x) => typeof x === 'string' || typeof x === 'number')
    .map((x) => (typeof x === 'string' ? x.slice(0, 200) : x));
  return lista.length ? { coluna: f.coluna, tipo: 'em', valores: lista } : null;
}

/* ---------- Validação ---------- */

/** Confere filtros do topo e ligações manuais contra os cubos da análise. */
export function problemaNoModelo(cubos: Map<number, CuboLinha>, filtros: FiltroTopo[], cfg: LigacoesCfg): string | null {
  const ids = new Set<string>();
  for (const f of filtros) {
    if (ids.has(f.id)) return `O filtro "${f.nome}" está repetido.`;
    ids.add(f.id);
    const c = cubos.get(f.cuboId);
    if (!c) return `O filtro "${f.nome}" usa um cubo que não está na análise.`;
    const col = c.colunas.find((x) => x.nome === f.coluna);
    if (!col) return `O filtro "${f.nome}" usa a coluna "${f.coluna}", que não existe em ${c.nome}.`;
    if (f.tipo !== 'valores' && col.tipo !== 'data') return `O filtro "${f.nome}" é de data, mas a coluna "${f.coluna}" não é uma data.`;
    if (f.tipo === 'valores' && col.tipo === 'data') return `Para a coluna de data "${f.coluna}", use um filtro de período, ano ou mês.`;
  }
  for (const m of cfg.manuais) {
    for (const p of [m.a, m.b]) {
      const c = cubos.get(p.cuboId);
      if (!c) return 'Uma ligação usa um cubo que não está na análise.';
      if (!c.colunas.some((x) => x.nome === p.coluna)) return `A ligação usa a coluna "${p.coluna}", que não existe em ${c.nome}.`;
    }
  }
  return null;
}

/* ---------- Cálculo ---------- */

export interface VisualDaAnalise extends Visual {
  cuboId: number;
}

/** Contexto de um cálculo: lê cada consulta e cada conjunto de chaves uma vez só. */
function contexto(cubos: Map<number, CuboLinha>, valores: Record<string, unknown>) {
  const linhasConsulta = new Map<number, Promise<Awaited<ReturnType<typeof executarConsulta>>>>();
  const chaves = new Map<string, Promise<unknown[]>>();
  const filtrosParam = new Map<number, Promise<Filtro[]>>();

  const paramsDo = (c: CuboLinha) => {
    if (!filtrosParam.has(c.id)) filtrosParam.set(c.id, filtrosDoCubo(c));
    return filtrosParam.get(c.id)!;
  };

  /** Linhas do cubo de consulta, já com os @parâmetros (filtros cadastrados) escolhidos. */
  const resultadoConsulta = (c: CuboLinha) => {
    if (!linhasConsulta.has(c.id)) {
      linhasConsulta.set(
        c.id,
        paramsDo(c).then((fs) => executarConsulta({ id: c.consulta_id, sql: c.sql }, valoresParaParametros(fs, valores))),
      );
    }
    return linhasConsulta.get(c.id)!;
  };

  const distintos = (c: CuboLinha, coluna: string, conds: Cond[]) => {
    const k = JSON.stringify([c.id, coluna, conds]);
    if (!chaves.has(k)) {
      chaves.set(
        k,
        (async () => {
          if (c.tabela) return distintosDaTabela(c.tabela, c.colunas, coluna, conds, MAX_CHAVES);
          const r = await resultadoConsulta(c);
          return [...new Set(filtrarPorConds(r.linhas, conds).map((l) => l[coluna]).filter((v) => v !== null && v !== undefined))];
        })(),
      );
    }
    return chaves.get(k)!;
  };

  return { resultadoConsulta, distintos };
}

/**
 * Condição que um filtro do topo impõe ao cubo `alvo`: direta, se o filtro é do próprio
 * cubo; senão, atravessando as ligações. undefined = não há caminho até o cubo do filtro.
 */
async function restricao(
  ctx: ReturnType<typeof contexto>,
  cubos: Map<number, CuboLinha>,
  ligs: Ligacao[],
  f: FiltroTopo,
  cond: Cond,
  alvo: number,
): Promise<Cond | undefined> {
  const passos = caminho(ligs, f.cuboId, alvo);
  if (!passos) return undefined;
  let atual = cond;
  for (const passo of passos) {
    const origem = cubos.get(passo.de.cuboId)!;
    const destinoCol = cubos.get(passo.para.cuboId)!.colunas.find((c) => c.nome === passo.para.coluna);
    // A ligação é a própria coluna filtrada: a condição passa igual (sem buscar chaves)
    if (atual.coluna === passo.de.coluna && (atual.tipo === 'em' || destinoCol?.tipo === 'data')) {
      atual = { ...atual, coluna: passo.para.coluna };
      continue;
    }
    const valores = (await ctx.distintos(origem, passo.de.coluna, [atual])) as (string | number)[];
    if (valores.length > MAX_CHAVES) {
      throw new Error(`O filtro "${f.nome}" deixa valores demais de ${passo.de.coluna} para passar de ${origem.nome} para os outros cubos. Escolha um filtro mais restrito.`);
    }
    atual = { coluna: passo.para.coluna, tipo: 'em', valores };
  }
  return atual;
}

/**
 * Calcula os visuais de uma análise com os filtros escolhidos.
 * O erro de um visual não derruba os outros.
 */
export async function calcularAnalise(
  cubos: Map<number, CuboLinha>,
  visuais: VisualDaAnalise[],
  filtrosTopo: FiltroTopo[],
  cfg: LigacoesCfg,
  valores: Record<string, unknown>,
) {
  const ligs = ligacoesEfetivas([...cubos.values()], cfg);
  const ctx = contexto(cubos, valores);
  const ativos = filtrosTopo.map((f) => ({ f, cond: condicaoDoFiltro(f, valores) })).filter((x): x is { f: FiltroTopo; cond: Cond } => !!x.cond);

  return Promise.all(
    visuais.map(async (v, i) => {
      try {
        const c = cubos.get(v.cuboId);
        if (!c) return { id: i, erro: 'O cubo deste visual não está disponível.' };
        const conds: Cond[] = [];
        const ignorados: FiltroTopo[] = [];
        for (const { f, cond } of ativos) {
          const r = await restricao(ctx, cubos, ligs, f, cond, c.id);
          if (r) conds.push(r);
          else ignorados.push(f);
        }
        let dados: any;
        let geradoEm: string;
        if (c.tabela) {
          const r = await calcularVisualDaTabela(c.tabela, c.colunas, v, conds);
          dados = r.dados;
          geradoEm = r.geradoEm;
        } else {
          const r = await ctx.resultadoConsulta(c);
          const problema = conferirColunas(v, r.colunas);
          if (problema) return { id: i, erro: problema };
          dados = calcularVisual(v, { ...r, linhas: filtrarPorConds(r.linhas, conds) });
          geradoEm = r.geradoEm;
        }
        if (ignorados.length && dados && typeof dados === 'object') {
          // Agrupa por cubo de origem: "Os filtros "Ano", "Mês" não valem aqui: Veículos não está ligado a Manutenção."
          const porCubo = new Map<number, string[]>();
          for (const f of ignorados) porCubo.set(f.cuboId, [...(porCubo.get(f.cuboId) ?? []), `"${f.nome}"`]);
          const aviso = [...porCubo.entries()]
            .map(([cuboId, nomes]) => `${nomes.length === 1 ? 'O filtro' : 'Os filtros'} ${nomes.join(', ')} não ${nomes.length === 1 ? 'vale' : 'valem'} aqui: ${c.nome} não está ligado a ${cubos.get(cuboId)?.nome ?? 'o cubo do filtro'}.`)
            .join(' ');
          dados = { ...dados, aviso: dados.aviso ? `${dados.aviso} ${aviso}` : aviso };
        }
        return { id: i, dados, geradoEm };
      } catch (e) {
        const pg = e as { code?: string; message?: string };
        return { id: i, erro: pg.code === '42P01' ? 'A tabela da ação ainda não existe. Rode a tarefa que carrega essa ação.' : (pg.message ?? 'Erro ao calcular.') };
      }
    }),
  );
}

/* ---------- Barra de filtros ---------- */

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

const textoOpcao = (v: unknown) => (typeof v === 'number' ? v.toLocaleString('pt-BR') : String(v));

/** Opções de um filtro do topo, tiradas dos próprios dados do cubo. */
async function opcoesTopo(f: FiltroTopo, c: CuboLinha, valores: Record<string, unknown>) {
  if (f.tipo === 'periodo') return null;
  if (f.tipo === 'mes') return MESES.map((m, i) => ({ codigo: i + 1, descricao: m }));
  if (c.tabela) {
    if (f.tipo === 'ano') return (await anosDaTabela(c.tabela, f.coluna)).map((a) => ({ codigo: a, descricao: String(a) }));
    const vs = await distintosDaTabela(c.tabela, c.colunas, f.coluna, [], MAX_OPCOES);
    return vs.slice(0, MAX_OPCOES).map((v) => ({ codigo: String(v), descricao: textoOpcao(v) }));
  }
  const r = await contexto(new Map([[c.id, c]]), valores).resultadoConsulta(c);
  if (f.tipo === 'ano') {
    const anos = [...new Set(r.linhas.map((l) => Number(String(l[f.coluna] ?? '').slice(0, 4))).filter((a) => a > 1900))].sort((a, b) => b - a);
    return anos.map((a) => ({ codigo: a, descricao: String(a) }));
  }
  const vs = [...new Set(r.linhas.map((l) => l[f.coluna]).filter((v) => v !== null && v !== undefined && v !== ''))];
  vs.sort((a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), 'pt-BR', { numeric: true })));
  return vs.slice(0, MAX_OPCOES).map((v) => ({ codigo: String(v), descricao: textoOpcao(v) }));
}

/** Id numérico (só para a tela) dos filtros do topo na barra. */
const ID_BASE_TOPO = 900_000;

/**
 * Barra de filtros da análise: os filtros cadastrados que as consultas dos cubos usam
 * (cubos de consulta) e os filtros do topo criados na própria análise.
 */
export async function barraDeFiltros(cubos: Map<number, CuboLinha>, filtrosTopo: FiltroTopo[], valores: Record<string, unknown> = {}) {
  const cadastrados = new Map<number, Filtro>();
  for (const c of cubos.values()) for (const f of await filtrosDoCubo(c)) cadastrados.set(f.id, f);
  const doTopo = await Promise.all(
    filtrosTopo.map(async (f, i) => {
      const c = cubos.get(f.cuboId)!;
      let opcoes = null;
      let erro = null;
      try {
        opcoes = await opcoesTopo(f, c, valores);
      } catch (e) {
        erro = `Não foi possível carregar as opções: ${(e as Error).message}`;
      }
      return {
        id: ID_BASE_TOPO + i,
        nome: f.nome,
        parametro: parametroTopo(f),
        tipo: f.tipo === 'valores' ? 'select' : f.tipo,
        multiplo: f.tipo === 'valores' ? f.multiplo : false,
        padrao: padraoTopo(f),
        opcoes,
        erro,
      };
    }),
  );
  return [...(await filtrosComOpcoes([...cadastrados.values()])), ...doTopo];
}

/** Ligações com os nomes, para mostrar na tela. */
export function ligacoesParaTela(cubos: Map<number, CuboLinha>, cfg: LigacoesCfg) {
  return ligacoesEfetivas([...cubos.values()], cfg).map((l) => ({ ...l, aNome: cubos.get(l.a.cuboId)?.nome, bNome: cubos.get(l.b.cuboId)?.nome }));
}

