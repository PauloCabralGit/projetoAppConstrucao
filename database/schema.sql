CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE user_role AS ENUM ('client', 'builder', 'contractor', 'company', 'supplier');
CREATE TYPE service_request_status AS ENUM ('draft', 'requested', 'accepted', 'in_progress', 'completed', 'cancelled');
CREATE TYPE provider_status AS ENUM ('available', 'busy', 'offline');

CREATE TABLE app_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role user_role NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL,
  document_number TEXT NOT NULL,
  city TEXT NOT NULL,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE provider_profiles (
  user_id UUID PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  company_name TEXT,
  description TEXT NOT NULL DEFAULT '',
  status provider_status NOT NULL DEFAULT 'available',
  price_from NUMERIC(10, 2) NOT NULL DEFAULT 0,
  average_rating NUMERIC(3, 2) NOT NULL DEFAULT 5.0,
  completed_jobs INT NOT NULL DEFAULT 0,
  accepts_emergency_jobs BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL
);

CREATE TABLE provider_skills (
  provider_user_id UUID NOT NULL REFERENCES provider_profiles(user_id) ON DELETE CASCADE,
  skill_id UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  PRIMARY KEY (provider_user_id, skill_id)
);

CREATE TABLE client_addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  street TEXT NOT NULL,
  number TEXT NOT NULL,
  district TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  zip_code TEXT NOT NULL,
  reference_note TEXT
);

CREATE TABLE service_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  provider_user_id UUID REFERENCES provider_profiles(user_id) ON DELETE SET NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  city TEXT NOT NULL,
  budget_min NUMERIC(10, 2) NOT NULL,
  budget_max NUMERIC(10, 2) NOT NULL,
  scheduled_date DATE NOT NULL,
  status service_request_status NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE webauthn_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  counter BIGINT NOT NULL DEFAULT 0,
  transports TEXT[],
  device_type TEXT,
  backed_up BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE material_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_user_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  price NUMERIC(10, 2) NOT NULL,
  unit TEXT NOT NULL,
  city TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);
