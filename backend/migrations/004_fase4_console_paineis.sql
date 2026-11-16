-- =========================================================
-- Fase 4
--   1. Log do Console SQL (somente inclusão)
--   2. Painéis: consultas, listas, filtros e visuais
-- =========================================================

/* ---------- 1. Log do Console SQL ---------- */
CREATE TABLE console_log (
  id            BIGSERIAL PRIMARY KEY,
  data_hora     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  usuario_id    INTEGER      REFERENCES usuarios(id) ON DELETE SET NULL,
  usuario_nome  VARCHAR(120) NOT NULL,
  -- 'bi_dados' ou o nome da conexão SQL Server
  destino       VARCHAR(80)  NOT NULL,
  conexao_id    INTEGER,
  -- comando | inicio | commit | rollback | rollback_automatico
  evento        VARCHAR(25)  NOT NULL,
  transacao_id  UUID,
  -- consulta | insercao | alteracao | exclusao | estrutura | outro
  tipo          VARCHAR(15),
  comando       TEXT,
  linhas        BIGINT,
  duracao_ms    INTEGER,
  sucesso       BOOLEAN      NOT NULL DEFAULT TRUE,
  erro          TEXT,
  observacao    TEXT
);
CREATE INDEX ix_console_log_data ON console_log (data_hora DESC);
CREATE INDEX ix_console_log_transacao ON console_log (transacao_id) WHERE transacao_id IS NOT NULL;

-- O log só aceita inclusões: alterar, excluir ou esvaziar é recusado pelo próprio banco
CREATE FUNCTION console_log_somente_inclusao() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'O log do Console SQL não pode ser alterado nem excluído.';
END;
$$;
CREATE TRIGGER tg_console_log_sem_alteracao
  BEFORE UPDATE OR DELETE ON console_log
  FOR EACH ROW EXECUTE FUNCTION console_log_somente_inclusao();
CREATE TRIGGER tg_console_log_sem_truncate
  BEFORE TRUNCATE ON console_log
  FOR EACH STATEMENT EXECUTE FUNCTION console_log_somente_inclusao();

/* ---------- 2. Painéis ---------- */

-- Consultas que alimentam os visuais (SQL em PostgreSQL, rodando no bi_dados)
CREATE TABLE consultas_painel (
  id             SERIAL PRIMARY KEY,
  nome           VARCHAR(120) NOT NULL,
  descricao      VARCHAR(255),
  sql            TEXT NOT NULL,
  -- [{ "nome": "anomes", "tipo": "texto" | "numero" | "data" }]
  colunas        JSONB NOT NULL DEFAULT '[]'::jsonb,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX ux_consultas_painel_nome ON consultas_painel (LOWER(nome));

-- Listas cadastradas na ferramenta (filtro do tipo Lista): código + descrição
CREATE TABLE listas (
  id    SERIAL PRIMARY KEY,
  nome  VARCHAR(80) NOT NULL
);
CREATE UNIQUE INDEX ux_listas_nome ON listas (LOWER(nome));

CREATE TABLE lista_itens (
  id         SERIAL PRIMARY KEY,
  lista_id   INTEGER NOT NULL REFERENCES listas(id) ON DELETE CASCADE,
  codigo     VARCHAR(120) NOT NULL,
  descricao  VARCHAR(255) NOT NULL,
  ordem      INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX ux_lista_itens_codigo ON lista_itens (lista_id, codigo);

-- Filtros reaproveitáveis entre painéis
CREATE TABLE filtros (
  id                       SERIAL PRIMARY KEY,
  nome                     VARCHAR(80) NOT NULL,            -- rótulo exibido ao usuário
  parametro                VARCHAR(60) NOT NULL,            -- usado no SQL como @PARAMETRO
  tipo                     VARCHAR(10) NOT NULL CHECK (tipo IN ('periodo', 'ano', 'mes', 'lista', 'select')),
  multiplo                 BOOLEAN NOT NULL DEFAULT TRUE,   -- lista e select
  tipo_codigo              VARCHAR(10) NOT NULL DEFAULT 'texto' CHECK (tipo_codigo IN ('texto', 'numero')),
  lista_id                 INTEGER REFERENCES listas(id) ON DELETE RESTRICT,
  select_tabela            VARCHAR(130),
  select_coluna_codigo     VARCHAR(63),
  select_coluna_descricao  VARCHAR(63),
  -- periodo: nenhum | mes_atual | mes_anterior | ultimos_30 | ano_atual
  -- ano: nenhum | atual        mes: nenhum | atual
  padrao                   VARCHAR(20) NOT NULL DEFAULT 'nenhum',
  ano_inicial              INTEGER,
  CHECK (tipo <> 'lista' OR lista_id IS NOT NULL),
  CHECK (tipo <> 'select' OR (select_tabela IS NOT NULL AND select_coluna_codigo IS NOT NULL AND select_coluna_descricao IS NOT NULL))
);
CREATE UNIQUE INDEX ux_filtros_parametro ON filtros (LOWER(parametro));

CREATE TABLE painel_filtros (
  painel_id  INTEGER NOT NULL REFERENCES paineis(id) ON DELETE CASCADE,
  filtro_id  INTEGER NOT NULL REFERENCES filtros(id) ON DELETE RESTRICT,
  ordem      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (painel_id, filtro_id)
);

CREATE TABLE painel_visuais (
  id           SERIAL PRIMARY KEY,
  painel_id    INTEGER NOT NULL REFERENCES paineis(id) ON DELETE CASCADE,
  tipo         VARCHAR(10) NOT NULL CHECK (tipo IN ('kpi', 'barra', 'linha', 'pizza', 'tabela')),
  titulo       VARCHAR(120) NOT NULL,
  consulta_id  INTEGER NOT NULL REFERENCES consultas_painel(id) ON DELETE RESTRICT,
  config       JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- posição na grade de 12 colunas: { x, y, w, h }
  layout       JSONB NOT NULL DEFAULT '{"x":0,"y":0,"w":6,"h":4}'::jsonb
);
CREATE INDEX ix_painel_visuais_painel ON painel_visuais (painel_id);
