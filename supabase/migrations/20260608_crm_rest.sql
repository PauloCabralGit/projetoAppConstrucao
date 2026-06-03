-- ─────────────────────────────────────────────────────────────────────────────
-- ConstruConnect — CRM: Marketing, Fornecedores/Estoque, Suporte, Agenda
-- Acesso somente via API admin (service role). RLS habilitado sem policies.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Marketing: campanhas ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_mkt_campanhas (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome        TEXT NOT NULL DEFAULT '',
  canal       TEXT NOT NULL DEFAULT '',
  orcamento   NUMERIC(12,2) NOT NULL DEFAULT 0,
  gasto       NUMERIC(12,2) NOT NULL DEFAULT 0,
  leads       INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'ativa',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE crm_mkt_campanhas ENABLE ROW LEVEL SECURITY;

-- ── Fornecedores ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_forn_fornecedores (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome        TEXT NOT NULL DEFAULT '',
  cnpj        TEXT NOT NULL DEFAULT '',
  categoria   TEXT NOT NULL DEFAULT '',
  contato     TEXT NOT NULL DEFAULT '',
  telefone    TEXT NOT NULL DEFAULT '',
  cidade      TEXT NOT NULL DEFAULT '',
  avaliacao   INTEGER NOT NULL DEFAULT 5,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE crm_forn_fornecedores ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS crm_forn_estoque (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item        TEXT NOT NULL DEFAULT '',
  categoria   TEXT NOT NULL DEFAULT '',
  quantidade  NUMERIC(12,2) NOT NULL DEFAULT 0,
  unidade     TEXT NOT NULL DEFAULT '',
  minimo      NUMERIC(12,2) NOT NULL DEFAULT 0,
  custo       NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE crm_forn_estoque ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS crm_forn_cotacoes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item        TEXT NOT NULL DEFAULT '',
  fornecedor  TEXT NOT NULL DEFAULT '',
  valor       NUMERIC(12,2) NOT NULL DEFAULT 0,
  prazo       TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'solicitada',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE crm_forn_cotacoes ENABLE ROW LEVEL SECURITY;

-- ── Suporte ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_sup_tickets (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assunto      TEXT NOT NULL DEFAULT '',
  solicitante  TEXT NOT NULL DEFAULT '',
  canal        TEXT NOT NULL DEFAULT 'app',
  prioridade   TEXT NOT NULL DEFAULT 'média',
  status       TEXT NOT NULL DEFAULT 'aberto',
  responsavel  TEXT NOT NULL DEFAULT '',
  abertura     TEXT NOT NULL DEFAULT '',
  resposta     TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE crm_sup_tickets ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS crm_sup_kb (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo      TEXT NOT NULL DEFAULT '',
  categoria   TEXT NOT NULL DEFAULT '',
  conteudo    TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE crm_sup_kb ENABLE ROW LEVEL SECURITY;

-- ── Agenda ───────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_agenda_tarefas (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo       TEXT NOT NULL DEFAULT '',
  responsavel  TEXT NOT NULL DEFAULT '',
  prioridade   TEXT NOT NULL DEFAULT 'média',
  prazo        TEXT NOT NULL DEFAULT '',
  concluida    BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE crm_agenda_tarefas ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS crm_agenda_compromissos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo         TEXT NOT NULL DEFAULT '',
  data           TEXT NOT NULL DEFAULT '',
  hora           TEXT NOT NULL DEFAULT '',
  participantes  TEXT NOT NULL DEFAULT '',
  tipo           TEXT NOT NULL DEFAULT 'reunião',
  notas          TEXT NOT NULL DEFAULT '',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE crm_agenda_compromissos ENABLE ROW LEVEL SECURITY;
