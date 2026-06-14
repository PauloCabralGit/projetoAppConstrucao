-- ─────────────────────────────────────────────────────────────────────────────
-- ConstruConnect — Segurança de Pagamentos (idempotente)
--
-- Implementa três camadas de defesa:
--  1. Trigger de segurança em service_requests — impede escrita direta de
--     campos críticos (payment_status, status, quote_status) via anon/JWT.
--     Somente o backend com service_key (role=service_role) pode alterar.
--  2. Políticas explícitas de DENY para escrita em payments, provider_splits
--     e provider_withdrawals via SDK do cliente.
--  3. Tabela de audit log imutável para todas as operações de pagamento.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Tabela de audit log de pagamentos ─────────────────────────────────────
-- Append-only: nenhum UPDATE/DELETE por usuários autenticados.
-- O backend insere via service_key; usuários só leem os próprios eventos.
CREATE TABLE IF NOT EXISTS payment_audit_log (
  id                 BIGSERIAL PRIMARY KEY,
  event_type         TEXT NOT NULL,                         -- 'attempt', 'approved', 'rejected', 'webhook', 'card_saved', 'card_removed', 'withdrawal_requested'
  service_request_id UUID REFERENCES service_requests(id) ON DELETE SET NULL,
  user_id            UUID,
  mp_payment_id      TEXT,
  amount             NUMERIC(10,2),
  status_before      TEXT,
  status_after       TEXT,
  ip_address         TEXT,
  metadata           JSONB,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pal_sr      ON payment_audit_log(service_request_id);
CREATE INDEX IF NOT EXISTS idx_pal_user    ON payment_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_pal_event   ON payment_audit_log(event_type);
CREATE INDEX IF NOT EXISTS idx_pal_created ON payment_audit_log(created_at DESC);

ALTER TABLE payment_audit_log ENABLE ROW LEVEL SECURITY;

-- Usuários autenticados só leem eventos vinculados a eles.
-- INSERT/UPDATE/DELETE não têm policy → implicitamente NEGADOS via RLS.
DROP POLICY IF EXISTS "pal_select_own" ON payment_audit_log;
CREATE POLICY "pal_select_own" ON payment_audit_log
  FOR SELECT USING (auth.uid() = user_id);


-- ── 2. Trigger de segurança em service_requests ───────────────────────────────
-- Camada de defesa em profundidade: mesmo que a RLS permita o UPDATE (ex.:
-- cliente cancela o pedido), o trigger bloqueia mudanças nos campos críticos.
-- O backend usa SUPABASE_SERVICE_KEY → role='service_role' → isento.

CREATE OR REPLACE FUNCTION enforce_sr_payment_security()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- service_role (backend com service key) e superusuários são isentos.
  IF current_role IN ('service_role', 'postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  -- Ninguém via SDK cliente pode confirmar pagamento (payment_status=confirmed).
  -- Isso só ocorre após captura bem-sucedida no Mercado Pago pelo backend.
  IF (NEW.payment_status = 'confirmed' AND
      OLD.payment_status IS DISTINCT FROM 'confirmed') THEN
    RAISE EXCEPTION 'security_violation: payment_status=confirmed is exclusive to the backend service role';
  END IF;

  -- Ninguém via SDK cliente pode aceitar o chamado (status=accepted).
  -- Isso só ocorre após pagamento aprovado e capturado.
  IF (NEW.status = 'accepted' AND OLD.status IS DISTINCT FROM 'accepted') THEN
    RAISE EXCEPTION 'security_violation: status=accepted is exclusive to the backend service role';
  END IF;

  -- Ninguém via SDK cliente pode marcar orçamento como aceito (quote_status=accepted).
  IF (NEW.quote_status = 'accepted' AND
      OLD.quote_status IS DISTINCT FROM 'accepted') THEN
    RAISE EXCEPTION 'security_violation: quote_status=accepted is exclusive to the backend service role';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_sr_payment_security ON service_requests;
CREATE TRIGGER tg_sr_payment_security
  BEFORE UPDATE ON service_requests
  FOR EACH ROW
  EXECUTE FUNCTION enforce_sr_payment_security();


-- ── 3. Políticas explícitas de DENY para payments ────────────────────────────
-- Sem essas policies, a ausência de policy já nega — mas ser explícito evita
-- que um operador reabilite por engano com um GRANT genérico.

DROP POLICY IF EXISTS "payments_no_client_insert" ON payments;
CREATE POLICY "payments_no_client_insert" ON payments
  FOR INSERT WITH CHECK (false);

DROP POLICY IF EXISTS "payments_no_client_update" ON payments;
CREATE POLICY "payments_no_client_update" ON payments
  FOR UPDATE USING (false);

DROP POLICY IF EXISTS "payments_no_client_delete" ON payments;
CREATE POLICY "payments_no_client_delete" ON payments
  FOR DELETE USING (false);


-- ── 4. Políticas explícitas de DENY para provider_splits ─────────────────────

DROP POLICY IF EXISTS "splits_no_client_insert" ON provider_splits;
CREATE POLICY "splits_no_client_insert" ON provider_splits
  FOR INSERT WITH CHECK (false);

DROP POLICY IF EXISTS "splits_no_client_update" ON provider_splits;
CREATE POLICY "splits_no_client_update" ON provider_splits
  FOR UPDATE USING (false);

DROP POLICY IF EXISTS "splits_no_client_delete" ON provider_splits;
CREATE POLICY "splits_no_client_delete" ON provider_splits
  FOR DELETE USING (false);


-- ── 5. Políticas explícitas de DENY para UPDATE/DELETE em provider_withdrawals
-- Prestadores podem solicitar saques (INSERT) mas não podem alterar status
-- ou excluir uma solicitação existente — apenas o backend o faz.

DROP POLICY IF EXISTS "withdrawals_no_client_update" ON provider_withdrawals;
CREATE POLICY "withdrawals_no_client_update" ON provider_withdrawals
  FOR UPDATE USING (false);

DROP POLICY IF EXISTS "withdrawals_no_client_delete" ON provider_withdrawals;
CREATE POLICY "withdrawals_no_client_delete" ON provider_withdrawals
  FOR DELETE USING (false);


-- ── 6. Coluna missing: installments em payments ───────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payments' AND column_name = 'installments'
  ) THEN
    ALTER TABLE payments ADD COLUMN installments INT DEFAULT 1;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payments' AND column_name = 'mp_fee_amount'
  ) THEN
    ALTER TABLE payments ADD COLUMN mp_fee_amount NUMERIC(10,2) DEFAULT 0;
  END IF;
END $$;
