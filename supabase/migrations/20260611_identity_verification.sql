-- ─────────────────────────────────────────────────────────────────────────────
-- ConstruConnect — Verificação de identidade (selfie + documento RG/CNH)
-- Revisão manual pelo admin; obrigatória para usar o app. (idempotent)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Status de verificação no usuário ───────────────────────────────────────
-- unverified | pending | approved | rejected
ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'unverified';

-- ── Tabela de verificações de identidade ───────────────────────────────────
CREATE TABLE IF NOT EXISTS identity_verifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  role          TEXT NOT NULL DEFAULT 'client',          -- client | provider
  doc_type      TEXT NOT NULL CHECK (doc_type IN ('rg', 'cnh')),
  selfie_path   TEXT NOT NULL,                            -- caminho no bucket "verifications"
  document_path TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'           -- pending | approved | rejected
                  CHECK (status IN ('pending', 'approved', 'rejected')),
  admin_note    TEXT,
  reviewed_by   UUID,
  reviewed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_idverif_user    ON identity_verifications(user_id);
CREATE INDEX IF NOT EXISTS idx_idverif_status  ON identity_verifications(status);
CREATE INDEX IF NOT EXISTS idx_idverif_created ON identity_verifications(created_at);

ALTER TABLE identity_verifications ENABLE ROW LEVEL SECURITY;

-- O app acessa via API (service role, que ignora RLS). Política mínima para o
-- usuário ler a própria verificação caso use o client autenticado.
DROP POLICY IF EXISTS "idverif_select_own" ON identity_verifications;
CREATE POLICY "idverif_select_own" ON identity_verifications
  FOR SELECT USING (auth.uid() = user_id);

-- ── Bucket de storage privado para selfies e documentos ────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('verifications', 'verifications', false)
ON CONFLICT (id) DO NOTHING;
