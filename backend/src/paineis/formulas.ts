/* =========================================================
   Colunas calculadas dos visuais (fórmulas no estilo do Excel).

   Exemplos:
     [quantidade] * [valor_unitario]                       → por linha
     SE([situacao] = "Atrasado"; 1; 0)                    → por linha
     SOMA([quantidade]; [processo] = "X") / SOMA([quantidade]) * 100   → agregada (medida)

   - Colunas entre colchetes; textos entre aspas; argumentos separados por ";".
   - Fórmula com SOMA, MEDIA, MINIMO, MAXIMO, CONTAR ou CONTAR_DISTINTOS é uma
     medida: calculada por grupo (categoria do gráfico) ou no total (indicador),
     sempre depois dos filtros do painel e do visual.
   - A fórmula vira uma árvore; o SQL é montado a partir dela, com as colunas
     conferidas e os valores como parâmetros. Texto da fórmula nunca entra no SQL.
   ========================================================= */

export type TipoValor = 'numero' | 'texto' | 'data' | 'logico';

export type No =
  | { t: 'num'; v: number }
  | { t: 'txt'; v: string }
  | { t: 'col'; nome: string }
  | { t: 'bin'; op: string; a: No; b: No }
  | { t: 'nao'; a: No }
  | { t: 'neg'; a: No }
  | { t: 'fn'; nome: string; args: No[] };

export class ErroFormula extends Error {}

const AGREGADAS = ['SOMA', 'MEDIA', 'MINIMO', 'MAXIMO', 'CONTAR', 'CONTAR_DISTINTOS'] as const;
const DE_LINHA = ['SE', 'ARRED', 'ABS', 'ANO', 'MES', 'DIA', 'SENULO'] as const;
export const FUNCOES = [...AGREGADAS, ...DE_LINHA];
const ehAgregada = (n: string) => (AGREGADAS as readonly string[]).includes(n);

/* ---------- Leitura ---------- */

type Token = { k: 'num' | 'txt' | 'col' | 'id' | 'op' | 'sep' | 'abre' | 'fecha'; v: string; pos: number };

function tokens(texto: string): Token[] {
  const s = texto;
  const saida: Token[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '[') {
      const fim = s.indexOf(']', i);
      if (fim < 0) throw new ErroFormula('Falta fechar o colchete de uma coluna: "]".');
      const nome = s.slice(i + 1, fim).trim();
      if (!nome) throw new ErroFormula('Há uma coluna vazia: "[]".');
      saida.push({ k: 'col', v: nome, pos: i });
      i = fim + 1;
      continue;
    }
    if (c === '"' || c === "'") {
      const fim = s.indexOf(c, i + 1);
      if (fim < 0) throw new ErroFormula(`Falta fechar as aspas de um texto: ${c}.`);
      saida.push({ k: 'txt', v: s.slice(i + 1, fim), pos: i });
      i = fim + 1;
      continue;
    }
    // Número: 10, 10.5 ou 10,5 (vírgula decimal, como no Brasil)
    const n = /^\d+(?:[.,]\d+)?/.exec(s.slice(i));
    if (n) {
      saida.push({ k: 'num', v: n[0].replace(',', '.'), pos: i });
      i += n[0].length;
      continue;
    }
    const id = /^[A-Za-zÀ-ÿ_][A-Za-zÀ-ÿ0-9_]*/.exec(s.slice(i));
    if (id) {
      saida.push({ k: 'id', v: id[0].toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, ''), pos: i });
      i += id[0].length;
      continue;
    }
    const op = /^(<>|!=|>=|<=|[+\-*/=<>])/.exec(s.slice(i));
    if (op) {
      saida.push({ k: 'op', v: op[0] === '!=' ? '<>' : op[0], pos: i });
      i += op[0].length;
      continue;
    }
    if (c === ';' || c === ',') {
      saida.push({ k: 'sep', v: ';', pos: i });
      i++;
      continue;
    }
    if (c === '(' || c === ')') {
      saida.push({ k: c === '(' ? 'abre' : 'fecha', v: c, pos: i });
      i++;
      continue;
    }
    throw new ErroFormula(`Caractere inesperado "${c}" na posição ${i + 1}.`);
  }
  return saida;
}

