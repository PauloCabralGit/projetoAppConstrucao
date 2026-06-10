-- ============================================================================
-- Cartões salvos (Mercado Pago) — Fatia 0 da feature de pagamento com cartão
-- ============================================================================
-- Guarda APENAS referências não sensíveis (PCI-DSS): nunca PAN/CVV/token.
-- A tokenização acontece no device; o backend recebe só token (one-shot) e refs.
-- A escrita de cartões salvos é feita SÓ pela API (service key, ignora RLS);
-- o dono pode ler e remover os próprios (LGPD). Aditiva — sem downtime.
-- ============================================================================

-- ── mp_customer_id 1:1 no usuário (referência não sensível) ──────────────────
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS mp_customer_id TEXT;

-- ── Cartões salvos ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS saved_cards (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  mp_customer_id   TEXT NOT NULL,
  mp_card_id       TEXT NOT NULL,
  brand            TEXT,                 -- visa, master, etc (payment_method_id)
  last4            TEXT NOT NULL,
  exp_month        INT  NOT NULL CHECK (exp_month BETWEEN 1 AND 12),
  exp_year         INT  NOT NULL,
  cardholder_name  TEXT,
  is_default       BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, mp_card_id)
);

CREATE INDEX IF NOT EXISTS idx_saved_cards_user ON saved_cards(user_id);

-- No máx. 1 cartão preferido por usuário.
CREATE UNIQUE INDEX IF NOT EXISTS uq_saved_cards_default
  ON saved_cards(user_id) WHERE is_default;

-- ── RLS: dono lê/apaga os próprios; INSERT/UPDATE só via service key (API) ────
ALTER TABLE saved_cards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "saved_cards_select_own" ON saved_cards;
CREATE POLICY "saved_cards_select_own" ON saved_cards
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "saved_cards_delete_own" ON saved_cards;
CREATE POLICY "saved_cards_delete_own" ON saved_cards
  FOR DELETE USING (auth.uid() = user_id);
-- Sem policy de INSERT/UPDATE para anon/authenticated: criar cartão e marcar
-- preferido acontecem só pela API (service key). O fluxo padrão de remoção
-- também é via DELETE /v1/cards/:id (que apaga no MP antes); o DELETE direto
-- do dono fica como rede de segurança LGPD.

-- ── Auditoria do split: taxa do MP e parcelas por pagamento ──────────────────
ALTER TABLE payments ADD COLUMN IF NOT EXISTS mp_fee_amount NUMERIC(10,2) DEFAULT 0;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS installments  INT;
