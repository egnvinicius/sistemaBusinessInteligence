-- =========================================================
-- Expiração da sessão por usuário
--   sessao_meia_noite: a sessão termina às 0h (fuso das agendas)
--   sessao_inatividade_horas: a sessão termina depois de X horas sem uso
--   nenhum dos dois: a sessão não expira (torres de controle)
-- =========================================================
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS sessao_meia_noite BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS sessao_inatividade_horas SMALLINT
  CHECK (sessao_inatividade_horas BETWEEN 1 AND 720);

-- Quem já existia mantém o comportamento de antes: sessão encerrada após 7 dias sem uso
UPDATE usuarios SET sessao_inatividade_horas = 168 WHERE sessao_inatividade_horas IS NULL AND NOT sessao_meia_noite;

-- Última atividade da sessão (passa de um refresh token para o seguinte) e por que ela expira
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS ultima_atividade_em TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS motivo_expiracao VARCHAR(20);
