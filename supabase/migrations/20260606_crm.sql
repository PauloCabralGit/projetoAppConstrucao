-- ─────────────────────────────────────────────────────────────────────────────
-- ConstruConnect — CRM: Vendas (leads) e Financeiro (lançamentos/faturas)
-- Acesso somente via API admin (service role). RLS habilitado sem policies
-- públicas = nega tudo para anon/authenticated; service role ignora RLS.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Vendas: leads ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_leads (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome         TEXT NOT NULL,
  empresa      TEXT NOT NULL DEFAULT '',
  telefone     TEXT NOT NULL DEFAULT '',
  email        TEXT NOT NULL DEFAULT '',
  valor        NUMERIC(12,2) NOT NULL DEFAULT 0,
  origem       TEXT NOT NULL DEFAULT 'outro',
  estagio      TEXT NOT NULL DEFAULT 'novo',
  responsavel  TEXT NOT NULL DEFAULT '',
  notas        TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_leads_estagio ON crm_leads(estagio);
CREATE INDEX IF NOT EXISTS idx_crm_leads_created ON crm_leads(created_at DESC);
ALTER TABLE crm_leads ENABLE ROW LEVEL SECURITY;

-- ── Financeiro: lançamentos ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_lancamentos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  data        DATE NOT NULL,
  descricao   TEXT NOT NULL DEFAULT '',
  categoria   TEXT NOT NULL DEFAULT 'outros',
  tipo        TEXT NOT NULL DEFAULT 'despesa',
  valor       NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_lancamentos_data ON crm_lancamentos(data DESC);
ALTER TABLE crm_lancamentos ENABLE ROW LEVEL SECURITY;

-- ── Financeiro: faturas ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_faturas (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parte       TEXT NOT NULL DEFAULT '',
  direcao     TEXT NOT NULL DEFAULT 'receber',
  valor       NUMERIC(12,2) NOT NULL DEFAULT 0,
  vencimento  DATE,
  status      TEXT NOT NULL DEFAULT 'pendente',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_faturas_venc ON crm_faturas(vencimento);
ALTER TABLE crm_faturas ENABLE ROW LEVEL SECURITY;
