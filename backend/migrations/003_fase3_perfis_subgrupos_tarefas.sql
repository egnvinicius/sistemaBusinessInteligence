-- =========================================================
-- Fase 3
--   1. Perfis de acesso (Usuário, Gestor, Desenvolvedor)
--   2. Subgrupos dentro de subgrupos
--   3. Conexões, catálogo de ações e tarefas de atualização
-- =========================================================

/* ---------- 1. Perfis ---------- */
ALTER TABLE usuarios
  ADD COLUMN perfil VARCHAR(15) NOT NULL DEFAULT 'usuario'
  CHECK (perfil IN ('usuario', 'gestor', 'desenvolvedor'));

-- Administradores atuais viram Gestor; o primeiro administrador (criado na instalação) vira Desenvolvedor
UPDATE usuarios SET perfil = 'gestor' WHERE is_admin;
UPDATE usuarios SET perfil = 'desenvolvedor'
 WHERE id = (SELECT MIN(id) FROM usuarios WHERE is_admin);

ALTER TABLE usuarios DROP COLUMN is_admin;

/* ---------- 2. Subgrupos aninhados ---------- */
ALTER TABLE menu_subgrupos
  ADD COLUMN subgrupo_pai_id INTEGER REFERENCES menu_subgrupos(id) ON DELETE RESTRICT;

DROP INDEX IF EXISTS ux_menu_subgrupos_nome;
CREATE UNIQUE INDEX ux_menu_subgrupos_nome
  ON menu_subgrupos (menu_grupo_id, COALESCE(subgrupo_pai_id, 0), LOWER(nome));
CREATE INDEX IF NOT EXISTS ix_menu_subgrupos_pai ON menu_subgrupos(subgrupo_pai_id);

/* ---------- 3. Atualização de dados ---------- */

-- Estruturas planejadas na Fase 1 e nunca usadas; substituídas pelas tabelas abaixo
DROP TABLE IF EXISTS visuais;
DROP TABLE IF EXISTS consultas;
DROP TABLE IF EXISTS fontes_dados;

