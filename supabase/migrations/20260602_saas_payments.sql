-- ─────────────────────────────────────────────────────────────────────────────
-- ConstruConnect — SaaS + Payments (idempotent)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Índices de performance ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_sr_status          ON service_requests(status);
CREATE INDEX IF NOT EXISTS idx_sr_client          ON service_requests(client_user_id);
CREATE INDEX IF NOT EXISTS idx_sr_provider        ON service_requests(provider_user_id);
CREATE INDEX IF NOT EXISTS idx_sr_created         ON service_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sr_payment_status  ON service_requests(payment_status);
CREATE INDEX IF NOT EXISTS idx_app_users_email    ON app_users(email);
CREATE INDEX IF NOT EXISTS idx_provider_status    ON provider_profiles(status);


-- ── 2. RLS nas tabelas core ───────────────────────────────────────────────────

ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_select_own" ON app_users;
CREATE POLICY "users_select_own" ON app_users
  FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "users_update_own" ON app_users;
CREATE POLICY "users_update_own" ON app_users
  FOR UPDATE USING (auth.uid() = id);

ALTER TABLE provider_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "provider_profiles_select_public" ON provider_profiles;
CREATE POLICY "provider_profiles_select_public" ON provider_profiles
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "provider_profiles_update_own" ON provider_profiles;
CREATE POLICY "provider_profiles_update_own" ON provider_profiles
  FOR UPDATE USING (auth.uid() = user_id);

ALTER TABLE service_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sr_select_involved" ON service_requests;
CREATE POLICY "sr_select_involved" ON service_requests
  FOR SELECT USING (
    auth.uid() = client_user_id OR auth.uid() = provider_user_id
  );

DROP POLICY IF EXISTS "sr_insert_client" ON service_requests;
CREATE POLICY "sr_insert_client" ON service_requests
  FOR INSERT WITH CHECK (auth.uid() = client_user_id);

DROP POLICY IF EXISTS "sr_update_involved" ON service_requests;
CREATE POLICY "sr_update_involved" ON service_requests
  FOR UPDATE USING (
    auth.uid() = client_user_id OR auth.uid() = provider_user_id
  );


-- ── 3. Tabela de pagamentos ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_request_id  UUID NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  mp_payment_id       TEXT NOT NULL UNIQUE,
  amount              NUMERIC(10,2) NOT NULL,
  platform_fee        NUMERIC(10,2) NOT NULL DEFAULT 0,
  provider_amount     NUMERIC(10,2) NOT NULL DEFAULT 0,
  payment_method      TEXT NOT NULL CHECK (payment_method IN ('pix','card','cash')),
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','approved','rejected','refunded','settled')),
  payer_email         TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_payments_sr     ON payments(service_request_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_mp_id  ON payments(mp_payment_id);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payments_select_involved" ON payments;
CREATE POLICY "payments_select_involved" ON payments
  FOR SELECT USING (
    auth.uid() IN (
      SELECT client_user_id FROM service_requests WHERE id = payments.service_request_id
      UNION
      SELECT provider_user_id FROM service_requests WHERE id = payments.service_request_id
    )
  );


-- ── 4. Splits (repasse ao prestador) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS provider_splits (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id        UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  provider_user_id  UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  amount            NUMERIC(10,2) NOT NULL,
  mp_split_id       TEXT,
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','transferred','failed')),
  transferred_at    TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_splits_provider ON provider_splits(provider_user_id);
CREATE INDEX IF NOT EXISTS idx_splits_payment  ON provider_splits(payment_id);

ALTER TABLE provider_splits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "splits_select_own" ON provider_splits;
CREATE POLICY "splits_select_own" ON provider_splits
  FOR SELECT USING (auth.uid() = provider_user_id);


-- ── 5. Assinaturas SaaS ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS provider_subscriptions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_user_id      UUID NOT NULL UNIQUE REFERENCES app_users(id) ON DELETE CASCADE,
  plan                  TEXT NOT NULL DEFAULT 'free'
                          CHECK (plan IN ('free','pro','premium')),
  mp_subscription_id    TEXT,
  status                TEXT NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active','cancelled','past_due','expired','pending')),
  current_period_end    TIMESTAMPTZ,
  monthly_job_count     INT NOT NULL DEFAULT 0,
  commission_rate       NUMERIC(4,2) NOT NULL DEFAULT 0.10,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subs_provider ON provider_subscriptions(provider_user_id);
CREATE INDEX IF NOT EXISTS idx_subs_status   ON provider_subscriptions(status);

ALTER TABLE provider_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "subs_select_own" ON provider_subscriptions;
CREATE POLICY "subs_select_own" ON provider_subscriptions
  FOR SELECT USING (auth.uid() = provider_user_id);

DROP POLICY IF EXISTS "subs_update_own" ON provider_subscriptions;
CREATE POLICY "subs_update_own" ON provider_subscriptions
  FOR UPDATE USING (auth.uid() = provider_user_id);


-- ── 6. Localização em tempo real ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS provider_locations (
  provider_user_id  UUID PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  latitude          NUMERIC(10,7) NOT NULL,
  longitude         NUMERIC(10,7) NOT NULL,
  heading           NUMERIC(5,2),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE provider_locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "locations_select_public" ON provider_locations;
CREATE POLICY "locations_select_public" ON provider_locations
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "locations_upsert_own" ON provider_locations;
CREATE POLICY "locations_upsert_own" ON provider_locations
  FOR ALL USING (auth.uid() = provider_user_id)
  WITH CHECK (auth.uid() = provider_user_id);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'provider_locations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE provider_locations;
  END IF;
END $$;


-- ── 7. Saques ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS provider_withdrawals (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_user_id  UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  amount            NUMERIC(10,2) NOT NULL,
  pix_key           TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'requested'
                      CHECK (status IN ('requested','processing','completed','failed')),
  mp_transfer_id    TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_withdrawals_provider ON provider_withdrawals(provider_user_id);

ALTER TABLE provider_withdrawals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "withdrawals_select_own" ON provider_withdrawals;
CREATE POLICY "withdrawals_select_own" ON provider_withdrawals
  FOR SELECT USING (auth.uid() = provider_user_id);

DROP POLICY IF EXISTS "withdrawals_insert_own" ON provider_withdrawals;
CREATE POLICY "withdrawals_insert_own" ON provider_withdrawals
  FOR INSERT WITH CHECK (auth.uid() = provider_user_id);


-- ── 8. Seed plano Free para prestadores existentes ───────────────────────────
INSERT INTO provider_subscriptions (provider_user_id, plan, status, commission_rate)
SELECT user_id, 'free', 'active', 0.10
FROM provider_profiles
ON CONFLICT (provider_user_id) DO NOTHING;
