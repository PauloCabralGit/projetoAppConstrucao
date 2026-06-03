-- ─────────────────────────────────────────────
-- ConstruConnect — New feature tables (idempotent)
-- ─────────────────────────────────────────────

-- ── 1. Real-time chat messages ───────────────
CREATE TABLE IF NOT EXISTS messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id    UUID NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  sender_id     UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  sender_role   TEXT NOT NULL CHECK (sender_role IN ('client', 'provider')),
  content       TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_request_id ON messages(request_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at  ON messages(created_at);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "messages_select" ON messages;
CREATE POLICY "messages_select" ON messages FOR SELECT USING (
  auth.uid() IN (
    SELECT client_user_id  FROM service_requests WHERE id = messages.request_id
    UNION
    SELECT provider_user_id FROM service_requests WHERE id = messages.request_id
  )
);

DROP POLICY IF EXISTS "messages_insert" ON messages;
CREATE POLICY "messages_insert" ON messages FOR INSERT WITH CHECK (
  auth.uid() = sender_id
  AND auth.uid() IN (
    SELECT client_user_id  FROM service_requests WHERE id = request_id
    UNION
    SELECT provider_user_id FROM service_requests WHERE id = request_id
  )
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE messages;
  END IF;
END $$;


-- ── 2. Provider portfolio photos ─────────────
CREATE TABLE IF NOT EXISTS portfolio_photos (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_user_id  UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  url               TEXT NOT NULL,
  caption           TEXT,
  category          TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_portfolio_provider ON portfolio_photos(provider_user_id);

ALTER TABLE portfolio_photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "portfolio_select" ON portfolio_photos;
CREATE POLICY "portfolio_select" ON portfolio_photos FOR SELECT USING (true);

DROP POLICY IF EXISTS "portfolio_insert" ON portfolio_photos;
CREATE POLICY "portfolio_insert" ON portfolio_photos FOR INSERT WITH CHECK (
  auth.uid() = provider_user_id
);

DROP POLICY IF EXISTS "portfolio_delete" ON portfolio_photos;
CREATE POLICY "portfolio_delete" ON portfolio_photos FOR DELETE USING (
  auth.uid() = provider_user_id
);


-- ── 3. Multiple bids ─────────────────────────
CREATE TABLE IF NOT EXISTS bids (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id        UUID NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  provider_user_id  UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  amount            NUMERIC(10, 2) NOT NULL,
  notes             TEXT,
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (request_id, provider_user_id)
);

CREATE INDEX IF NOT EXISTS idx_bids_request_id ON bids(request_id);

ALTER TABLE bids ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bids_select_client" ON bids;
CREATE POLICY "bids_select_client" ON bids FOR SELECT USING (
  auth.uid() IN (SELECT client_user_id FROM service_requests WHERE id = bids.request_id)
  OR auth.uid() = provider_user_id
);

DROP POLICY IF EXISTS "bids_insert" ON bids;
CREATE POLICY "bids_insert" ON bids FOR INSERT WITH CHECK (
  auth.uid() = provider_user_id
);

DROP POLICY IF EXISTS "bids_update" ON bids;
CREATE POLICY "bids_update" ON bids FOR UPDATE USING (
  auth.uid() IN (SELECT client_user_id FROM service_requests WHERE id = bids.request_id)
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'bids'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE bids;
  END IF;
END $$;


-- ── 4. Formal complaints ─────────────────────
CREATE TABLE IF NOT EXISTS formal_complaints (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id        UUID NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  client_user_id    UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  provider_user_id  UUID REFERENCES app_users(id) ON DELETE SET NULL,
  reason            TEXT NOT NULL,
  description       TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open', 'investigating', 'resolved', 'dismissed')),
  admin_note        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_complaints_request  ON formal_complaints(request_id);
CREATE INDEX IF NOT EXISTS idx_complaints_provider ON formal_complaints(provider_user_id);

ALTER TABLE formal_complaints ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "complaints_select" ON formal_complaints;
CREATE POLICY "complaints_select" ON formal_complaints FOR SELECT USING (
  auth.uid() = client_user_id
);

DROP POLICY IF EXISTS "complaints_insert" ON formal_complaints;
CREATE POLICY "complaints_insert" ON formal_complaints FOR INSERT WITH CHECK (
  auth.uid() = client_user_id
);


-- ── 5. Provider certifications ───────────────
CREATE TABLE IF NOT EXISTS provider_certifications (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_user_id  UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  url               TEXT NOT NULL,
  issued_by         TEXT,
  issued_date       DATE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_certs_provider ON provider_certifications(provider_user_id);

ALTER TABLE provider_certifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "certs_select" ON provider_certifications;
CREATE POLICY "certs_select" ON provider_certifications FOR SELECT USING (true);

DROP POLICY IF EXISTS "certs_insert" ON provider_certifications;
CREATE POLICY "certs_insert" ON provider_certifications FOR INSERT WITH CHECK (
  auth.uid() = provider_user_id
);

DROP POLICY IF EXISTS "certs_delete" ON provider_certifications;
CREATE POLICY "certs_delete" ON provider_certifications FOR DELETE USING (
  auth.uid() = provider_user_id
);


-- ── 6. scheduled_date: TEXT → TIMESTAMPTZ ────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'service_requests' AND column_name = 'scheduled_date'
      AND data_type = 'text'
  ) THEN
    ALTER TABLE service_requests
      ALTER COLUMN scheduled_date TYPE TIMESTAMPTZ
      USING CASE
        WHEN scheduled_date ~ '^\d{4}-\d{2}-\d{2}$'
        THEN (scheduled_date || 'T00:00:00Z')::TIMESTAMPTZ
        ELSE scheduled_date::TIMESTAMPTZ
      END;
  END IF;
END $$;
