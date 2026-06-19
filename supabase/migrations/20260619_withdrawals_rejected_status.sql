-- ─────────────────────────────────────────────────────────────────────────────
-- Permite o status 'rejected' em provider_withdrawals.
-- O endpoint admin de reprovação grava 'rejected', mas o CHECK original só
-- aceitava requested/processing/completed/failed — fazendo o reject falhar.
-- 'rejected' libera o valor de volta ao saldo (igual a failed) pois o cálculo
-- de saldo só reserva requested/processing/completed.
-- Idempotente: seguro para re-executar.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE provider_withdrawals
  DROP CONSTRAINT IF EXISTS provider_withdrawals_status_check;

ALTER TABLE provider_withdrawals
  ADD CONSTRAINT provider_withdrawals_status_check
  CHECK (status IN ('requested', 'processing', 'completed', 'failed', 'rejected'));
