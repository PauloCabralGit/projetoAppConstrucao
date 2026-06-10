-- ============================================================================
-- Comentário e timestamp da avaliação simples (estrelas) do cliente
-- ============================================================================
-- O fluxo simples de avaliação (POST /v1/ratings) grava a nota em
-- service_requests.client_rating, mas não havia onde guardar o comentário
-- nem o momento da avaliação. Estas colunas suprem isso e alimentam:
--   • GET /v1/ratings/given          (histórico do cliente)
--   • GET /v1/providers/:id/ratings  (lista do prestador)
-- O comentário rico do relatório (service_reports.comments) continua existindo
-- e é usado como fallback quando client_rating_comment for nulo.
-- ============================================================================

ALTER TABLE service_requests
  ADD COLUMN IF NOT EXISTS client_rating_comment TEXT,
  ADD COLUMN IF NOT EXISTS client_rated_at       TIMESTAMPTZ;