export function lerFormula(texto: string): No {
  if (!texto.trim()) throw new ErroFormula('Escreva a fórmula.');
  if (texto.length > 1000) throw new ErroFormula('A fórmula pode ter até 1.000 caracteres.');
  const t = tokens(texto);
  let i = 0;
  const ver = () => t[i];
  const pegar = () => t[i++];
  const esperar = (k: Token['k'], o: string) => {
    if (ver()?.k !== k) throw new ErroFormula(`Esperava ${o}${ver() ? ` antes de "${ver().v}"` : ' no fim da fórmula'}.`);
    return pegar();
  };

  const ou = (): No => {
    let a = e();
    while (ver()?.k === 'id' && ver().v === 'OU') {
      pegar();
      a = { t: 'bin', op: 'OU', a, b: e() };
    }
    return a;
  };
  const e = (): No => {
    let a = nao();
    while (ver()?.k === 'id' && ver().v === 'E') {
      pegar();
      a = { t: 'bin', op: 'E', a, b: nao() };
    }
    return a;
  };
  const nao = (): No => {
    if (ver()?.k === 'id' && ver().v === 'NAO') {
      pegar();
      return { t: 'nao', a: nao() };
    }
    return comparacao();
  };
  const comparacao = (): No => {
    const a = soma();
    if (ver()?.k === 'op' && ['=', '<>', '>', '<', '>=', '<='].includes(ver().v)) {
      const op = pegar().v;
      return { t: 'bin', op, a, b: soma() };
    }
    return a;
  };
  const soma = (): No => {
    let a = produto();
    while (ver()?.k === 'op' && (ver().v === '+' || ver().v === '-')) {
      const op = pegar().v;
      a = { t: 'bin', op, a, b: produto() };
    }
    return a;
  };
  const produto = (): No => {
    let a = unario();
    while (ver()?.k === 'op' && (ver().v === '*' || ver().v === '/')) {
      const op = pegar().v;
      a = { t: 'bin', op, a, b: unario() };
    }
    return a;
  };
  const unario = (): No => {
    if (ver()?.k === 'op' && ver().v === '-') {
      pegar();
      return { t: 'neg', a: unario() };
    }
    return primario();
  };
  const primario = (): No => {
    const tk = ver();
    if (!tk) throw new ErroFormula('A fórmula terminou antes do esperado.');
    if (tk.k === 'num') return pegar(), { t: 'num', v: Number(tk.v) };
    if (tk.k === 'txt') return pegar(), { t: 'txt', v: tk.v };
    if (tk.k === 'col') return pegar(), { t: 'col', nome: tk.v };
    if (tk.k === 'abre') {
      pegar();
      const x = ou();
      esperar('fecha', '")"');
      return x;
    }
    if (tk.k === 'id') {
      pegar();
      if (!FUNCOES.includes(tk.v as any)) {
        throw new ErroFormula(`Não conheço "${tk.v}". Colunas vão entre colchetes, como [quantidade]; funções: ${FUNCOES.join(', ')}.`);
      }
      esperar('abre', `"(" depois de ${tk.v}`);
      const args: No[] = [];
      if (ver()?.k !== 'fecha') {
        args.push(ou());
        while (ver()?.k === 'sep') {
          pegar();
          args.push(ou());
        }
      }
      esperar('fecha', `")" para fechar ${tk.v}`);
      return { t: 'fn', nome: tk.v, args };
    }
    throw new ErroFormula(`"${tk.v}" está fora do lugar.`);
  };

  const raiz = ou();
  if (i < t.length) throw new ErroFormula(`"${t[i].v}" está sobrando na fórmula.`);
  return raiz;
}

/* ---------- Conferência ---------- */

export interface ColunaConhecida {
  nome: string;
  tipo: TipoValor | string;
  /** Nome que o usuário conhece (descrição no cubo) */
  descricao?: string | null;
}

