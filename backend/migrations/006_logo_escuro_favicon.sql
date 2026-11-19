-- Logo próprio para o tema escuro e ícone da aba do navegador (favicon)
ALTER TABLE config_aparencia ADD COLUMN IF NOT EXISTS logo_escuro_url VARCHAR(255);
ALTER TABLE config_aparencia ADD COLUMN IF NOT EXISTS favicon_url VARCHAR(255);
