-- ─────────────────────────────────────────────────────────────────────────────
-- ConstruConnect — Colunas ausentes do schema base (idempotent)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── app_users ─────────────────────────────────────────────────────────────────
ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS push_token       TEXT,
  ADD COLUMN IF NOT EXISTS pix_key          TEXT,
  ADD COLUMN IF NOT EXISTS last_seen_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS blocked_until    TIMESTAMPTZ;

-- ── provider_profiles ────────────────────────────────────────────────────────
ALTER TABLE provider_profiles
  ADD COLUMN IF NOT EXISTS last_seen_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS blocked_until    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verified         BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS mp_access_token  TEXT,
  ADD COLUMN IF NOT EXISTS mp_user_id       TEXT,
  ADD COLUMN IF NOT EXISTS mp_refresh_token TEXT;

-- ── service_requests ──────────────────────────────────────────────────────────
ALTER TABLE service_requests
  ADD COLUMN IF NOT EXISTS latitude         NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS longitude        NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS quote_amount     NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS quote_notes      TEXT,
  ADD COLUMN IF NOT EXISTS quote_status     TEXT,
  ADD COLUMN IF NOT EXISTS counter_amount   NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS payment_status   TEXT,
  ADD COLUMN IF NOT EXISTS payment_method   TEXT,
  ADD COLUMN IF NOT EXISTS client_rating    SMALLINT;

-- Constraints separadas (idempotentes via DO $$)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'service_requests_quote_status_check'
  ) THEN
    ALTER TABLE service_requests
      ADD CONSTRAINT service_requests_quote_status_check
      CHECK (quote_status IN ('quoted','negotiating','accepted') OR quote_status IS NULL);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'service_requests_payment_status_check'
  ) THEN
    ALTER TABLE service_requests
      ADD CONSTRAINT service_requests_payment_status_check
      CHECK (payment_status IN ('client_paid','confirmed','settled') OR payment_status IS NULL);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'service_requests_payment_method_check'
  ) THEN
    ALTER TABLE service_requests
      ADD CONSTRAINT service_requests_payment_method_check
      CHECK (payment_method IN ('pix','card','cash') OR payment_method IS NULL);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'service_requests_client_rating_check'
  ) THEN
    ALTER TABLE service_requests
      ADD CONSTRAINT service_requests_client_rating_check
      CHECK (client_rating BETWEEN 1 AND 5 OR client_rating IS NULL);
  END IF;
END $$;

-- ── request_photos ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS request_photos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  UUID NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  photo_type  TEXT NOT NULL CHECK (photo_type IN ('client_request','provider_start','provider_end')),
  url         TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_request_photos_request ON request_photos(request_id);

ALTER TABLE request_photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "request_photos_select" ON request_photos;
CREATE POLICY "request_photos_select" ON request_photos
  FOR SELECT USING (
    auth.uid() IN (
      SELECT client_user_id  FROM service_requests WHERE id = request_photos.request_id
      UNION
      SELECT provider_user_id FROM service_requests WHERE id = request_photos.request_id
    )
  );

DROP POLICY IF EXISTS "request_photos_insert" ON request_photos;
CREATE POLICY "request_photos_insert" ON request_photos
  FOR INSERT WITH CHECK (
    auth.uid() IN (
      SELECT client_user_id  FROM service_requests WHERE id = request_id
      UNION
      SELECT provider_user_id FROM service_requests WHERE id = request_id
    )
  );

-- ── Índices extras ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_app_users_last_seen ON app_users(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_provider_blocked    ON provider_profiles(blocked_until);
CREATE INDEX IF NOT EXISTS idx_sr_quote_status     ON service_requests(quote_status);
CREATE INDEX IF NOT EXISTS idx_sr_payment_method   ON service_requests(payment_method);