const normal = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLocaleLowerCase('pt-BR');

export interface Analise {
  agregada: boolean;
  tipo: 'numero' | 'texto' | 'data';
  colunas: string[];
  /** Árvore com as colunas já no nome técnico */
  arvore: No;
}

const ARIDADE: Record<string, [number, number]> = {
  SOMA: [1, 2],
  MEDIA: [1, 2],
  MINIMO: [1, 2],
  MAXIMO: [1, 2],
  CONTAR: [0, 1],
  CONTAR_DISTINTOS: [1, 2],
  SE: [3, 3],
  ARRED: [1, 2],
  ABS: [1, 1],
  ANO: [1, 1],
  MES: [1, 1],
  DIA: [1, 1],
  SENULO: [2, 2],
};

/**
 * Confere a fórmula contra as colunas: existência (pelo nome técnico ou pela descrição),
 * tipos, funções e mistura de linha com agregado. Devolve o tipo do resultado.
 */
export function analisarFormula(texto: string, colunas: ColunaConhecida[]): Analise {
  const raiz = lerFormula(texto);
  const usadas = new Set<string>();
  let temAgregada = false;

  const acharColuna = (nome: string) => {
    const n = normal(nome);
    return colunas.find((c) => normal(c.nome) === n) ?? colunas.find((c) => c.descricao && normal(c.descricao) === n);
  };

  /** Tipo do nó; dentroAgregada = já está dentro de SOMA(...) etc. */
  const tipoDe = (no: No, dentroAgregada: boolean): { tipo: TipoValor; no: No; agreg: boolean } => {
    switch (no.t) {
      case 'num':
        return { tipo: 'numero', no, agreg: false };
      case 'txt':
        return { tipo: 'texto', no, agreg: false };
      case 'col': {
        const c = acharColuna(no.nome);
        if (!c) throw new ErroFormula(`A coluna [${no.nome}] não existe. Use o nome que aparece na lista de colunas.`);
        usadas.add(c.nome);
        const tipo: TipoValor = c.tipo === 'numero' || c.tipo === 'data' ? c.tipo : 'texto';
        return { tipo, no: { t: 'col', nome: c.nome }, agreg: false };
      }
      case 'neg': {
        const a = tipoDe(no.a, dentroAgregada);
        if (a.tipo !== 'numero') throw new ErroFormula('O sinal de menos só vale para números.');
        return { tipo: 'numero', no: { t: 'neg', a: a.no }, agreg: a.agreg };
      }
      case 'nao': {
        const a = tipoDe(no.a, dentroAgregada);
        if (a.tipo !== 'logico') throw new ErroFormula('NAO precisa de uma condição, como NAO([situacao] = "Pago").');
        return { tipo: 'logico', no: { t: 'nao', a: a.no }, agreg: a.agreg };
      }
      case 'bin': {
        const a = tipoDe(no.a, dentroAgregada);
        const b = tipoDe(no.b, dentroAgregada);
        const nn = { t: 'bin' as const, op: no.op, a: a.no, b: b.no };
        const agreg = a.agreg || b.agreg;
        if (['+', '-', '*', '/'].includes(no.op)) {
          if (a.tipo !== 'numero' || b.tipo !== 'numero') throw new ErroFormula(`"${no.op}" só vale entre números.`);
          return { tipo: 'numero', no: nn, agreg };
        }
        if (no.op === 'E' || no.op === 'OU') {
          if (a.tipo !== 'logico' || b.tipo !== 'logico') throw new ErroFormula(`${no.op} junta duas condições, como [a] > 1 ${no.op} [b] = "X".`);
          return { tipo: 'logico', no: nn, agreg };
        }
        // Comparação
        const comparaveis = a.tipo === b.tipo || (a.tipo === 'data' && b.tipo === 'texto') || (a.tipo === 'texto' && b.tipo === 'data');
        if (!comparaveis) throw new ErroFormula(`Não dá para comparar ${a.tipo} com ${b.tipo} ("${no.op}").`);
        return { tipo: 'logico', no: nn, agreg };
      }
      case 'fn': {
        const [min, max] = ARIDADE[no.nome];
        if (no.args.length < min || no.args.length > max) {
          throw new ErroFormula(`${no.nome} recebe ${min === max ? min : `de ${min} a ${max}`} argumento${max > 1 ? 's' : ''}, separados por ";".`);
        }
        if (ehAgregada(no.nome)) {
          if (dentroAgregada) throw new ErroFormula(`${no.nome} não pode ficar dentro de outra função de agregação.`);
          temAgregada = true;
          const args = no.args.map((x) => tipoDe(x, true));
          const temValor = no.nome !== 'CONTAR';
          if (temValor && ['SOMA', 'MEDIA', 'MINIMO', 'MAXIMO'].includes(no.nome) && args[0].tipo !== 'numero') {
            throw new ErroFormula(`${no.nome} precisa de um número, como ${no.nome}([quantidade]).`);
          }
          const cond = temValor ? args[1] : args[0];
          if (cond && cond.tipo !== 'logico') throw new ErroFormula(`O último argumento de ${no.nome} é uma condição, como [processo] = "X".`);
          return { tipo: 'numero', no: { t: 'fn', nome: no.nome, args: args.map((x) => x.no) }, agreg: true };
        }
        const args = no.args.map((x) => tipoDe(x, dentroAgregada));
        const agreg = args.some((x) => x.agreg);
        const fn = { t: 'fn' as const, nome: no.nome, args: args.map((x) => x.no) };
        switch (no.nome) {
          case 'SE':
            if (args[0].tipo !== 'logico') throw new ErroFormula('O primeiro argumento de SE é uma condição, como SE([qtd] > 10; "Alto"; "Baixo").');
            if (args[1].tipo !== args[2].tipo) throw new ErroFormula('Os dois resultados de SE precisam ser do mesmo tipo (os dois números ou os dois textos).');
            return { tipo: args[1].tipo, no: fn, agreg };
          case 'ARRED':
          case 'ABS':
            if (args.some((x) => x.tipo !== 'numero')) throw new ErroFormula(`${no.nome} só vale para números.`);
            return { tipo: 'numero', no: fn, agreg };
          case 'ANO':
          case 'MES':
          case 'DIA':
            if (args[0].tipo !== 'data') throw new ErroFormula(`${no.nome} precisa de uma coluna de data.`);
            return { tipo: 'numero', no: fn, agreg };
          default: // SENULO
            if (args[0].tipo !== args[1].tipo) throw new ErroFormula('SENULO precisa de dois valores do mesmo tipo.');
            return { tipo: args[0].tipo, no: fn, agreg };
        }
      }
    }
  };

  const r = tipoDe(raiz, false);
  if (r.tipo === 'logico') throw new ErroFormula('A fórmula é só uma condição. Para virar valor, use SE(condição; 1; 0) ou CONTAR(condição).');
  // Fórmula agregada não pode ter coluna solta fora das funções (ex.: [a] + SOMA([b]))
  if (temAgregada) {
    const solta = (no: No): boolean =>
      no.t === 'col' ||
      (no.t === 'bin' && (solta(no.a) || solta(no.b))) ||
      ((no.t === 'nao' || no.t === 'neg') && solta(no.a)) ||
      (no.t === 'fn' && !ehAgregada(no.nome) && no.args.some(solta));
    if (solta(r.no)) throw new ErroFormula('Numa fórmula com SOMA, MEDIA, CONTAR…, toda coluna precisa estar dentro de uma dessas funções.');
  }
  return { agregada: temAgregada, tipo: r.tipo as Analise['tipo'], colunas: [...usadas], arvore: r.no };
}