CREATE TABLE conexoes (
  id                    SERIAL PRIMARY KEY,
  nome                  VARCHAR(60)  NOT NULL,
  tipo                  VARCHAR(20)  NOT NULL DEFAULT 'sqlserver' CHECK (tipo IN ('sqlserver')),
  host                  VARCHAR(160) NOT NULL,
  porta                 INTEGER      NOT NULL DEFAULT 1433,
  banco                 VARCHAR(120) NOT NULL,
  usuario               VARCHAR(120) NOT NULL,
  senha_criptografada   TEXT         NOT NULL,
  criptografar          BOOLEAN      NOT NULL DEFAULT TRUE,
  confiar_certificado   BOOLEAN      NOT NULL DEFAULT TRUE,
  ativo                 BOOLEAN      NOT NULL DEFAULT TRUE,
  ultimo_teste_em       TIMESTAMPTZ,
  ultimo_teste_ok       BOOLEAN,
  ultimo_teste_msg      TEXT,
  criado_em             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  atualizado_em         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX ux_conexoes_nome ON conexoes (LOWER(nome));

-- Catálogo de ações (reaproveitáveis entre tarefas)
CREATE TABLE acoes (
  id                  SERIAL PRIMARY KEY,
  nome                VARCHAR(120) NOT NULL,
  tipo                VARCHAR(20)  NOT NULL DEFAULT 'integracao' CHECK (tipo IN ('integracao')),
  conexao_id          INTEGER      NOT NULL REFERENCES conexoes(id) ON DELETE RESTRICT,
  comando_sql         TEXT         NOT NULL,
  comando_limpeza     TEXT,
  tabela_destino      VARCHAR(130) NOT NULL,
  tempo_maximo_min    INTEGER      NOT NULL DEFAULT 30 CHECK (tempo_maximo_min BETWEEN 1 AND 1440),
  ativo               BOOLEAN      NOT NULL DEFAULT TRUE,
  criado_em           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  atualizado_em       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX ux_acoes_nome ON acoes (LOWER(nome));

CREATE TABLE tarefa_grupos (
  id     SERIAL PRIMARY KEY,
  nome   VARCHAR(60) NOT NULL,
  ordem  INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX ux_tarefa_grupos_nome ON tarefa_grupos (LOWER(nome));

CREATE TABLE tarefas (
  id                     SERIAL PRIMARY KEY,
  grupo_id               INTEGER     NOT NULL REFERENCES tarefa_grupos(id) ON DELETE RESTRICT,
  nome                   VARCHAR(120) NOT NULL,
  descricao              VARCHAR(255),
  ativa                  BOOLEAN     NOT NULL DEFAULT TRUE,
  -- Falhas de acesso a servidor: tenta de novo até um destes limites
  max_tentativas_acesso  INTEGER     NOT NULL DEFAULT 5  CHECK (max_tentativas_acesso BETWEEN 1 AND 50),
  janela_tentativas_min  INTEGER     NOT NULL DEFAULT 15 CHECK (janela_tentativas_min BETWEEN 1 AND 720),
  criado_em              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX ux_tarefas_nome ON tarefas (LOWER(nome));

CREATE TABLE tarefa_acoes (
  id          SERIAL PRIMARY KEY,
  tarefa_id   INTEGER NOT NULL REFERENCES tarefas(id) ON DELETE CASCADE,
  acao_id     INTEGER NOT NULL REFERENCES acoes(id) ON DELETE RESTRICT,
  ordem       INTEGER NOT NULL,
  caso_erro   VARCHAR(10) NOT NULL DEFAULT 'continuar' CHECK (caso_erro IN ('continuar', 'parar')),
  tentativas  INTEGER NOT NULL DEFAULT 1 CHECK (tentativas BETWEEN 1 AND 10)
);
CREATE INDEX ix_tarefa_acoes_tarefa ON tarefa_acoes(tarefa_id, ordem);

-- Agenda: dias da semana OU dias do mês, meses, horas e minutos (vazio = qualquer)
CREATE TABLE agendas (
  id           SERIAL PRIMARY KEY,
  tarefa_id    INTEGER NOT NULL REFERENCES tarefas(id) ON DELETE CASCADE,
  repetir_por  VARCHAR(10) NOT NULL DEFAULT 'semana' CHECK (repetir_por IN ('semana', 'mes')),
  dias_semana  SMALLINT[] NOT NULL DEFAULT '{}',   -- 0 = domingo ... 6 = sábado
  dias_mes     SMALLINT[] NOT NULL DEFAULT '{}',   -- 1..31
  meses        SMALLINT[] NOT NULL DEFAULT '{}',   -- 1..12
  horas        SMALLINT[] NOT NULL,                -- 0..23
  minutos      SMALLINT[] NOT NULL,                -- 0, 5, ..., 55
  ativa        BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX ix_agendas_tarefa ON agendas(tarefa_id);

-- Parâmetros: valor padrão (agenda_id nulo) e sobrescrita por agenda
CREATE TABLE tarefa_parametros (
  id         SERIAL PRIMARY KEY,
  tarefa_id  INTEGER NOT NULL REFERENCES tarefas(id) ON DELETE CASCADE,
  agenda_id  INTEGER REFERENCES agendas(id) ON DELETE CASCADE,
  nome       VARCHAR(60) NOT NULL,
  tipo       VARCHAR(10) NOT NULL DEFAULT 'texto' CHECK (tipo IN ('texto', 'numero', 'data')),
  modo       VARCHAR(10) NOT NULL DEFAULT 'fixo'  CHECK (modo IN ('fixo', 'expressao')),
  valor      TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_tarefa_parametros
  ON tarefa_parametros (tarefa_id, COALESCE(agenda_id, 0), LOWER(nome));

-- Execuções (fila + histórico)
CREATE TABLE execucoes (
  id                  BIGSERIAL PRIMARY KEY,
  tarefa_id           INTEGER NOT NULL REFERENCES tarefas(id) ON DELETE CASCADE,
  agenda_id           INTEGER REFERENCES agendas(id) ON DELETE SET NULL,
  origem              VARCHAR(12) NOT NULL CHECK (origem IN ('agenda', 'manual', 'recuperacao')),
  situacao            VARCHAR(25) NOT NULL CHECK (situacao IN
                        ('na_fila', 'executando', 'concluido', 'concluido_com_erros', 'erro',
                         'cancelado', 'ignorado', 'nao_executada')),
  agendado_para       TIMESTAMPTZ,
  solicitado_por      INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  cancelar            BOOLEAN NOT NULL DEFAULT FALSE,
  parametros_json     JSONB,
  mensagem            TEXT,
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  inicio              TIMESTAMPTZ,
  fim                 TIMESTAMPTZ
);
CREATE INDEX ix_execucoes_tarefa ON execucoes(tarefa_id, criado_em DESC);
CREATE INDEX ix_execucoes_fila   ON execucoes(situacao, criado_em) WHERE situacao IN ('na_fila', 'executando');

CREATE TABLE execucao_acoes (
  id                BIGSERIAL PRIMARY KEY,
  execucao_id       BIGINT  NOT NULL REFERENCES execucoes(id) ON DELETE CASCADE,
  acao_id           INTEGER REFERENCES acoes(id) ON DELETE SET NULL,
  acao_nome         VARCHAR(120) NOT NULL,
  ordem             INTEGER NOT NULL,
  situacao          VARCHAR(15) NOT NULL CHECK (situacao IN ('pendente', 'executando', 'concluido', 'erro', 'cancelado', 'pulado')),
  tentativas        INTEGER NOT NULL DEFAULT 0,
  linhas_excluidas  BIGINT,
  linhas_inseridas  BIGINT,
  mensagem          TEXT,
  inicio            TIMESTAMPTZ,
  fim               TIMESTAMPTZ
);
CREATE INDEX ix_execucao_acoes_exec ON execucao_acoes(execucao_id, ordem);

CREATE TABLE execucao_logs (
  id           BIGSERIAL PRIMARY KEY,
  execucao_id  BIGINT NOT NULL REFERENCES execucoes(id) ON DELETE CASCADE,
  nivel        VARCHAR(8) NOT NULL CHECK (nivel IN ('info', 'aviso', 'erro')),
  mensagem     TEXT NOT NULL,
  data_hora    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ix_execucao_logs_exec ON execucao_logs(execucao_id, id);

-- Último minuto que o agendador processou (detecta períodos fora do ar)
CREATE TABLE agendador_estado (
  id           INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  ultimo_tick  TIMESTAMPTZ
);
INSERT INTO agendador_estado (id) VALUES (1);
