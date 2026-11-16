import 'dotenv/config';
import path from 'node:path';

function obrigatorio(nome: string, padraoDev?: string): string {
  const valor = process.env[nome] ?? (process.env.NODE_ENV !== 'production' ? padraoDev : undefined);
  if (!valor) {
    throw new Error(`Variável de ambiente obrigatória não definida: ${nome}`);
  }
  return valor;
}

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  porta: Number(process.env.PORT ?? 3333),
  databaseUrl: obrigatorio('DATABASE_URL', 'postgres://bi:bi@localhost:5432/bi'),
  jwtSecret: obrigatorio('JWT_SECRET', 'dev-somente-local-troque-em-producao'),
  accessTokenMinutos: Number(process.env.ACCESS_TOKEN_MINUTOS ?? 15),
  refreshTokenDias: Number(process.env.REFRESH_TOKEN_DIAS ?? 7),
  corsOrigin: process.env.CORS_ORIGIN ?? '',
  uploadDir: path.resolve(process.env.UPLOAD_DIR ?? './uploads'),
  uploadMaxMB: Number(process.env.UPLOAD_MAX_MB ?? 5),
  maxTentativasLogin: Number(process.env.MAX_TENTATIVAS_LOGIN ?? 5),
  bloqueioMinutos: Number(process.env.BLOQUEIO_MINUTOS ?? 15),
  adminLogin: process.env.ADMIN_LOGIN ?? 'admin',
  adminSenha: process.env.ADMIN_SENHA ?? 'Admin@123',
  cookieSeguro: (process.env.COOKIE_SECURE ?? 'false') === 'true',
  /** Banco onde as tarefas gravam os dados carregados (padrão: mesmo servidor, banco bi_dados). */
  biDadosUrl: process.env.BI_DADOS_URL ?? '',
  /** Chave de 32 bytes (hex ou base64) para criptografar as senhas das conexões. */
  chaveCriptografia: obrigatorio('CHAVE_CRIPTOGRAFIA', 'dev-somente-local-chave-de-criptografia-troque'),
  /** Fuso usado para interpretar as agendas. */
  fusoAgenda: process.env.FUSO_AGENDA ?? 'America/Sao_Paulo',
  /** Liga o agendador (desligado só em testes). */
  agendadorAtivo: (process.env.AGENDADOR_ATIVO ?? 'true') === 'true',
  adminEmail: process.env.ADMIN_EMAIL ?? '',
  /** Login com Google: ID do cliente OAuth (vazio = botão do Google desligado). */
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? '',
  /** Opcional: só aceita contas deste domínio do Google Workspace (ex.: ghlogistica.com.br). */
  googleDominio: (process.env.GOOGLE_DOMINIO ?? '').toLowerCase(),
  /** Chaves públicas do Google (trocado só em testes). */
  googleJwksUrl: process.env.GOOGLE_JWKS_URL ?? 'https://www.googleapis.com/oauth2/v3/certs',
  /** IA das análises (Claude). Sem chave, a criação com IA fica desligada. */
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
  anthropicModelo: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5-5',
  anthropicUrl: process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com',
  /** Pedidos à IA por usuário por dia (controle de custo). */
  iaLimiteDiario: Number(process.env.IA_LIMITE_DIARIO ?? 50),
  /** Só para testes: espera fixa entre tentativas de acesso (ms). */
  esperaTentativaMs: process.env.ESPERA_TENTATIVA_MS ? Number(process.env.ESPERA_TENTATIVA_MS) : null,
};

export const isProducao = config.env === 'production';
