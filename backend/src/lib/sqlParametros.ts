/**
 * Parâmetros nos SQLs das ações: sempre no formato @nome.
 * O valor nunca é colado no texto do SQL; ele vai separado, já no tipo certo.
 */

export type TipoParametro = 'texto' | 'numero' | 'data';

export interface ValorParametro {
  tipo: TipoParametro;
  valor: string | number | Date | null | (string | number)[];
  /** Tipo explícito no PostgreSQL (ex.: date, integer, text[]); vira $n::tipo, inclusive para NULL. */
  pgTipo?: string;
}

const NOME_PARAM = /^[A-Za-z_][A-Za-z0-9_]*/;

/**
 * Converte a sintaxe da ferramenta antiga para a nova:
 * '$[ANOMES_INI]' e $[ANOMES_INI] viram @ANOMES_INI (as aspas deixam de ser necessárias).
 */
export function converterParametrosLegados(sql: string) {
  let convertidos = 0;
  const texto = sql
    .replace(/'\$\[([A-Za-z_][A-Za-z0-9_]*)\]'/g, (_m, nome) => {
      convertidos++;
      return `@${nome}`;
    })
    .replace(/\$\[([A-Za-z_][A-Za-z0-9_]*)\]/g, (_m, nome) => {
      convertidos++;
      return `@${nome}`;
    });
  return { texto, convertidos };
}

export interface Trecho {
  tipo: 'codigo' | 'literal';
  texto: string;
}

/** Separa o SQL em código e literais/comentários, para só mexer em @nome fora de strings. */
export function separar(sql: string, dialeto: 'tsql' | 'pg' = 'tsql'): Trecho[] {
  const trechos: Trecho[] = [];
  let i = 0;
  let inicioCodigo = 0;
  const fecharCodigo = (ate: number) => {
    if (ate > inicioCodigo) trechos.push({ tipo: 'codigo', texto: sql.slice(inicioCodigo, ate) });
  };
  while (i < sql.length) {
    const c = sql[i];
    const prox = sql[i + 1];
    let fim = -1;
    if (c === "'") {
      fim = i + 1;
      while (fim < sql.length) {
        if (sql[fim] === "'" && sql[fim + 1] === "'") fim += 2;
        else if (sql[fim] === "'") break;
        else fim++;
      }
      fim = Math.min(fim + 1, sql.length);
    } else if (c === '"' || (c === '[' && dialeto === 'tsql')) {
      const fecha = c === '"' ? '"' : ']';
      fim = sql.indexOf(fecha, i + 1);
      fim = fim === -1 ? sql.length : fim + 1;
    } else if (c === '$' && dialeto === 'pg' && /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.test(sql.slice(i))) {
      // Texto entre $$ ... $$ (ou $tag$ ... $tag$) no PostgreSQL
      const tag = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i))![0];
      fim = sql.indexOf(tag, i + tag.length);
      fim = fim === -1 ? sql.length : fim + tag.length;
    } else if (c === '-' && prox === '-') {
      fim = sql.indexOf('\n', i);
      fim = fim === -1 ? sql.length : fim;
    } else if (c === '/' && prox === '*') {
      fim = sql.indexOf('*/', i + 2);
      fim = fim === -1 ? sql.length : fim + 2;
    }
    if (fim !== -1) {
      fecharCodigo(i);
      trechos.push({ tipo: 'literal', texto: sql.slice(i, fim) });
      i = fim;
      inicioCodigo = i;
    } else {
      i++;
    }
  }
  fecharCodigo(sql.length);
  return trechos;
}

/** Percorre os @nome do código (ignora @@VERSION e afins). */
function substituirParametros(codigo: string, fn: (nome: string) => string) {
  let saida = '';
  let i = 0;
  while (i < codigo.length) {
    if (codigo[i] === '@' && codigo[i + 1] !== '@' && codigo[i - 1] !== '@') {
      const m = NOME_PARAM.exec(codigo.slice(i + 1));
      if (m) {
        saida += fn(m[0]);
        i += 1 + m[0].length;
        continue;
      }
    }
    saida += codigo[i];
    i++;
  }
  return saida;
}

/** Nomes de parâmetros usados no SQL (sem repetição, na ordem em que aparecem). */
export function parametrosUsados(sql: string, dialeto: 'tsql' | 'pg' = 'tsql'): string[] {
  const nomes: string[] = [];
  for (const t of separar(sql, dialeto)) {
    if (t.tipo !== 'codigo') continue;
    substituirParametros(t.texto, (nome) => {
      if (!nomes.some((n) => n.toLowerCase() === nome.toLowerCase())) nomes.push(nome);
      return '';
    });
  }
  return nomes;
}

/**
 * Traduz @nome para $1, $2… (formato do PostgreSQL) e devolve os valores na ordem.
 * Lança erro claro se o SQL usar um parâmetro que a tarefa não definiu.
 */
export function paraPostgres(
  sql: string,
  valores: Record<string, ValorParametro>,
  faltando = (nome: string) => `O parâmetro @${nome} é usado no SQL, mas não está definido na tarefa.`,
) {
  const porNome = new Map(Object.entries(valores).map(([k, v]) => [k.toLowerCase(), v]));
  const ordem: string[] = [];
  const params: unknown[] = [];
  const texto = separar(sql, 'pg')
    .map((t) =>
      t.tipo === 'literal'
        ? t.texto
        : substituirParametros(t.texto, (nome) => {
            const chave = nome.toLowerCase();
            const v = porNome.get(chave);
            if (!v) throw new Error(faltando(nome));
            let pos = ordem.indexOf(chave);
            if (pos === -1) {
              ordem.push(chave);
              params.push(v.valor);
              pos = ordem.length - 1;
            }
            return v.pgTipo ? `($${pos + 1}::${v.pgTipo})` : `$${pos + 1}`;
          }),
    )
    .join('');
  return { texto, params };
}

