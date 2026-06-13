-- ─────────────────────────────────────────────────────────────────────────────
-- ConstruConnect — Propagandas: banners externos e prestadores patrocinados
-- Acesso somente via API admin (service role). RLS habilitado sem policies
-- públicas = nega tudo para anon/authenticated; service role ignora RLS.
-- Idempotente: seguro para re-executar.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Função auxiliar de updated_at (idempotente) ───────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ── Tabela de banners externos ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ads (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title           TEXT        NOT NULL,
  advertiser_name TEXT        NOT NULL DEFAULT '',
  image_url       TEXT        NOT NULL
                    CHECK (image_url LIKE 'https://%'),
  link_url        TEXT
                    CHECK (link_url IS NULL OR link_url LIKE 'https://%'),
  target          TEXT        NOT NULL DEFAULT 'both'
                    CHECK (target IN ('client', 'provider', 'both')),
  placement       TEXT        NOT NULL DEFAULT 'home'
                    CHECK (placement IN ('home', 'jobs')),
  active          BOOLEAN     NOT NULL DEFAULT false,
  starts_at       TIMESTAMPTZ,
  ends_at         TIMESTAMPTZ,
  priority        INT         NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ads_dates_check
    CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);

-- Índice composto para a query principal do app:
--   WHERE active = true AND placement = $1 AND (target = $2 OR target = 'both')
CREATE INDEX IF NOT EXISTS idx_ads_active_placement
  ON ads(active, placement, target);

-- Partial index para encontrar banners que expiraram (job de limpeza futura)
CREATE INDEX IF NOT EXISTS idx_ads_ends_at
  ON ads(ends_at)
  WHERE ends_at IS NOT NULL;

-- Listagem ordenada no CRM
CREATE INDEX IF NOT EXISTS idx_ads_created
  ON ads(created_at DESC);

ALTER TABLE ads ENABLE ROW LEVEL SECURITY;

-- Trigger de updated_at
DROP TRIGGER IF EXISTS ads_updated_at ON ads;
CREATE TRIGGER ads_updated_at
  BEFORE UPDATE ON ads
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Tabela de prestadores patrocinados ───────────────────────────────────────
-- Sem UNIQUE(provider_id): permite campanhas futuras agendadas para o mesmo
-- prestador. Constraint de "somente um ativo por prestador" é validada pelo
-- Worker no POST/PATCH active=true.
CREATE TABLE IF NOT EXISTS sponsored_providers (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID        NOT NULL
                REFERENCES provider_profiles(user_id) ON DELETE CASCADE,
  categories  TEXT[]      NOT NULL DEFAULT '{}',
  cities      TEXT[]      NOT NULL DEFAULT '{}',
  active      BOOLEAN     NOT NULL DEFAULT false,
  starts_at   TIMESTAMPTZ,
  ends_at     TIMESTAMPTZ,
  priority    INT         NOT NULL DEFAULT 0,
  notes       TEXT        NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT sp_dates_check
    CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);

-- Lookup por prestador (CRM e validação de conflito de ativo)
CREATE INDEX IF NOT EXISTS idx_sp_provider_id
  ON sponsored_providers(provider_id);

-- Query principal do app: ativos, ordenados por prioridade
CREATE INDEX IF NOT EXISTS idx_sp_active
  ON sponsored_providers(active, priority DESC);

-- Expiração
CREATE INDEX IF NOT EXISTS idx_sp_ends_at
  ON sponsored_providers(ends_at)
  WHERE ends_at IS NOT NULL;

ALTER TABLE sponsored_providers ENABLE ROW LEVEL SECURITY;

-- Trigger de updated_at
DROP TRIGGER IF EXISTS sp_updated_at ON sponsored_providers;
CREATE TRIGGER sp_updated_at
  BEFORE UPDATE ON sponsored_providers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
