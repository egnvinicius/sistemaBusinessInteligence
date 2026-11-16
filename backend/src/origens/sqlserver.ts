import sql from 'mssql';
import type { TipoParametro, ValorParametro } from '../lib/sqlParametros.js';
import { ErroAcesso, ErroInterrompido, registrarOrigem, type ColunaOrigem, type ConexaoConfig, type Origem } from './tipos.js';

const TAMANHO_LOTE = 1000;

/* ---------- Pools por conexão ---------- */

const pools = new Map<number, { versao: string; pool: sql.ConnectionPool }>();

function configDe(c: ConexaoConfig): sql.config {
  return {
    server: c.host,
    port: c.porta,
    database: c.banco,
    user: c.usuario,
    password: c.senha,
    connectionTimeout: 15_000,
    requestTimeout: 0, // o limite é controlado pelo "tempo máximo" de cada ação
    pool: { max: 4, min: 0, idleTimeoutMillis: 60_000 },
    options: {
      encrypt: c.criptografar,
      trustServerCertificate: c.confiarCertificado,
      enableArithAbort: true,
      appName: 'Plataforma BI',
    },
  };
}

async function obterPool(c: ConexaoConfig): Promise<sql.ConnectionPool> {
  const atual = pools.get(c.id);
  if (atual && atual.versao === c.versao && atual.pool.connected) return atual.pool;
  if (atual) {
    pools.delete(c.id);
    atual.pool.close().catch(() => undefined);
  }
  const pool = new sql.ConnectionPool(configDe(c));
  try {
    await pool.connect();
  } catch (e) {
    pool.close().catch(() => undefined);
    throw traduzirErro(e, c);
  }
  pool.on('error', () => {
    pools.delete(c.id);
  });
  pools.set(c.id, { versao: c.versao, pool });
  return pool;
}

/** Fecha o pool de uma conexão (após edição ou exclusão). */
export function descartarPool(id: number) {
  const atual = pools.get(id);
  if (atual) {
    pools.delete(id);
    atual.pool.close().catch(() => undefined);
  }
}

/* ---------- Erros em português, separando "sem acesso" de "erro no SQL" ---------- */

const CODIGOS_ACESSO = new Set(['ESOCKET', 'ETIMEOUT', 'EINSTLOOKUP', 'ECONNCLOSED', 'ENOTOPEN', 'ECONNRESET', 'ENOTFOUND', 'ECONNREFUSED', 'EHOSTUNREACH']);

function traduzirErro(e: unknown, c: ConexaoConfig): Error {
  const erro = e as { code?: string; message?: string; originalError?: { code?: string; message?: string } };
  const codigo = erro.code ?? erro.originalError?.code ?? '';
  const msg = `${erro.message ?? ''} ${erro.originalError?.message ?? ''}`;
  const servidor = `${c.host}:${c.porta} (${c.banco})`;
  if (codigo === 'ELOGIN') {
    // Erro 4060: o login entrou, mas o banco não existe ou o usuário não tem acesso a ele
    if (/Cannot open database|não é possível abrir o banco/i.test(msg)) {
      return new Error(
        `O login "${c.usuario}" foi aceito, mas o banco "${c.banco}" não existe ou esse usuário não tem acesso a ele. Confira o nome do banco.`,
      );
    }
    return new Error(`O SQL Server recusou o login "${c.usuario}" em ${c.host}:${c.porta}. Confira usuário e senha.`);
  }
  if (/certificate|self[- ]signed|SSL|TLS/i.test(msg) && !/timeout/i.test(msg)) {
    return new Error(
      `Falha na conexão segura com ${servidor}: o certificado do servidor não foi aceito. Marque "Confiar no certificado do servidor" na conexão.`,
    );
  }
  if (CODIGOS_ACESSO.has(codigo) || /Failed to connect|getaddrinfo|ECONNREFUSED|ETIMEDOUT/i.test(msg)) {
    return new ErroAcesso(`Sem acesso ao servidor ${servidor}: ${erro.message ?? codigo}`);
  }
  if (codigo === 'ECANCEL') return new ErroInterrompido('Consulta interrompida.');
  return new Error(erro.message ?? String(e));
}

