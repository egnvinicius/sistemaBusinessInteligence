-- Ícone da aba do navegador para o tema escuro (sem ele, vale o do tema claro)
ALTER TABLE config_aparencia ADD COLUMN IF NOT EXISTS favicon_escuro_url VARCHAR(255);
