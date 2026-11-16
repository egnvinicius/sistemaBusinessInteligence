-- Cubo pode vir de uma AÇÃO (a tabela que ela carrega no bi_dados) ou, como antes, de uma consulta de painel
ALTER TABLE cubos ALTER COLUMN consulta_id DROP NOT NULL;
ALTER TABLE cubos ADD COLUMN IF NOT EXISTS acao_id INT REFERENCES acoes(id) ON DELETE RESTRICT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cubos_uma_origem') THEN
    ALTER TABLE cubos ADD CONSTRAINT cubos_uma_origem CHECK (num_nonnulls(consulta_id, acao_id) = 1);
  END IF;
END $$;