/* ---------- Parâmetros ---------- */

const TIPO_MSSQL: Record<TipoParametro, () => sql.ISqlType> = {
  texto: () => sql.NVarChar(sql.MAX),
  numero: () => sql.Decimal(38, 10),
  data: () => sql.DateTime2(3),
};

const DECLARACAO: Record<TipoParametro, string> = {
  texto: 'nvarchar(4000)',
  numero: 'decimal(38,10)',
  data: 'datetime2(3)',
};

function vincular(req: sql.Request, params: Record<string, ValorParametro>) {
  for (const [nome, p] of Object.entries(params)) req.input(nome, TIPO_MSSQL[p.tipo](), p.valor);
}

/* ---------- Implementação ---------- */

export const origemSqlServer: Origem = {
  async testar(c) {
    const pool = new sql.ConnectionPool(configDe(c));
    try {
      await pool.connect();
      const r = await pool.request().query('SELECT @@VERSION AS versao, DB_NAME() AS banco');
      return { versao: String(r.recordset[0].versao).split('\n')[0].trim(), banco: r.recordset[0].banco };
    } catch (e) {
      throw traduzirErro(e, c);
    } finally {
      pool.close().catch(() => undefined);
    }
  },

  async descrever(c, comando, params): Promise<ColunaOrigem[]> {
    const pool = await obterPool(c);
    const req = pool.request();
    req.input('tsql', sql.NVarChar(sql.MAX), comando);
    const declaracoes = Object.entries(params).map(([n, p]) => `@${n} ${DECLARACAO[p.tipo]}`);
    req.input('params', sql.NVarChar(sql.MAX), declaracoes.length ? declaracoes.join(', ') : null);
    try {
      const r = await req.query(
        'EXEC sp_describe_first_result_set @tsql = @tsql, @params = @params, @browse_information_mode = 0',
      );
      const colunas = r.recordset.filter((l: any) => !l.is_hidden);
      if (!colunas.length) throw new Error('O comando não retorna nenhuma coluna. Ele precisa ser um SELECT.');
      return colunas.map((l: any, i: number) => {
        if (!l.name) throw new Error(`A ${i + 1}ª coluna do SELECT não tem nome. Dê um apelido a ela com AS.`);
        return { nome: l.name, tipoOrigem: l.system_type_name };
      });
    } catch (e) {
      throw traduzirErro(e, c);
    }
  },

  async avaliar(c, expressao, tipo) {
    if (/;|\bGO\b/i.test(expressao)) throw new Error('A expressão deve ser um único valor, sem ";".');
    const pool = await obterPool(c);
    try {
      const r = await pool.request().query(`SELECT (${expressao}) AS valor`);
      const v = r.recordset[0]?.valor;
      if (tipo === 'data' && v !== null && !(v instanceof Date)) return new Date(v);
      return v;
    } catch (e) {
      throw traduzirErro(e, c);
    }
  },

  async consultar(c, comando, params, opcoes) {
    const pool = await obterPool(c);
    const req = pool.request();
    req.stream = true;
    vincular(req, params);

    return await new Promise<{ linhas: number }>((resolve, reject) => {
      let colunas: string[] | null = null;
      let lote: unknown[][] = [];
      let total = 0;
      let erro: Error | null = null;
      let processando: Promise<void> = Promise.resolve();
      let resultados = 0;

      const abortar = () => {
        erro ??= new ErroInterrompido('Consulta interrompida.');
        req.cancel();
      };
      if (opcoes.signal.aborted) return reject(new ErroInterrompido('Consulta interrompida.'));
      opcoes.signal.addEventListener('abort', abortar, { once: true });

      const entregar = (linhas: unknown[][]) => {
        req.pause();
        processando = processando
          .then(() => opcoes.aoReceberLote(linhas))
          .then(
            () => {
              req.resume();
            },
            (e) => {
              erro ??= e;
              req.cancel();
            },
          );
      };

      req.on('recordset', (cols: sql.IColumnMetadata) => {
        resultados++;
        if (resultados > 1) {
          erro ??= new Error('O comando retornou mais de um resultado. Cada ação deve ter um único SELECT.');
          req.cancel();
          return;
        }
        const lista = Object.values(cols).sort((a, b) => a.index - b.index).map((col) => col.name);
        const repetida = lista.find((n, i) => lista.findIndex((m) => m.toLowerCase() === n.toLowerCase()) !== i);
        if (repetida) {
          erro ??= new Error(`A coluna "${repetida}" aparece mais de uma vez no SELECT. Use apelidos diferentes.`);
          req.cancel();
          return;
        }
        colunas = lista;
        processando = processando.then(() => opcoes.aoReceberColunas(lista));
      });

      req.on('row', (linha: Record<string, unknown>) => {
        if (!colunas || erro) return;
        lote.push(colunas.map((n) => linha[n]));
        total++;
        if (lote.length >= TAMANHO_LOTE) {
          const l = lote;
          lote = [];
          entregar(l);
        }
      });

      req.on('error', (e) => {
        erro ??= traduzirErro(e, c);
      });

      req.on('done', async () => {
        opcoes.signal.removeEventListener('abort', abortar);
        try {
          await processando;
          if (erro) return reject(erro);
          if (!colunas) return reject(new Error('O comando não retornou um resultado. Ele precisa ser um SELECT.'));
          if (lote.length) await opcoes.aoReceberLote(lote);
          resolve({ linhas: total });
        } catch (e) {
          reject(e);
        }
      });

      req.query(comando);
    });
  },
};

