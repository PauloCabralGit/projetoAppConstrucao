-- ─────────────────────────────────────────────────────────────────────────────
-- ConstruConnect — Telemedicina (parceria)
-- Configuração do parceiro + log de acessos para contador de consultas.
-- Idempotente (IF NOT EXISTS / DROP IF EXISTS antes de criar policies).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Configuração do parceiro ───────────────────────────────────────────────
-- Tabela singleton no MVP: o Worker garante no máximo um registro via upsert.
CREATE TABLE IF NOT EXISTS telemedicine_config (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_name        TEXT        NOT NULL DEFAULT '',
  partner_description TEXT        NOT NULL DEFAULT '',
  access_url          TEXT        NOT NULL DEFAULT '',   -- https:// ou deeplink do parceiro
  is_active           BOOLEAN     NOT NULL DEFAULT false, -- false = card bloqueado no app
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sem políticas de leitura para anon/authenticated: todo acesso passa pelo Worker
-- (service_role, que ignora RLS). RLS habilitada como rede de segurança.
ALTER TABLE telemedicine_config ENABLE ROW LEVEL SECURITY;

-- ── Log de acessos (cliques em "Acessar agora") ───────────────────────────
-- Cada linha = um clique do usuário no botão de acesso ao parceiro.
-- user_role é desnormalizado para simplificar queries de relatório sem JOIN.
CREATE TABLE IF NOT EXISTS telemedicine_access_log (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  user_role   TEXT        NOT NULL CHECK (user_role IN ('client', 'provider')),
  accessed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Índices ────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_telemedicine_log_user ON telemedicine_access_log(user_id);
CREATE INDEX IF NOT EXISTS idx_telemedicine_log_date ON telemedicine_access_log(accessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_telemedicine_log_role ON telemedicine_access_log(user_role, accessed_at DESC);

-- ── RLS — telemedicine_access_log ─────────────────────────────────────────
ALTER TABLE telemedicine_access_log ENABLE ROW LEVEL SECURITY;

-- Usuário pode ler apenas o próprio histórico (acesso direto via SDK, não via Worker).
-- INSERT é feito exclusivamente pelo Worker com service_role — sem política de INSERT.
DROP POLICY IF EXISTS "telemedicine_log_select_own" ON telemedicine_access_log;
CREATE POLICY "telemedicine_log_select_own" ON telemedicine_access_log
  FOR SELECT USING (auth.uid() = user_id);