/** Converte o texto de um valor fixo para o tipo do parâmetro. */
export function converterValor(tipo: TipoParametro, bruto: unknown): string | number | Date | null {
  if (bruto === null || bruto === undefined || bruto === '') return null;
  if (tipo === 'numero') {
    const n = typeof bruto === 'number' ? bruto : Number(String(bruto).replace(',', '.'));
    if (!Number.isFinite(n)) throw new Error(`"${bruto}" não é um número válido.`);
    return n;
  }
  if (tipo === 'data') {
    if (bruto instanceof Date) return bruto;
    const s = String(bruto).trim();
    // Datas sempre em "horário de parede" (sem fuso), guardadas como UTC para não deslocar horas
    // entre SQL Server, Node e PostgreSQL. Aceita AAAA-MM-DD[ HH:MM[:SS]] e DD/MM/AAAA.
    const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
    const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
    let d: Date | null = null;
    if (br) d = new Date(Date.UTC(+br[3], +br[2] - 1, +br[1]));
    else if (iso) d = new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3], +(iso[4] ?? 0), +(iso[5] ?? 0), +(iso[6] ?? 0)));
    if (!d || Number.isNaN(d.getTime())) throw new Error(`"${bruto}" não é uma data válida (use AAAA-MM-DD ou DD/MM/AAAA).`);
    return d;
  }
  return bruto instanceof Date ? bruto.toISOString() : String(bruto);
}

/** Texto amigável de um valor, para o log. */
export function exibirValor(v: ValorParametro['valor']) {
  if (v === null) return '(vazio)';
  if (v instanceof Date) return v.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '').replace(/ 00:00:00$/, '');
  return String(v);
}

/* ---------- Análise de comandos (Console SQL) ---------- */

export type TipoComando = 'consulta' | 'insercao' | 'alteracao' | 'exclusao' | 'estrutura' | 'outro';

/** Só o código, sem literais nem comentários, em maiúsculas e com espaços simples. */
export function codigoSemLiterais(sql: string, dialeto: 'tsql' | 'pg') {
  return separar(sql, dialeto)
    .map((t) => (t.tipo === 'codigo' ? t.texto : ' '))
    .join('')
    .replace(/\s+/g, ' ')
    .toUpperCase()
    .trim();
}

/** Comandos separados por ";" (fora de literais). Vazios são descartados. */
export function contarComandos(sql: string, dialeto: 'tsql' | 'pg') {
  return codigoSemLiterais(sql, dialeto)
    .split(';')
    .map((c) => c.trim())
    .filter(Boolean);
}

export function tipoDoComando(palavra: string): TipoComando {
  const p = palavra.toUpperCase();
  if (['SELECT', 'WITH', 'TABLE', 'VALUES', 'SHOW', 'EXPLAIN'].includes(p)) return 'consulta';
  if (p === 'INSERT' || p === 'COPY') return 'insercao';
  if (p === 'UPDATE' || p === 'MERGE') return 'alteracao';
  if (p === 'DELETE') return 'exclusao';
  if (['CREATE', 'DROP', 'ALTER', 'TRUNCATE', 'COMMENT', 'GRANT', 'REVOKE', 'REINDEX', 'CLUSTER', 'REFRESH'].includes(p)) return 'estrutura';
  return 'outro';
}

/** Tipo que resume uma execução com um ou mais comandos (o "mais forte" vence). */
export function tipoGeral(tipos: TipoComando[]): TipoComando {
  const ordem: TipoComando[] = ['estrutura', 'exclusao', 'alteracao', 'insercao', 'outro', 'consulta'];
  return ordem.find((t) => tipos.includes(t)) ?? 'outro';
}

/**
 * Tabelas que um comando apaga, esvazia, altera ou da qual remove/modifica linhas.
 * Usado para avisar quando a tabela é destino de uma ação ou usada por um painel.
 */
export function tabelasAfetadas(sql: string): { acao: string; tabela: string }[] {
  const codigo = separar(sql, 'pg')
    .map((t) => (t.tipo === 'codigo' ? t.texto : ' '))
    .join('');
  const nome = String.raw`"?[A-Za-z_][\w$]*"?(?:\s*\.\s*"?[A-Za-z_][\w$]*"?)?`;
  const padroes: [RegExp, string][] = [
    [new RegExp(String.raw`\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(${nome}(?:\s*,\s*${nome})*)`, 'gi'), 'DROP'],
    [new RegExp(String.raw`\bTRUNCATE\s+(?:TABLE\s+)?(?:ONLY\s+)?(${nome}(?:\s*,\s*${nome})*)`, 'gi'), 'TRUNCATE'],
    [new RegExp(String.raw`\bDELETE\s+FROM\s+(?:ONLY\s+)?(${nome})`, 'gi'), 'DELETE'],
    [new RegExp(String.raw`\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(${nome})`, 'gi'), 'ALTER'],
    [new RegExp(String.raw`\bUPDATE\s+(?:ONLY\s+)?(${nome})`, 'gi'), 'UPDATE'],
  ];
  const achados: { acao: string; tabela: string }[] = [];
  for (const [re, acao] of padroes) {
    for (const m of codigo.matchAll(re)) {
      for (const parte of m[1].split(',')) {
        const t = parte.replace(/["\s]/g, '').toLowerCase();
        const completo = t.includes('.') ? t : `public.${t}`;
        if (!achados.some((a) => a.acao === acao && a.tabela === completo)) achados.push({ acao, tabela: completo });
      }
    }
  }
  return achados;
}
