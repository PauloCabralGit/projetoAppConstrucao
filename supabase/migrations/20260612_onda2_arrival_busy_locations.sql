-- ─────────────────────────────────────────────────────────────────────────────
-- ConstruConnect — Onda 2: fotos por etapa (chegada), presença "ocupado" e
-- restrição de leitura de localização (idempotent / não-quebra)
--
-- Seguro para aplicar em produção a qualquer momento: só ADICIONA etapa de foto,
-- coluna de chegada, trigger de status e RESTRINGE leitura de localização.
-- NÃO remove o UPDATE direto do prestador em service_requests — isso é a Fase 2
-- (arquivo separado), que só deve ser aplicada após o app em produção falar
-- com a API autenticada (Fase 1).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Etapa "chegada" nas fotos do prestador ───────────────────────────────
-- Adiciona 'provider_arrival' ao CHECK de request_photos.photo_type.
-- O nome do constraint segue o padrão do Postgres para CHECK de coluna inline.
ALTER TABLE request_photos DROP CONSTRAINT IF EXISTS request_photos_photo_type_check;
ALTER TABLE request_photos ADD CONSTRAINT request_photos_photo_type_check
  CHECK (photo_type IN ('client_request','provider_arrival','provider_start','provider_end'));

-- Índice para a contagem por etapa (limite de 5/etapa validado na API) e para
-- o agrupamento por etapa exibido ao cliente.
CREATE INDEX IF NOT EXISTS idx_request_photos_req_type ON request_photos(request_id, photo_type);

-- ── 2. Marco "prestador chegou" ──────────────────────────────────────────────
-- A API grava este timestamp quando o prestador envia a foto de chegada
-- (photo_type = 'provider_arrival'). O cliente usa para exibir "prestador chegou".
ALTER TABLE service_requests
  ADD COLUMN IF NOT EXISTS provider_arrived_at TIMESTAMPTZ;

-- ── 3. Presença "ocupado" (busy) via trigger ─────────────────────────────────
-- Mantém provider_profiles.status coerente com os chamados ativos do prestador:
--   • entra em accepted/in_progress  → status = 'busy' (não recebe novos)
--   • sai para completed/cancelled    → volta a 'available' SE estava 'busy'
-- O toggle manual do app só alterna available↔offline e nunca sobrescreve 'busy'
-- (o app aplica `WHERE status <> 'busy'`), evitando corrida com este trigger.
CREATE OR REPLACE FUNCTION sync_provider_busy() RETURNS trigger AS $$
BEGIN
  IF NEW.provider_user_id IS NOT NULL AND NEW.status IN ('accepted','in_progress') THEN
    UPDATE provider_profiles SET status = 'busy'
     WHERE user_id = NEW.provider_user_id AND status <> 'busy';
  ELSIF NEW.provider_user_id IS NOT NULL AND NEW.status IN ('completed','cancelled') THEN
    UPDATE provider_profiles SET status = 'available'
     WHERE user_id = NEW.provider_user_id AND status = 'busy';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_provider_busy ON service_requests;
CREATE TRIGGER trg_provider_busy
  AFTER INSERT OR UPDATE OF status, provider_user_id ON service_requests
  FOR EACH ROW EXECUTE FUNCTION sync_provider_busy();

-- ── 4. Localização legível apenas pelas partes de um chamado ativo ───────────
-- Antes: locations_select_public USING (true) — qualquer um com a anon key lia
-- a localização em tempo real de TODOS os prestadores. Agora: só o próprio
-- prestador e o cliente de um chamado accepted/in_progress com ele.
--
-- A coluna que identifica o prestador em provider_locations varia entre
-- ambientes (provider_user_id OU user_id), por isso descobrimos o nome real e
-- montamos a policy dinamicamente (mesma abordagem da migration 20260603).
DO $$
DECLARE
  loc_col TEXT;
BEGIN
  SELECT column_name INTO loc_col
  FROM information_schema.columns
  WHERE table_name = 'provider_locations'
    AND column_name IN ('provider_user_id', 'user_id')
  ORDER BY CASE column_name WHEN 'provider_user_id' THEN 0 ELSE 1 END
  LIMIT 1;

  IF loc_col IS NULL THEN
    RAISE EXCEPTION 'provider_locations: coluna de prestador (provider_user_id/user_id) não encontrada';
  END IF;

  EXECUTE 'DROP POLICY IF EXISTS "locations_select_public"  ON provider_locations';
  EXECUTE 'DROP POLICY IF EXISTS "locations_select_parties" ON provider_locations';
  EXECUTE format($f$
    CREATE POLICY "locations_select_parties" ON provider_locations
      FOR SELECT USING (
        auth.uid() = %1$I
        OR auth.uid() IN (
          SELECT client_user_id FROM service_requests
          WHERE service_requests.provider_user_id = provider_locations.%1$I
            AND status IN ('accepted','in_progress')
        )
      )
  $f$, loc_col);
END $$;