/* ---------- Cálculo em memória (consultas de painel e cubos de consulta) ---------- */

const dataIso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v ?? ''));
const ehNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function comparar(op: string, a: unknown, b: unknown): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  let x: unknown = a;
  let y: unknown = b;
  if (!ehNum(x) || !ehNum(y)) {
    x = normal(String(x));
    y = normal(String(y));
  }
  switch (op) {
    case '=':
      return x === y;
    case '<>':
      return x !== y;
    case '>':
      return (x as any) > (y as any);
    case '<':
      return (x as any) < (y as any);
    case '>=':
      return (x as any) >= (y as any);
    default:
      return (x as any) <= (y as any);
  }
}

export function avaliarLinha(no: No, l: Record<string, unknown>): unknown {
  switch (no.t) {
    case 'num':
    case 'txt':
      return no.v;
    case 'col': {
      const v = l[no.nome];
      return typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v ?? null;
    }
    case 'neg': {
      const a = avaliarLinha(no.a, l);
      return ehNum(a) ? -a : null;
    }
    case 'nao':
      return !avaliarLinha(no.a, l);
    case 'bin': {
      if (no.op === 'E') return !!avaliarLinha(no.a, l) && !!avaliarLinha(no.b, l);
      if (no.op === 'OU') return !!avaliarLinha(no.a, l) || !!avaliarLinha(no.b, l);
      const a = avaliarLinha(no.a, l);
      const b = avaliarLinha(no.b, l);
      if (['+', '-', '*', '/'].includes(no.op)) {
        if (!ehNum(a) || !ehNum(b)) return null;
        if (no.op === '/') return b === 0 ? null : a / b;
        return no.op === '+' ? a + b : no.op === '-' ? a - b : a * b;
      }
      return comparar(no.op, a, b);
    }
    case 'fn': {
      const arg = (i: number) => avaliarLinha(no.args[i], l);
      switch (no.nome) {
        case 'SE':
          return arg(0) ? arg(1) : arg(2);
        case 'ARRED': {
          const x = arg(0);
          const casas = no.args[1] ? Number(arg(1)) || 0 : 0;
          return ehNum(x) ? Math.round(x * 10 ** casas) / 10 ** casas : null;
        }
        case 'ABS': {
          const x = arg(0);
          return ehNum(x) ? Math.abs(x) : null;
        }
        case 'ANO':
        case 'MES':
        case 'DIA': {
          const d = dataIso(arg(0));
          if (!/^\d{4}-\d{2}-\d{2}/.test(d)) return null;
          return Number(no.nome === 'ANO' ? d.slice(0, 4) : no.nome === 'MES' ? d.slice(5, 7) : d.slice(8, 10));
        }
        case 'SENULO': {
          const x = arg(0);
          return x === null || x === undefined || x === '' ? arg(1) : x;
        }
        default:
          throw new ErroFormula(`${no.nome} só vale numa fórmula agregada.`);
      }
    }
  }
}

