-- ─────────────────────────────────────────────────────────────────────────────
-- ConstruConnect — CRM: Controle de acesso por área (operadores + sessões)
-- Gerenciado pelo dono (chave admin master). Acesso só via API admin.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS crm_users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome        TEXT NOT NULL DEFAULT '',
  email       TEXT NOT NULL UNIQUE,
  senha_hash  TEXT NOT NULL DEFAULT '',
  perfil      TEXT NOT NULL DEFAULT 'operador',  -- 'admin' = todas as áreas
  areas       TEXT[] NOT NULL DEFAULT '{}',       -- chaves de área permitidas
  ativo       BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE crm_users ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS crm_sessions (
  token       TEXT PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES crm_users(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_sessions_user ON crm_sessions(user_id);
ALTER TABLE crm_sessions ENABLE ROW LEVEL SECURITY;
