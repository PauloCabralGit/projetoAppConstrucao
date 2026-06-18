-- ─────────────────────────────────────────────────────────────────────────────
-- Propagandas com múltiplas imagens (estilo Stories).
-- image_url permanece como a imagem de capa (usada no círculo do story e como
-- retrocompatibilidade). image_urls guarda a galeria completa exibida em tela cheia.
-- Idempotente: seguro para re-executar.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE ads
  ADD COLUMN IF NOT EXISTS image_urls TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN ads.image_urls IS 'Galeria de imagens do anúncio exibidas no story em tela cheia. A capa continua em image_url.';

-- Backfill: para anúncios já existentes, inicializa a galeria com a imagem de capa.
UPDATE ads
  SET image_urls = ARRAY[image_url]
  WHERE (image_urls IS NULL OR array_length(image_urls, 1) IS NULL)
    AND image_url IS NOT NULL
    AND image_url <> '';
