-- =========================================================
-- Acesso por grupo e subgrupo do menu, painéis públicos ou privados
-- e resumo da página inicial
-- =========================================================

-- Grupos de acesso liberados em cada grupo e subgrupo do menu.
-- Vale para baixo: liberar um grupo do menu libera todos os subgrupos dele.
CREATE TABLE IF NOT EXISTS menu_grupo_permissao (
  menu_grupo_id    INT NOT NULL REFERENCES menu_grupos(id) ON DELETE CASCADE,
  grupo_usuario_id INT NOT NULL REFERENCES grupos_usuarios(id) ON DELETE CASCADE,
  PRIMARY KEY (menu_grupo_id, grupo_usuario_id)
);
CREATE TABLE IF NOT EXISTS menu_subgrupo_permissao (
  menu_subgrupo_id INT NOT NULL REFERENCES menu_subgrupos(id) ON DELETE CASCADE,
  grupo_usuario_id INT NOT NULL REFERENCES grupos_usuarios(id) ON DELETE CASCADE,
  PRIMARY KEY (menu_subgrupo_id, grupo_usuario_id)
);

-- Ponto de partida: cada subgrupo libera os grupos que já veem algum painel dentro dele
INSERT INTO menu_subgrupo_permissao (menu_subgrupo_id, grupo_usuario_id)
SELECT DISTINCT p.menu_subgrupo_id, pp.grupo_usuario_id
  FROM paineis p JOIN painel_permissao pp ON pp.painel_id = p.id
ON CONFLICT DO NOTHING;

/** O usuário tem acesso ao subgrupo (direto, por um subgrupo acima ou pelo grupo do menu)? */
CREATE OR REPLACE FUNCTION usuario_acessa_subgrupo(p_usuario INT, p_subgrupo INT) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
  WITH RECURSIVE acima AS (
    SELECT id, subgrupo_pai_id, menu_grupo_id FROM menu_subgrupos WHERE id = p_subgrupo
    UNION ALL
    SELECT s.id, s.subgrupo_pai_id, s.menu_grupo_id FROM menu_subgrupos s JOIN acima a ON s.id = a.subgrupo_pai_id
  )
  SELECT EXISTS (
    SELECT 1 FROM acima a
      JOIN menu_subgrupo_permissao msp ON msp.menu_subgrupo_id = a.id
      JOIN usuario_grupo ug ON ug.grupo_usuario_id = msp.grupo_usuario_id
     WHERE ug.usuario_id = p_usuario
  ) OR EXISTS (
    SELECT 1 FROM menu_subgrupos s
      JOIN menu_grupo_permissao mgp ON mgp.menu_grupo_id = s.menu_grupo_id
      JOIN usuario_grupo ug ON ug.grupo_usuario_id = mgp.grupo_usuario_id
     WHERE s.id = p_subgrupo AND ug.usuario_id = p_usuario
  )
$$;

-- Quem vê o painel:
--   grupos   = os grupos de acesso marcados no painel (como sempre foi);
--   subgrupo = público: todos com acesso ao subgrupo do menu onde ele está;
--   privado  = só o dono (e Desenvolvedores)
ALTER TABLE paineis ADD COLUMN IF NOT EXISTS visibilidade VARCHAR(10) NOT NULL DEFAULT 'grupos'
  CHECK (visibilidade IN ('grupos', 'subgrupo', 'privado'));
ALTER TABLE paineis ADD COLUMN IF NOT EXISTS dono_id INT REFERENCES usuarios(id) ON DELETE SET NULL;
UPDATE paineis p SET dono_id = a.usuario_id FROM analises a WHERE a.id = p.analise_id AND p.dono_id IS NULL;

-- Resumo da página inicial: variacao | mudancas | ia | desligado
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS resumo_inicio VARCHAR(10) NOT NULL DEFAULT 'variacao'
  CHECK (resumo_inicio IN ('variacao', 'mudancas', 'ia', 'desligado'));

-- Valores vistos no resumo, um por dia, para mostrar a variação desde o acesso anterior
CREATE TABLE IF NOT EXISTS resumo_valores (
  usuario_id     INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  chave          VARCHAR(120) NOT NULL,
  dia            DATE NOT NULL,
  valor          NUMERIC,
  registrado_em  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (usuario_id, chave, dia)
);

-- Texto do resumo por IA, guardado por dia (evita custo a cada visita)
CREATE TABLE IF NOT EXISTS resumo_ia (
  usuario_id    INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  dia           DATE NOT NULL,
  textos        JSONB NOT NULL,
  gerado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (usuario_id, dia)
);

CREATE INDEX IF NOT EXISTS ix_auditoria_uso ON auditoria (usuario_id, acao, data_hora DESC);