/** Fórmula agregada sobre um grupo de linhas (o total do indicador ou uma categoria do gráfico). */
export function avaliarAgregada(no: No, linhas: Record<string, unknown>[]): number | null {
  const valor = (n: No): unknown => {
    switch (n.t) {
      case 'num':
      case 'txt':
        return n.v;
      case 'neg': {
        const a = valor(n.a);
        return ehNum(a) ? -a : null;
      }
      case 'bin': {
        const a = valor(n.a);
        const b = valor(n.b);
        if (!ehNum(a) || !ehNum(b)) return null;
        if (n.op === '/') return b === 0 ? null : a / b;
        if (n.op === '+') return a + b;
        if (n.op === '-') return a - b;
        if (n.op === '*') return a * b;
        return comparar(n.op, a, b) ? 1 : 0;
      }
      case 'fn': {
        if (!ehAgregada(n.nome)) {
          const args = n.args.map(valor);
          if (n.nome === 'ARRED') return ehNum(args[0]) ? Math.round(args[0] * 10 ** (Number(args[1]) || 0)) / 10 ** (Number(args[1]) || 0) : null;
          if (n.nome === 'ABS') return ehNum(args[0]) ? Math.abs(args[0]) : null;
          if (n.nome === 'SENULO') return args[0] ?? args[1];
          if (n.nome === 'SE') return args[0] ? args[1] : args[2];
          return null;
        }
        const temValor = n.nome !== 'CONTAR';
        const cond = temValor ? n.args[1] : n.args[0];
        const doGrupo = cond ? linhas.filter((l) => !!avaliarLinha(cond, l)) : linhas;
        if (n.nome === 'CONTAR') return doGrupo.length;
        const vals = doGrupo.map((l) => avaliarLinha(n.args[0], l)).filter((v) => v !== null && v !== undefined && v !== '');
        if (n.nome === 'CONTAR_DISTINTOS') return new Set(vals.map((v) => (ehNum(v) ? v : normal(String(v))))).size;
        const nums = vals.filter(ehNum);
        if (!nums.length) return null;
        if (n.nome === 'SOMA') return nums.reduce((s, x) => s + x, 0);
        if (n.nome === 'MEDIA') return nums.reduce((s, x) => s + x, 0) / nums.length;
        if (n.nome === 'MINIMO') return Math.min(...nums);
        return Math.max(...nums);
      }
      default:
        return null;
    }
  };
  const r = valor(no);
  return ehNum(r) ? r : null;
}

