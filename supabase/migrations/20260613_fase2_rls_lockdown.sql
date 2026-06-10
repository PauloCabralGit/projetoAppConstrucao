-- ============================================================================
-- Fase 2 — RLS lockdown de service_requests e bids
-- ============================================================================
--
-- CONTEXTO
-- Até a Fase 1, o boundary real de segurança era o RLS, porque os apps mobile
-- usam a chave anon e escreviam DIRETO nas tabelas (service_requests, bids).
-- A policy `sr_update_involved` permitia que QUALQUER envolvido (cliente OU
-- prestador) atualizasse QUALQUER coluna do chamado — incluindo status,
-- quote_amount e payment_status. Isso é privilégio demais para o cliente.
--
-- Na Fase 2 (refactor mobile) todas as transições passaram a ir pelos endpoints
-- da API, que escrevem com a SERVICE KEY (ignora RLS) e já validam auth/dono.
-- Esta migration fecha a porta: remove as policies de ESCRITA de service_requests
-- e bids. Com RLS habilitado e sem policy de escrita, anon/authenticated ficam
-- SOMENTE-LEITURA nessas tabelas; só a service key (API) escreve.
--
-- ⚠️ ORDEM DE ROLLOUT (importante)
-- Aplique esta migration SOMENTE depois que:
--   1. A API com os endpoints da Fase 2 estiver no ar (deploy:api), e
--   2. O novo build dos apps (mobile-client/mobile-provider) que usa os
--      endpoints estiver publicado/distribuído.
-- Se aplicar antes, builds antigos que ainda escrevem direto vão falhar
-- silenciosamente (criar pedido, aceitar orçamento, iniciar/concluir, etc.).
--
-- O QUE PERMANECE INTACTO
--   • SELECT: `sr_select_involved` e `bids_select_client` (leitura + Realtime).
--   • provider_locations: `locations_upsert_own` (prestador escreve sua posição).
--   • app_users: `users_update_own` (push_token / last_seen_at).
-- ============================================================================

-- ── service_requests: remover escrita direta ───────────────────────────────
-- Toda criação/transição agora é feita por endpoints (POST /service-requests,
-- /accept-quote, /start, /complete, /cancel, /payment-send, /bids/:id/accept …).
DROP POLICY IF EXISTS "sr_insert_client"   ON service_requests;
DROP POLICY IF EXISTS "sr_update_involved" ON service_requests;
-- (Nunca houve policy de DELETE em service_requests; segue negado por padrão.)

-- ── bids: remover escrita direta ───────────────────────────────────────────
-- Envio de orçamento  → POST /v1/service-requests/:id/bids
-- Aceite de orçamento → PATCH /v1/service-requests/:id/bids/:bidId/accept
DROP POLICY IF EXISTS "bids_insert" ON bids;
DROP POLICY IF EXISTS "bids_update" ON bids;

-- Garantia: RLS continua habilitado (sem policy de escrita = escrita negada).
ALTER TABLE service_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE bids             ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- ROLLBACK (descomente para reverter rapidamente, caso um build antigo ainda
-- precise escrever direto enquanto o novo não foi distribuído):
-- ----------------------------------------------------------------------------
-- CREATE POLICY "sr_insert_client" ON service_requests
--   FOR INSERT WITH CHECK (auth.uid() = client_user_id);
-- CREATE POLICY "sr_update_involved" ON service_requests
--   FOR UPDATE USING (auth.uid() = client_user_id OR auth.uid() = provider_user_id);
-- CREATE POLICY "bids_insert" ON bids
--   FOR INSERT WITH CHECK (auth.uid() = provider_user_id);
-- CREATE POLICY "bids_update" ON bids
--   FOR UPDATE USING (
--     auth.uid() IN (SELECT client_user_id FROM service_requests WHERE id = bids.request_id)
--   );
-- ============================================================================
