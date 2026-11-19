import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { pool } from './pool.js';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Funciona tanto em src/db (dev) quanto em dist/db (produção)
const PASTA_MIGRACOES = path.resolve(__dirname, '../../migrations');

/** Aplica, em ordem, os arquivos .sql de /migrations que ainda não rodaram. */
export async function executarMigracoes(log: (msg: string) => void = console.log) {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        nome VARCHAR(200) PRIMARY KEY,
        aplicada_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    // Evita que duas instâncias da API migrem ao mesmo tempo
    await client.query('SELECT pg_advisory_lock(727272)');

    const arquivos = (await fs.readdir(PASTA_MIGRACOES)).filter((f) => f.endsWith('.sql')).sort();
    const { rows } = await client.query<{ nome: string }>('SELECT nome FROM schema_migrations');
    const aplicadas = new Set(rows.map((r) => r.nome));

    for (const arquivo of arquivos) {
      if (aplicadas.has(arquivo)) continue;
      const sql = await fs.readFile(path.join(PASTA_MIGRACOES, arquivo), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (nome) VALUES ($1)', [arquivo]);
        await client.query('COMMIT');
        log(`Migração aplicada: ${arquivo}`);
      } catch (erro) {
        await client.query('ROLLBACK');
        throw erro;
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(727272)').catch(() => undefined);
    client.release();
  }
}

/** Cria o usuário administrador inicial quando o banco ainda não tem usuários. */
export async function criarAdminInicial(log: (msg: string) => void = console.log) {
  const { rows } = await pool.query<{ total: string }>('SELECT COUNT(*) AS total FROM usuarios');
  if (Number(rows[0].total) > 0) return;

  const hash = await bcrypt.hash(config.adminSenha, 12);
  await pool.query(
    `INSERT INTO usuarios (nome, login, email, senha_hash, perfil, troca_senha_obrigatoria)
     VALUES ('Administrador', $1, $3, $2, 'desenvolvedor', TRUE)`,
    [config.adminLogin, hash, config.adminEmail || null],
  );
  log(`Usuário desenvolvedor criado: "${config.adminLogin}" (troca de senha obrigatória no 1º acesso)`);
}

// Permite rodar "npm run migrate" isoladamente
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  executarMigracoes()
    .then(() => criarAdminInicial())
    .then(() => pool.end())
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
