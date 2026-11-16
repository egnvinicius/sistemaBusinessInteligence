-- =========================================================
-- Estrutura inicial da Plataforma de BI
-- Banco da ferramenta (PostgreSQL). Os dados de negócio
-- continuam no SQL Server e são lidos via "fontes_dados".
-- =========================================================

CREATE TABLE IF NOT EXISTS usuarios (
  id                       SERIAL PRIMARY KEY,
  nome                     VARCHAR(120) NOT NULL,
  email                    VARCHAR(160) UNIQUE,
  login                    VARCHAR(60)  NOT NULL UNIQUE,
  senha_hash               VARCHAR(100) NOT NULL,
  ativo                    BOOLEAN      NOT NULL DEFAULT TRUE,
  is_admin                 BOOLEAN      NOT NULL DEFAULT FALSE,
  tema_preferido           VARCHAR(10)  CHECK (tema_preferido IN ('claro', 'escuro')),
  troca_senha_obrigatoria  BOOLEAN      NOT NULL DEFAULT FALSE,
  tentativas_falhas        INTEGER      NOT NULL DEFAULT 0,
  bloqueado_ate            TIMESTAMPTZ,
  ultimo_acesso            TIMESTAMPTZ,
  criado_em                TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  atualizado_em            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id           SERIAL PRIMARY KEY,
  usuario_id   INTEGER      NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  token_hash   CHAR(64)     NOT NULL UNIQUE,
  expira_em    TIMESTAMPTZ  NOT NULL,
  revogado_em  TIMESTAMPTZ,
  criado_em    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_refresh_tokens_usuario ON refresh_tokens(usuario_id);

-- Grupos de ACESSO (quem pode ver o quê)
CREATE TABLE IF NOT EXISTS grupos_usuarios (
  id         SERIAL PRIMARY KEY,
  nome       VARCHAR(80) NOT NULL UNIQUE,
  descricao  VARCHAR(255),
  criado_em  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS usuario_grupo (
  usuario_id        INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  grupo_usuario_id  INTEGER NOT NULL REFERENCES grupos_usuarios(id) ON DELETE CASCADE,
  PRIMARY KEY (usuario_id, grupo_usuario_id)
);

-- Estrutura do MENU: Grupo > Subgrupo > Painel
CREATE TABLE IF NOT EXISTS menu_grupos (
  id     SERIAL PRIMARY KEY,
  nome   VARCHAR(80) NOT NULL,
  icone  VARCHAR(60),
  ordem  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS menu_subgrupos (
  id             SERIAL PRIMARY KEY,
  menu_grupo_id  INTEGER NOT NULL REFERENCES menu_grupos(id) ON DELETE CASCADE,
  nome           VARCHAR(80) NOT NULL,
  ordem          INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS paineis (
  id                 SERIAL PRIMARY KEY,
  menu_subgrupo_id   INTEGER NOT NULL REFERENCES menu_subgrupos(id) ON DELETE CASCADE,
  nome               VARCHAR(120) NOT NULL,
  descricao          VARCHAR(255),
  layout_json        JSONB NOT NULL DEFAULT '[]'::jsonb,
  ativo              BOOLEAN NOT NULL DEFAULT TRUE,
  ordem              INTEGER NOT NULL DEFAULT 0,
  criado_em          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS painel_permissao (
  painel_id         INTEGER NOT NULL REFERENCES paineis(id) ON DELETE CASCADE,
  grupo_usuario_id  INTEGER NOT NULL REFERENCES grupos_usuarios(id) ON DELETE CASCADE,
  PRIMARY KEY (painel_id, grupo_usuario_id)
);

-- Fontes de dados (SQL Server agora; XLS no futuro)
CREATE TABLE IF NOT EXISTS fontes_dados (
  id                   SERIAL PRIMARY KEY,
  nome                 VARCHAR(80)  NOT NULL,
  tipo                 VARCHAR(20)  NOT NULL DEFAULT 'sqlserver' CHECK (tipo IN ('sqlserver', 'xls')),
  host                 VARCHAR(160),
  porta                INTEGER,
  banco                VARCHAR(120),
  usuario              VARCHAR(120),
  senha_criptografada  TEXT,
  opcoes_json          JSONB NOT NULL DEFAULT '{}'::jsonb,
  ativo                BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS consultas (
  id               SERIAL PRIMARY KEY,
  fonte_dados_id   INTEGER NOT NULL REFERENCES fontes_dados(id) ON DELETE RESTRICT,
  nome             VARCHAR(120) NOT NULL,
  sql              TEXT NOT NULL,
  parametros_json  JSONB NOT NULL DEFAULT '[]'::jsonb,
  cache_segundos   INTEGER NOT NULL DEFAULT 300,
  criado_em        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS visuais (
  id            SERIAL PRIMARY KEY,
  painel_id     INTEGER NOT NULL REFERENCES paineis(id) ON DELETE CASCADE,
  consulta_id   INTEGER REFERENCES consultas(id) ON DELETE SET NULL,
  tipo          VARCHAR(20) NOT NULL CHECK (tipo IN ('kpi', 'barra', 'linha', 'pizza', 'tabela')),
  config_json   JSONB NOT NULL DEFAULT '{}'::jsonb,
  posicao_json  JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Aparência (registro único, id = 1)
CREATE TABLE IF NOT EXISTS config_aparencia (
  id                      INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  nome_sistema            VARCHAR(60)  NOT NULL DEFAULT 'Plataforma BI',
  titulo_login            VARCHAR(80)  NOT NULL DEFAULT 'Bem-vindo',
  subtitulo_login         VARCHAR(160) NOT NULL DEFAULT 'Acesse seus painéis de indicadores',
  cor_primaria            CHAR(7)      NOT NULL DEFAULT '#0B7A75',
  cor_fundo_login         CHAR(7)      NOT NULL DEFAULT '#F2F5F4',
  cor_fundo_login_escuro  CHAR(7)      NOT NULL DEFAULT '#0D1719',
  layout_login            VARCHAR(15)  NOT NULL DEFAULT 'dividido' CHECK (layout_login IN ('dividido', 'centralizado')),
  logo_url                VARCHAR(255),
  imagem_fundo_url        VARCHAR(255),
  tema_padrao             VARCHAR(10)  NOT NULL DEFAULT 'sistema' CHECK (tema_padrao IN ('claro', 'escuro', 'sistema')),
  atualizado_em           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  atualizado_por          INTEGER REFERENCES usuarios(id) ON DELETE SET NULL
);
INSERT INTO config_aparencia (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS auditoria (
  id          BIGSERIAL PRIMARY KEY,
  usuario_id  INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  acao        VARCHAR(60) NOT NULL,
  entidade    VARCHAR(60),
  detalhes    JSONB,
  ip          VARCHAR(64),
  data_hora   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_auditoria_data ON auditoria(data_hora DESC);
