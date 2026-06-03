-- ─────────────────────────────────────────────────────────────────────────────
-- ConstruConnect — Correções de Realtime (idempotent)
-- ─────────────────────────────────────────────────────────────────────────────
-- Sem REPLICA IDENTITY FULL, os eventos UPDATE do Realtime trazem apenas a
-- chave primária no registro "old", então comparações como
-- `old.status !== new.status` ou `old.payment_status !== new.payment_status`
-- falham (old vem indefinido) e geram notificações duplicadas ou ausentes.

ALTER TABLE service_requests REPLICA IDENTITY FULL;
ALTER TABLE bids             REPLICA IDENTITY FULL;

-- Garantir que as tabelas relevantes estão na publicação do Realtime
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'service_requests'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE service_requests;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'bids'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE bids;
  END IF;
END $$;
