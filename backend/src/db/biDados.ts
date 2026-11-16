import crypto from 'node:crypto';
import pg from 'pg';
import { config } from '../config.js';
import { pool } from './pool.js';

/**
 * Banco onde as tarefas gravam os dados carregados (bi_dados).
 * Por padrão fica no mesmo servidor PostgreSQL da ferramenta, num banco separado.
 *
 * Segurança: quando o usuário principal é superusuário (o padrão no Docker), a ferramenta
 * cria um usuário próprio e sem privilégios especiais, "bi_dados_app", dono do bi_dados e
 * sem acesso ao banco da ferramenta. Tarefas, painéis e Console SQL usam esse usuário,
 * então um comando no console não alcança usuários, senhas, auditoria nem o log do console.
 */
export const PAPEL_BI_DADOS = 'bi_dados_app';

export function urlBiDados() {
  if (config.biDadosUrl) return config.biDadosUrl;
  const url = new URL(config.databaseUrl);
  url.pathname = '/bi_dados';
  return url.toString();
}

const nomeBanco = () => decodeURIComponent(new URL(urlBiDados()).pathname.replace(/^\//, ''));
const nomeBancoPrincipal = () => decodeURIComponent(new URL(config.databaseUrl).pathname.replace(/^\//, ''));

/** Senha do usuário restrito, derivada da CHAVE_CRIPTOGRAFIA (não precisa ser guardada). */
const senhaPapel = () => crypto.createHmac('sha256', config.chaveCriptografia).update(PAPEL_BI_DADOS).digest('hex');

// Datas vindas do SQL Server chegam como "horário de parede" em UTC (padrão do driver mssql).
// Gravá-las também em UTC evita deslocar horas conforme o fuso do servidor.
pg.defaults.parseInputDatesAsUTC = true;

/* ---------- Pools trocáveis (começam com o usuário principal) ---------- */

let urlAtual = urlBiDados();
let poolCargas = new pg.Pool({ connectionString: urlAtual, max: 6 });
let poolConsoleReal = new pg.Pool({ connectionString: urlAtual, max: 4, statement_timeout: 5 * 60_000 });
let usuarioRestrito = false;

const proxy = (obter: () => pg.Pool) =>
  new Proxy({} as pg.Pool, {
    get(_alvo, prop) {
      const p = obter();
      const v = (p as any)[prop];
      return typeof v === 'function' ? v.bind(p) : v;
    },
  });

/** Tarefas e painéis. */
export const poolBiDados = proxy(() => poolCargas);
/** Console SQL (comandos limitados a 5 minutos). */
export const poolConsole = proxy(() => poolConsoleReal);

export const consoleComUsuarioRestrito = () => usuarioRestrito;

function trocarPools(url: string) {
  const antigos = [poolCargas, poolConsoleReal];
  urlAtual = url;
  poolCargas = new pg.Pool({ connectionString: url, max: 6 });
  poolConsoleReal = new pg.Pool({ connectionString: url, max: 4, statement_timeout: 5 * 60_000 });
  for (const p of antigos) p.end().catch(() => undefined);
}

export async function encerrarPoolsBiDados() {
  await Promise.all([poolCargas.end(), poolConsoleReal.end()].map((p) => p.catch(() => undefined)));
}

/**
 * Cria o banco bi_dados (se faltar) e, quando possível, o usuário restrito.
 * Banco externo (BI_DADOS_URL): administrado por fora, usado como está.
 */
export async function garantirBancoBiDados(log: (m: string) => void = console.log) {
  if (config.biDadosUrl) return;
  const nome = nomeBanco();
  if (!/^[a-z_][a-z0-9_]*$/.test(nome)) throw new Error(`Nome de banco inválido: ${nome}`);
  const { rows } = await pool.query('SELECT 1 FROM pg_database WHERE datname = $1', [nome]);
  if (!rows[0]) {
    await pool.query(`CREATE DATABASE "${nome}"`);
    log(`Banco de dados criado: ${nome}`);
  }

  const { rows: eu } = await pool.query<{ rolsuper: boolean }>('SELECT rolsuper FROM pg_roles WHERE rolname = current_user');
  if (!eu[0]?.rolsuper) {
    // Usuário principal sem superpoderes: já não consegue sair do bi_dados por extensões ou COPY PROGRAM
    log('bi_dados: usando o usuário principal (ele não é superusuário).');
    return;
  }
  await provisionarPapel(nome, log);
}

async function provisionarPapel(banco: string, log: (m: string) => void) {
  const papel = PAPEL_BI_DADOS;
  const senha = senhaPapel(); // hex: seguro dentro de aspas simples
  const { rows } = await pool.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [papel]);
  if (!rows[0]) {
    await pool.query(
      `CREATE ROLE ${papel} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${senha}'`,
    );
    log(`Usuário de banco restrito criado: ${papel}`);
  } else {
    // Reaplica atributos e senha a cada início (desfaz qualquer alteração feita por fora)
    await pool.query(
      `ALTER ROLE ${papel} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${senha}'`,
    );
  }
  await pool.query(`ALTER DATABASE "${banco}" OWNER TO ${papel}`);
  // Ninguém além do dono entra no banco da ferramenta
  await pool.query(`REVOKE CONNECT ON DATABASE "${nomeBancoPrincipal()}" FROM PUBLIC`);

  // Objetos já existentes no bi_dados passam a ser do usuário restrito
  const admin = new pg.Client({ connectionString: urlBiDados() });
  await admin.connect();
  try {
    const { rows: schemas } = await admin.query<{ nspname: string }>(
      `SELECT nspname FROM pg_namespace
        WHERE nspname NOT LIKE 'pg\\_%' AND nspname <> 'information_schema'
          AND pg_get_userbyid(nspowner) <> $1`,
      [papel],
    );
    for (const s of schemas) {
      if (s.nspname === 'public') continue; // public já pertence ao dono do banco
      await admin.query(`ALTER SCHEMA "${s.nspname.replace(/"/g, '""')}" OWNER TO ${papel}`);
    }
    const { rows: objetos } = await admin.query<{ schema: string; nome: string; tipo: string }>(
      `SELECT n.nspname AS schema, c.relname AS nome, c.relkind AS tipo
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname NOT LIKE 'pg\\_%' AND n.nspname <> 'information_schema'
          AND c.relkind IN ('r', 'v', 'm', 'S', 'p', 'f')
          AND pg_get_userbyid(c.relowner) <> $1
          AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'a' AND c.relkind = 'S')`,
      [papel],
    );
    const comando: Record<string, string> = { r: 'TABLE', p: 'TABLE', f: 'FOREIGN TABLE', v: 'VIEW', m: 'MATERIALIZED VIEW', S: 'SEQUENCE' };
    for (const o of objetos) {
      const nomeSql = `"${o.schema.replace(/"/g, '""')}"."${o.nome.replace(/"/g, '""')}"`;
      await admin.query(`ALTER ${comando[o.tipo]} ${nomeSql} OWNER TO ${papel}`);
    }
    if (objetos.length) log(`bi_dados: ${objetos.length} objeto(s) transferido(s) para ${papel}.`);
  } finally {
    await admin.end();
  }

  const url = new URL(urlBiDados());
  url.username = papel;
  url.password = senha;
  trocarPools(url.toString());
  usuarioRestrito = true;
  log(`bi_dados: tarefas, painéis e Console SQL usam o usuário restrito ${papel}.`);
}

/* ---------- Nomes de tabela e coluna ---------- */

const IDENT = /^[a-z_][a-z0-9_]{0,62}$/;

/**
 * Normaliza "Schema.Tabela" ou "Tabela" para minúsculas, sem aspas.
 * No PostgreSQL, nomes sem aspas não diferenciam maiúsculas: ETL_V_X e etl_v_x são a mesma tabela.
 */
export function normalizarTabela(nome: string): { schema: string; tabela: string; completo: string } | null {
  const partes = nome.trim().toLowerCase().replace(/"/g, '').split('.');
  if (partes.length > 2 || partes.some((p) => !IDENT.test(p))) return null;
  const [schema, tabela] = partes.length === 2 ? partes : ['public', partes[0]];
  return { schema, tabela, completo: `${schema}.${tabela}` };
}

export const aspas = (ident: string) => `"${ident.replace(/"/g, '""')}"`;

export const nomeColuna = (nome: string) => {
  const n = nome.trim().toLowerCase();
  if (!IDENT.test(n)) {
    throw new Error(
      `A coluna "${nome}" não pode ser usada como nome no PostgreSQL. Use um apelido (AS) só com letras, números e _, começando por letra.`,
    );
  }
  return n;
};

/** Colunas atuais de uma tabela do bi_dados (vazio se a tabela não existe). */
export async function colunasDaTabela(schema: string, tabela: string, client: pg.ClientBase | pg.Pool = poolBiDados) {
  const { rows } = await client.query<{ column_name: string; data_type: string }>(
    `SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`,
    [schema, tabela],
  );
  return rows;
}
