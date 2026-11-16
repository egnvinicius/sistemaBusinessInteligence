-- Cor de fundo do painel, uma para cada tema (NULL = padrão do sistema)
ALTER TABLE paineis ADD COLUMN IF NOT EXISTS fundo_claro VARCHAR(7);
ALTER TABLE paineis ADD COLUMN IF NOT EXISTS fundo_escuro VARCHAR(7);
