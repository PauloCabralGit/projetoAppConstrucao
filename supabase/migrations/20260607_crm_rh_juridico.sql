-- ─────────────────────────────────────────────────────────────────────────────
-- ConstruConnect — CRM: RH e Jurídico
-- Acesso somente via API admin (service role). RLS habilitado sem policies.
-- Campos de data ficam como TEXT (ISO yyyy-mm-dd) para tolerar valores vazios.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── RH: equipe ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_rh_equipe (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome         TEXT NOT NULL DEFAULT '',
  cargo        TEXT NOT NULL DEFAULT '',
  departamento TEXT NOT NULL DEFAULT '',
  salario      NUMERIC(12,2) NOT NULL DEFAULT 0,
  beneficios   NUMERIC(12,2) NOT NULL DEFAULT 0,
  admissao     TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'ativo',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE crm_rh_equipe ENABLE ROW LEVEL SECURITY;

-- ── RH: vagas ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_rh_vagas (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cargo        TEXT NOT NULL DEFAULT '',
  departamento TEXT NOT NULL DEFAULT '',
  candidatos   INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'aberta',
  abertura     TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE crm_rh_vagas ENABLE ROW LEVEL SECURITY;

-- ── RH: ausências ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_rh_ausencias (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  colaborador  TEXT NOT NULL DEFAULT '',
  tipo         TEXT NOT NULL DEFAULT 'férias',
  inicio       TEXT NOT NULL DEFAULT '',
  fim          TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'pendente',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE crm_rh_ausencias ENABLE ROW LEVEL SECURITY;

-- ── Jurídico: contratos ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_jur_contratos (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo         TEXT NOT NULL DEFAULT '',
  contraparte  TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'vigente',
  inicio       TEXT NOT NULL DEFAULT '',
  fim          TEXT NOT NULL DEFAULT '',
  valor        NUMERIC(12,2) NOT NULL DEFAULT 0,
  obs          TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE crm_jur_contratos ENABLE ROW LEVEL SECURITY;

-- ── Jurídico: compliance ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_jur_compliance (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo       TEXT NOT NULL DEFAULT '',
  descricao    TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'pendente',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE crm_jur_compliance ENABLE ROW LEVEL SECURITY;

-- ── Jurídico: disputas ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_jur_disputas (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parte        TEXT NOT NULL DEFAULT '',
  tipo         TEXT NOT NULL DEFAULT 'cível',
  status       TEXT NOT NULL DEFAULT 'aberto',
  valor        NUMERIC(12,2) NOT NULL DEFAULT 0,
  advogado     TEXT NOT NULL DEFAULT '',
  obs          TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE crm_jur_disputas ENABLE ROW LEVEL SECURITY;
