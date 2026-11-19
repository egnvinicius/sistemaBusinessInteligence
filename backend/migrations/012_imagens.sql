-- =========================================================
-- Biblioteca de imagens (logos, ícones, fotos) usadas no visual "Imagem"
-- =========================================================
CREATE TABLE IF NOT EXISTS imagens (
  id            SERIAL PRIMARY KEY,
  nome          VARCHAR(120) NOT NULL,
  -- Identificador público do arquivo (o endereço não expõe o id sequencial)
  chave         UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  arquivo       VARCHAR(200) NOT NULL,
  formato       VARCHAR(10) NOT NULL,
  tamanho       INT NOT NULL,
  largura       INT,
  altura        INT,
  criado_por    INT REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS imagens_nome_uidx ON imagens (LOWER(nome));

-- O visual "imagem" passa a ser um tipo aceito nos painéis
ALTER TABLE painel_visuais DROP CONSTRAINT IF EXISTS painel_visuais_tipo_check;
ALTER TABLE painel_visuais ADD CONSTRAINT painel_visuais_tipo_check
  CHECK (tipo IN ('kpi', 'barra', 'linha', 'pizza', 'tabela', 'imagem'));