/* ---------- SQL (cubos de ação) ---------- */

const SEM_ACENTO = (x: string) => `translate(lower((${x})::text), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc')`;

/**
 * Monta o SQL de uma árvore já conferida. `col` devolve o nome da coluna com aspas;
 * `p` cria um parâmetro ($n). Textos e números da fórmula viram parâmetros.
 */
export function formulaSql(no: No, col: (nome: string) => string, p: (v: unknown) => string, tipoDe: (nome: string) => TipoValor): string {
  const tipo = (n: No): TipoValor => {
    if (n.t === 'num') return 'numero';
    if (n.t === 'txt') return 'texto';
    if (n.t === 'col') return tipoDe(n.nome);
    if (n.t === 'bin') return ['+', '-', '*', '/'].includes(n.op) ? 'numero' : 'logico';
    if (n.t === 'nao') return 'logico';
    if (n.t === 'neg') return 'numero';
    if (n.nome === 'SE' || n.nome === 'SENULO') return tipo(n.args[n.nome === 'SE' ? 1 : 0]);
    return 'numero';
  };
  const s = (n: No): string => {
    switch (n.t) {
      case 'num':
        return `${p(n.v)}::numeric`;
      case 'txt':
        return `${p(n.v)}::text`;
      case 'col':
        return col(n.nome);
      case 'neg':
        return `(-(${s(n.a)}))`;
      case 'nao':
        return `(NOT COALESCE(${s(n.a)}, FALSE))`;
      case 'bin': {
        if (n.op === 'E') return `(COALESCE(${s(n.a)}, FALSE) AND COALESCE(${s(n.b)}, FALSE))`;
        if (n.op === 'OU') return `(COALESCE(${s(n.a)}, FALSE) OR COALESCE(${s(n.b)}, FALSE))`;
        if (n.op === '/') return `((${s(n.a)})::numeric / NULLIF((${s(n.b)})::numeric, 0))`;
        if (['+', '-', '*'].includes(n.op)) return `((${s(n.a)})::numeric ${n.op} (${s(n.b)})::numeric)`;
        const ta = tipo(n.a);
        const tb = tipo(n.b);
        const op = n.op;
        if (ta === 'numero' && tb === 'numero') return `((${s(n.a)})::numeric ${op} (${s(n.b)})::numeric)`;
        if (ta === 'data' || tb === 'data') return `((${s(n.a)})::text ${op} (${s(n.b)})::text)`;
        return `(${SEM_ACENTO(s(n.a))} ${op} ${SEM_ACENTO(s(n.b))})`;
      }
      case 'fn': {
        const a = n.args;
        switch (n.nome) {
          case 'SE':
            return `(CASE WHEN COALESCE(${s(a[0])}, FALSE) THEN ${s(a[1])} ELSE ${s(a[2])} END)`;
          case 'ARRED':
            return `ROUND((${s(a[0])})::numeric, ${a[1] ? `(${s(a[1])})::int` : '0'})`;
          case 'ABS':
            return `ABS((${s(a[0])})::numeric)`;
          case 'ANO':
            return `EXTRACT(YEAR FROM ${s(a[0])})::int`;
          case 'MES':
            return `EXTRACT(MONTH FROM ${s(a[0])})::int`;
          case 'DIA':
            return `EXTRACT(DAY FROM ${s(a[0])})::int`;
          case 'SENULO':
            return `COALESCE(${s(a[0])}, ${s(a[1])})`;
          case 'CONTAR':
            return a[0] ? `COUNT(*) FILTER (WHERE COALESCE(${s(a[0])}, FALSE))` : 'COUNT(*)';
          default: {
            const valor = a[1] ? `CASE WHEN COALESCE(${s(a[1])}, FALSE) THEN ${s(a[0])} END` : s(a[0]);
            const fn = { SOMA: 'SUM', MEDIA: 'AVG', MINIMO: 'MIN', MAXIMO: 'MAX', CONTAR_DISTINTOS: 'COUNT(DISTINCT' }[n.nome]!;
            return n.nome === 'CONTAR_DISTINTOS' ? `COUNT(DISTINCT ${valor})` : `${fn}(${valor})`;
          }
        }
      }
    }
  };
  return s(no);
}

