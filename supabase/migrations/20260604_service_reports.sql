-- ─────────────────────────────────────────────────────────────────────────────
-- ConstruConnect — Relatórios de serviço (idempotent)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Tabela de relatórios de serviço ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS service_reports (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id        UUID NOT NULL UNIQUE REFERENCES service_requests(id) ON DELETE CASCADE,
  client_user_id    UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  provider_user_id  UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,

  -- Avaliações (1-5)
  overall_rating    SMALLINT CHECK (overall_rating BETWEEN 1 AND 5),
  punctuality       SMALLINT CHECK (punctuality BETWEEN 1 AND 5),
  behavior          SMALLINT CHECK (behavior BETWEEN 1 AND 5),
  cleanliness       SMALLINT CHECK (cleanliness BETWEEN 1 AND 5),
  material_quality  SMALLINT CHECK (material_quality BETWEEN 1 AND 5),

  -- Tempo gasto (minutos)
  estimated_time    INTEGER,
  actual_time       INTEGER,

  -- Texto
  comments          TEXT,
  issues_found      TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_service_reports_request     ON service_reports(request_id);
CREATE INDEX IF NOT EXISTS idx_service_reports_client      ON service_reports(client_user_id);
CREATE INDEX IF NOT EXISTS idx_service_reports_provider    ON service_reports(provider_user_id);
CREATE INDEX IF NOT EXISTS idx_service_reports_created     ON service_reports(created_at);

ALTER TABLE service_reports ENABLE ROW LEVEL SECURITY;

-- Policy: Cliente e prestador veem seu próprio relatório
DROP POLICY IF EXISTS "reports_select_own" ON service_reports;
CREATE POLICY "reports_select_own" ON service_reports
  FOR SELECT USING (
    auth.uid() = client_user_id OR auth.uid() = provider_user_id
  );

-- Policy: Cliente insere seu próprio relatório
DROP POLICY IF EXISTS "reports_insert_client" ON service_reports;
CREATE POLICY "reports_insert_client" ON service_reports
  FOR INSERT WITH CHECK (
    auth.uid() = client_user_id
  );

-- Policy: Cliente atualiza seu próprio relatório
DROP POLICY IF EXISTS "reports_update_client" ON service_reports;
CREATE POLICY "reports_update_client" ON service_reports
  FOR UPDATE USING (
    auth.uid() = client_user_id
  );