registrarOrigem('sqlserver', origemSqlServer);

/* ---------- Console SQL: consulta somente leitura ---------- */

/**
 * Executa um SELECT na origem para o Console SQL:
 * dentro de uma transação que é SEMPRE desfeita, com limite de linhas e de tempo.
 * (A recusa de comandos de escrita acontece antes, na rota do console.)
 */
export async function consultarSomenteLeitura(
  c: ConexaoConfig,
  comando: string,
  params: Record<string, ValorParametro>,
  limite: number,
  tempoMs: number,
): Promise<{ colunas: { nome: string; tipo: string }[]; linhas: unknown[][]; truncado: boolean }> {
  const pool = await obterPool(c);
  const tx = new sql.Transaction(pool);
  try {
    await tx.begin();
  } catch (e) {
    throw traduzirErro(e, c);
  }
  try {
    const req = new sql.Request(tx);
    req.stream = true;
    vincular(req, params);
    return await new Promise((resolve, reject) => {
      let colunas: { nome: string; tipo: string }[] | null = null;
      const linhas: unknown[][] = [];
      let truncado = false;
      let erro: Error | null = null;
      let resultados = 0;
      const timer = setTimeout(() => {
        erro ??= new Error(`Tempo máximo de ${Math.round(tempoMs / 1000)} s excedido. A consulta foi interrompida.`);
        req.cancel();
      }, tempoMs);

      req.on('recordset', (cols: sql.IColumnMetadata) => {
        resultados++;
        if (resultados > 1) return; // só o primeiro resultado é exibido
        colunas = Object.values(cols)
          .sort((a, b) => a.index - b.index)
          .map((col) => ({ nome: col.name, tipo: String((col.type as any)?.declaration ?? '') }));
      });
      req.on('row', (linha: Record<string, unknown>) => {
        if (resultados > 1 || !colunas) return;
        if (linhas.length >= limite) {
          if (!truncado) {
            truncado = true;
            req.cancel();
          }
          return;
        }
        linhas.push(colunas.map((col) => linha[col.nome]));
      });
      req.on('error', (e) => {
        // O cancelamento por limite de linhas não é erro
        if (truncado && (e as any)?.code === 'ECANCEL') return;
        erro ??= traduzirErro(e, c);
      });
      req.on('done', () => {
        clearTimeout(timer);
        if (erro) return reject(erro);
        resolve({ colunas: colunas ?? [], linhas, truncado });
      });
      req.query(comando);
    });
  } finally {
    await tx.rollback().catch(() => undefined);
  }
}
