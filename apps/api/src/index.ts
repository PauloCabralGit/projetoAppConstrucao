import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";
import type { RegistrationPayload } from "@construconnect/shared";

type Bindings = {
  APP_NAME: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
};

const app = new Hono<{ Bindings: Bindings }>();

const db = (env: Bindings) =>
  createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);

app.get("/", (c) =>
  c.json({
    name: c.env.APP_NAME,
    status: "ok",
    date: new Date().toISOString(),
    message: "API ConstruConnect com Supabase."
  })
);

app.get("/health", (c) => c.json({ ok: true }));

app.get("/v1/providers", async (c) => {
  const role = c.req.query("role");
  const city = c.req.query("city");

  let query = db(c.env)
    .from("provider_profiles")
    .select(`
      user_id,
      company_name,
      description,
      status,
      price_from,
      average_rating,
      completed_jobs,
      accepts_emergency_jobs,
      app_users!inner(id, full_name, role, city),
      provider_skills(skill_id, skills(slug, label))
    `);

  if (role) query = query.eq("app_users.role", role);
  if (city) query = query.ilike("app_users.city", `%${city}%`);

  const { data, error } = await query;
  if (error) return c.json({ error: error.message }, 500);

  return c.json({ data, total: data!.length });
});

app.get("/v1/requests", async (c) => {
  const { data, error } = await db(c.env)
    .from("service_requests")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return c.json({ error: error.message }, 500);

  return c.json({ data, total: data!.length });
});

app.post("/v1/register", async (c) => {
  const payload = (await c.req.json()) as RegistrationPayload;

  const { data: user, error: userError } = await db(c.env)
    .from("app_users")
    .insert({
      role: payload.role ?? "client",
      full_name: payload.fullName,
      email: payload.email,
      phone: payload.phone,
      document_number: payload.document ?? "",
      city: payload.city ?? ""
    })
    .select()
    .single();

  if (userError) return c.json({ error: userError.message }, 400);

  if (["builder", "contractor", "company", "supplier"].includes(user.role)) {
    const { error: profileError } = await db(c.env)
      .from("provider_profiles")
      .insert({
        user_id: user.id,
        description: "",
        company_name: payload.companyName ?? null,
        accepts_emergency_jobs: payload.acceptsEmergencyJobs ?? false
      });

    if (profileError) return c.json({ error: profileError.message }, 400);
  }

  return c.json({ message: "Cadastro realizado com sucesso.", data: user }, 201);
});

app.post("/v1/auth/webauthn/register-options", async (c) => {
  const body = await c.req.json<{ email?: string }>();
  const challenge = btoa(`${body.email ?? "anon"}-challenge-${Date.now()}`);

  return c.json({
    rp: { name: c.env.APP_NAME },
    challenge,
    userVerification: "preferred",
    timeout: 60000
  });
});

app.post("/v1/auth/webauthn/verify-registration", async (c) => {
  const payload = await c.req.json<{
    userId: string;
    credentialId: string;
    publicKey: string;
    transports?: string[];
  }>();

  const { error } = await db(c.env)
    .from("webauthn_credentials")
    .insert({
      user_id: payload.userId,
      credential_id: payload.credentialId,
      public_key: payload.publicKey,
      transports: payload.transports ?? []
    });

  if (error) return c.json({ error: error.message }, 400);

  return c.json({ verified: true, message: "Credencial WebAuthn registrada." });
});

export default app;
