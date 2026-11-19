-- =========================================================
-- Análises com vários cubos, filtros no topo e publicação como painel
-- =========================================================

-- Cubos usados pela análise (o primeiro é o principal, igual a cubo_id)
ALTER TABLE analises ADD COLUMN IF NOT EXISTS cubos JSONB NOT NULL DEFAULT '[]'::jsonb;
UPDATE analises SET cubos = jsonb_build_array(cubo_id) WHERE cubos = '[]'::jsonb;

-- Filtros do topo: [{ id, nome, cuboId, coluna, tipo, multiplo, padrao }]
ALTER TABLE analises ADD COLUMN IF NOT EXISTS filtros_topo JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Ligações entre cubos: as automáticas (colunas de mesmo nome) são calculadas na hora;
-- aqui ficam só os ajustes do usuário: { manuais: [{a:{cuboId,coluna}, b:{...}}], desligadas: [[cuboA, cuboB]] }
ALTER TABLE analises ADD COLUMN IF NOT EXISTS ligacoes JSONB NOT NULL DEFAULT '{"manuais":[],"desligadas":[]}'::jsonb;

-- Painel que mostra uma análise publicada (os gráficos vêm da análise; o menu e o acesso, do painel)
ALTER TABLE paineis ADD COLUMN IF NOT EXISTS analise_id INT REFERENCES analises(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX IF NOT EXISTS paineis_analise_uidx ON paineis (analise_id) WHERE analise_id IS NOT NULL;
