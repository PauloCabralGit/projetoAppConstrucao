-- ─────────────────────────────────────────────────────────────────────────────
-- ConstruConnect — CRM: Log de auditoria (quem fez cada alteração)
-- Registrado automaticamente em toda mutação (POST/PATCH/DELETE) do /v1/admin/*.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS crm_audit_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_tipo   TEXT NOT NULL DEFAULT 'operador',  -- 'master' | 'operador'
  actor_id     UUID,                               -- crm_users.id (null p/ master)
  actor_nome   TEXT NOT NULL DEFAULT '',
  actor_email  TEXT NOT NULL DEFAULT '',
  acao         TEXT NOT NULL DEFAULT '',           -- criou | atualizou | excluiu | acesso negado
  area         TEXT NOT NULL DEFAULT '',
  recurso      TEXT NOT NULL DEFAULT '',           -- caminho do recurso
  registro_id  TEXT,                               -- id do registro afetado (quando houver)
  status       INTEGER NOT NULL DEFAULT 0,
  ip           TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_audit_created ON crm_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_audit_area    ON crm_audit_log(area);
CREATE INDEX IF NOT EXISTS idx_crm_audit_actor   ON crm_audit_log(actor_id);
ALTER TABLE crm_audit_log ENABLE ROW LEVEL SECURITY;
