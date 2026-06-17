-- ─────────────────────────────────────────────────────────────────────────────
-- ConstruConnect — Billing por clique: métricas em ads + tabela ad_invoices
-- Idempotente: seguro para re-executar.
-- ─────────────────────────────────────────────────────────────────────────────

-- Adiciona métricas de cliques e billing à tabela ads
ALTER TABLE ads
  ADD COLUMN IF NOT EXISTS cost_per_click NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS clicks_total   INTEGER       NOT NULL DEFAULT 0;

-- Enum de status de fatura
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'invoice_status') THEN
    CREATE TYPE invoice_status AS ENUM ('pending', 'paid');
  END IF;
END$$;

-- Tabela para faturas de anunciantes (billing futuro)
CREATE TABLE IF NOT EXISTS ad_invoices (
  id                      UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_id                   UUID           NOT NULL REFERENCES ads(id) ON DELETE CASCADE,
  period_start            TIMESTAMPTZ    NOT NULL,
  period_end              TIMESTAMPTZ    NOT NULL,
  clicks_snapshot         INTEGER        NOT NULL DEFAULT 0,
  cost_per_click_snapshot NUMERIC(10,2)  NOT NULL DEFAULT 0,
  total_amount            NUMERIC(10,2)  NOT NULL
    GENERATED ALWAYS AS (clicks_snapshot * cost_per_click_snapshot) STORED,
  status                  invoice_status NOT NULL DEFAULT 'pending',
  created_at              TIMESTAMPTZ    NOT NULL DEFAULT now(),
  CONSTRAINT inv_period_check CHECK (period_end > period_start)
);

CREATE INDEX IF NOT EXISTS idx_ad_invoices_ad_id ON ad_invoices(ad_id);
CREATE INDEX IF NOT EXISTS idx_ad_invoices_status ON ad_invoices(status);

ALTER TABLE ad_invoices ENABLE ROW LEVEL SECURITY;
