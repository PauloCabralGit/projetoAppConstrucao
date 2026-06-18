-- ─────────────────────────────────────────────────────────────────────────────
-- Registro de aceite do Termo de Uso / Consentimento (LGPD) no cadastro.
-- Guarda a versão aceita e o momento do aceite por usuário.
-- Idempotente: seguro para re-executar.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS terms_version     TEXT,
  ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;

COMMENT ON COLUMN app_users.terms_version IS 'Versão do Termo de Uso aceita pelo usuário no cadastro.';
COMMENT ON COLUMN app_users.terms_accepted_at IS 'Data/hora em que o usuário aceitou o Termo de Uso.';
