-- Índices para montar o menu e checar permissões rapidamente
CREATE INDEX IF NOT EXISTS ix_usuario_grupo_grupo     ON usuario_grupo(grupo_usuario_id);
CREATE INDEX IF NOT EXISTS ix_painel_permissao_grupo  ON painel_permissao(grupo_usuario_id);
CREATE INDEX IF NOT EXISTS ix_menu_subgrupos_grupo    ON menu_subgrupos(menu_grupo_id);
CREATE INDEX IF NOT EXISTS ix_paineis_subgrupo        ON paineis(menu_subgrupo_id);

-- Nomes únicos dentro do mesmo nível do menu (sem diferenciar maiúsculas)
CREATE UNIQUE INDEX IF NOT EXISTS ux_menu_grupos_nome     ON menu_grupos (LOWER(nome));
CREATE UNIQUE INDEX IF NOT EXISTS ux_menu_subgrupos_nome  ON menu_subgrupos (menu_grupo_id, LOWER(nome));
CREATE UNIQUE INDEX IF NOT EXISTS ux_paineis_nome         ON paineis (menu_subgrupo_id, LOWER(nome));
CREATE UNIQUE INDEX IF NOT EXISTS ux_grupos_usuarios_nome ON grupos_usuarios (LOWER(nome));
CREATE UNIQUE INDEX IF NOT EXISTS ux_usuarios_login       ON usuarios (LOWER(login));
CREATE UNIQUE INDEX IF NOT EXISTS ux_usuarios_email       ON usuarios (LOWER(email)) WHERE email IS NOT NULL;
