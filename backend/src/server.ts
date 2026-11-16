import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs/promises';
import { config, isProducao } from './config.js';
import { pool } from './db/pool.js';
import { criarAdminInicial, executarMigracoes } from './db/migrate.js';
import { rotasAuth } from './routes/auth.js';
import { rotasAparencia } from './routes/aparencia.js';
import { rotasGrupos } from './routes/grupos.js';
import { rotasMenuAdmin, rotasMenuUsuario } from './routes/menu.js';
import { rotasUsuarios } from './routes/usuarios.js';
import { rotasConexoes } from './routes/conexoes.js';
import { rotasAcoes } from './routes/acoes.js';
import { rotasTarefas } from './routes/tarefas.js';
import { rotasConsole } from './routes/console.js';
import { rotasCatalogoPaineis } from './routes/catalogoPaineis.js';
import { rotasPaineis } from './routes/paineis.js';
import { rotasInicio } from './routes/inicio.js';
import { rotasAnalises, rotasCubosAdmin } from './routes/analises.js';
import { encerrarPoolsBiDados, garantirBancoBiDados } from './db/biDados.js';
import { iniciarAgendador } from './etl/agendador.js';
import './origens/sqlserver.js';

export async function criarApp() {
  const app = Fastify({
    logger: { level: isProducao ? 'info' : 'debug' },
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  });

  await app.register(cookie);
  if (config.corsOrigin) {
    await app.register(cors, { origin: config.corsOrigin.split(','), credentials: true });
  }
  await app.register(jwt, { secret: config.jwtSecret });
  await app.register(rateLimit, { global: false });
  await app.register(multipart, { limits: { fileSize: config.uploadMaxMB * 1024 * 1024, files: 1 } });

  await fs.mkdir(config.uploadDir, { recursive: true });
  await app.register(fastifyStatic, {
    root: config.uploadDir,
    prefix: '/uploads/',
    maxAge: '7d',
    immutable: true,
    setHeaders: (res) => {
      res.header('X-Content-Type-Options', 'nosniff');
    },
  });

  app.get('/api/health', async () => {
    await pool.query('SELECT 1');
    return { status: 'ok' };
  });

  await app.register(rotasAuth, { prefix: '/api/auth' });
  await app.register(rotasAparencia, { prefix: '/api/aparencia' });
  await app.register(rotasUsuarios, { prefix: '/api/usuarios' });
  await app.register(rotasGrupos, { prefix: '/api/grupos' });
  await app.register(rotasMenuUsuario, { prefix: '/api/menu' });
  await app.register(rotasMenuAdmin, { prefix: '/api/admin/menu' });
  await app.register(rotasConexoes, { prefix: '/api/conexoes' });
  await app.register(rotasAcoes, { prefix: '/api/acoes' });
  await app.register(rotasTarefas, { prefix: '/api/tarefas' });
  await app.register(rotasConsole, { prefix: '/api/console' });
  await app.register(rotasCatalogoPaineis, { prefix: '/api/catalogo' });
  await app.register(rotasPaineis, { prefix: '/api/paineis' });
  await app.register(rotasCubosAdmin, { prefix: '/api/catalogo/cubos' });
  await app.register(rotasAnalises, { prefix: '/api/analises' });
  await app.register(rotasInicio, { prefix: '/api/inicio' });

  app.setErrorHandler((erro: Error & { statusCode?: number }, request, reply) => {
    request.log.error(erro);
    const status = erro.statusCode && erro.statusCode >= 400 ? erro.statusCode : 500;
    if (status === 429) return reply.code(429).send({ erro: 'Muitas tentativas. Aguarde um minuto e tente novamente.' });
    return reply.code(status).send({ erro: status === 500 ? 'Erro interno no servidor.' : erro.message });
  });

  return app;
}

async function iniciar() {
  await executarMigracoes();
  await criarAdminInicial();
  await garantirBancoBiDados();
  const app = await criarApp();
  await app.listen({ port: config.porta, host: '0.0.0.0' });
  if (config.agendadorAtivo) await iniciarAgendador((m) => app.log.info(m));

  const encerrar = async () => {
    await app.close();
    await pool.end();
    await encerrarPoolsBiDados();
    process.exit(0);
  };
  process.on('SIGTERM', encerrar);
  process.on('SIGINT', encerrar);
}

// Em testes o servidor é montado sem subir a porta
if (process.env.NODE_ENV !== 'test') iniciar().catch((erro) => {
  console.error('Falha ao iniciar a API:', erro);
  process.exit(1);
});
