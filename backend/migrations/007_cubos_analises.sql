-- =========================================================
-- Fase 5: análises com IA a partir de "cubos"
-- =========================================================

-- Cubo = uma consulta de painel liberada para os usuários montarem as próprias análises
CREATE TABLE IF NOT EXISTS cubos (
  id                SERIAL PRIMARY KEY,
  nome              VARCHAR(120) NOT NULL UNIQUE,
  descricao         VARCHAR(500),
  consulta_id       INT NOT NULL REFERENCES consultas_painel(id) ON DELETE RESTRICT,
  -- Explicação de cada coluna para o usuário e para a IA: { "coluna": "texto" }
  colunas_descricao JSONB NOT NULL DEFAULT '{}'::jsonb,
  ativo             BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cubo_grupos (
  cubo_id          INT NOT NULL REFERENCES cubos(id) ON DELETE CASCADE,
  grupo_usuario_id INT NOT NULL REFERENCES grupos_usuarios(id) ON DELETE CASCADE,
  PRIMARY KEY (cubo_id, grupo_usuario_id)
);

-- Análises pessoais: cada usuário vê só as suas
CREATE TABLE IF NOT EXISTS analises (
  id            SERIAL PRIMARY KEY,
  usuario_id    INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  cubo_id       INT NOT NULL REFERENCES cubos(id) ON DELETE CASCADE,
  nome          VARCHAR(120) NOT NULL,
  visuais       JSONB NOT NULL DEFAULT '[]'::jsonb,
  filtros       JSONB NOT NULL DEFAULT '{}'::jsonb,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS analises_usuario_idx ON analises (usuario_id, atualizado_em DESC);

-- Uso da IA (controle de custo e auditoria). O pedido fica guardado; dados do banco nunca são enviados.
CREATE TABLE IF NOT EXISTS ia_log (
  id             BIGSERIAL PRIMARY KEY,
  usuario_id     INT REFERENCES usuarios(id) ON DELETE SET NULL,
  cubo_id        INT REFERENCES cubos(id) ON DELETE SET NULL,
  pedido         TEXT NOT NULL,
  sucesso        BOOLEAN NOT NULL,
  erro           TEXT,
  modelo         VARCHAR(80),
  tokens_entrada INT,
  tokens_saida   INT,
  duracao_ms     INT,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ia_log_usuario_idx ON ia_log (usuario_id, criado_em DESC);