/* ---------- Colunas calculadas de um visual ---------- */

export interface Calculada {
  nome: string;
  rotulo: string;
  formula: string;
}

export interface CalculadaPronta extends Calculada, Analise {}

/**
 * Confere todas as colunas calculadas do visual, na ordem: uma coluna por linha
 * pode usar as anteriores; uma agregada pode usar as por linha.
 */
export function prepararCalculadas(calculadas: Calculada[] | undefined, colunas: ColunaConhecida[]): CalculadaPronta[] {
  const prontas: CalculadaPronta[] = [];
  const disponiveis: ColunaConhecida[] = [...colunas];
  for (const c of calculadas ?? []) {
    let a: Analise;
    try {
      a = analisarFormula(c.formula, disponiveis);
    } catch (e) {
      throw new ErroFormula(`Coluna calculada "${c.rotulo}": ${(e as Error).message}`);
    }
    prontas.push({ ...c, ...a });
    if (!a.agregada) disponiveis.push({ nome: c.nome, tipo: a.tipo, descricao: c.rotulo });
  }
  return prontas;
}

/* ---------- Escrita (fórmula normalizada) ---------- */

const PRECEDENCIA: Record<string, number> = { OU: 1, E: 2, '=': 4, '<>': 4, '>': 4, '<': 4, '>=': 4, '<=': 4, '+': 5, '-': 5, '*': 6, '/': 6 };
const precedencia = (no: No) => (no.t === 'bin' ? PRECEDENCIA[no.op] : no.t === 'nao' ? 3 : 9);

/** Escreve a árvore de volta como texto (colunas no nome técnico, ";" entre argumentos, vírgula decimal) */
export function escreverFormula(no: No): string {
  const w = (n: No, minimo: number, direita = false): string => {
    const s = escreverFormula(n);
    const p = precedencia(n);
    return p < minimo || (direita && p === minimo && n.t === 'bin' && ['-', '/', '=', '<>', '>', '<', '>=', '<='].includes(n.op)) ? `(${s})` : s;
  };
  switch (no.t) {
    case 'num':
      return String(no.v).replace('.', ',');
    case 'txt':
      return no.v.includes('"') ? `'${no.v}'` : `"${no.v}"`;
    case 'col':
      return `[${no.nome}]`;
    case 'neg':
      return `-${w(no.a, 9)}`;
    case 'nao':
      return `NAO ${w(no.a, 3)}`;
    case 'fn':
      return `${no.nome}(${no.args.map(escreverFormula).join('; ')})`;
    case 'bin': {
      const p = PRECEDENCIA[no.op];
      const comp = p === 4;
      return `${w(no.a, comp ? 5 : p)} ${no.op} ${w(no.b, comp ? 5 : p, true)}`;
    }
  }
}
