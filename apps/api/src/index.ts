import { Hono } from "hono";
import { cors } from "hono/cors";
import { createClient } from "@supabase/supabase-js";
import type { RegistrationPayload } from "@construconnect/shared";

type Bindings = {
  APP_NAME: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use(cors({
  origin: ["https://projetoappconstrucao.pages.dev", "http://localhost:5173"],
  allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"]
}));

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

app.get("/v1/providers/available", async (c) => {
  const { data, error } = await db(c.env)
    .from("provider_profiles")
    .select(`
      user_id,
      status,
      accepts_emergency_jobs,
      average_rating,
      app_users!inner(full_name, city),
      provider_skills(skills(label))
    `)
    .eq("status", "available");

  if (error) return c.json({ error: error.message }, 500);

  const providers = (data ?? []).map((p: any) => ({
    id: p.user_id,
    full_name: p.app_users?.full_name ?? "",
    city: p.app_users?.city ?? "",
    specialties: ((p.provider_skills ?? []) as any[])
      .map((ps: any) => ps.skills?.label)
      .filter(Boolean)
      .join(", "),
    average_rating: p.average_rating,
    accepts_emergency_jobs: p.accepts_emergency_jobs,
  }));

  return c.json({ providers, total: providers.length });
});

app.patch("/v1/service-requests/:id/accept", async (c) => {
  const jobId = c.req.param("id");
  const body = await c.req.json<{ provider_user_id: string }>();

  if (!jobId || !body.provider_user_id) {
    return c.json({ message: "Parâmetros obrigatórios ausentes." }, 400);
  }

  const adminDb = db(c.env);

  // FK constraint: provider_user_id references provider_profiles(user_id)
  // Ensure the row exists before accepting (provider may have registered before this table was populated)
  await adminDb
    .from("provider_profiles")
    .upsert({ user_id: body.provider_user_id, description: "" }, { onConflict: "user_id" });

  const { data, error } = await adminDb
    .from("service_requests")
    .update({ status: "accepted", provider_user_id: body.provider_user_id })
    .eq("id", jobId)
    .eq("status", "requested")
    .select("id")
    .maybeSingle();

  if (error) return c.json({ message: error.message }, 400);
  if (!data) return c.json({ message: "Chamado não disponível ou já aceito." }, 409);

  return c.json({ id: data.id, message: "Chamado aceito com sucesso." });
});

app.patch("/v1/service-requests/:id/complete", async (c) => {
  const jobId = c.req.param("id");
  const body = await c.req.json<{ provider_user_id: string }>();

  if (!jobId || !body.provider_user_id) {
    return c.json({ message: "Parâmetros obrigatórios ausentes." }, 400);
  }

  const { error } = await db(c.env)
    .from("service_requests")
    .update({ status: "completed" })
    .eq("id", jobId)
    .eq("provider_user_id", body.provider_user_id);

  if (error) return c.json({ message: error.message }, 400);

  return c.json({ message: "Serviço concluído com sucesso." });
});

app.patch("/v1/service-requests/:id/cancel", async (c) => {
  const jobId = c.req.param("id");
  const body = await c.req.json<{ client_user_id: string }>();

  if (!jobId || !body.client_user_id) {
    return c.json({ message: "Parâmetros obrigatórios ausentes." }, 400);
  }

  const { error } = await db(c.env)
    .from("service_requests")
    .update({ status: "cancelled" })
    .eq("id", jobId)
    .eq("client_user_id", body.client_user_id);

  if (error) return c.json({ message: error.message }, 400);

  return c.json({ message: "Pedido cancelado com sucesso." });
});

app.post("/v1/service-requests", async (c) => {
  const body = await c.req.json<{
    client_user_id: string;
    category: string;
    description: string;
    latitude?: number;
    longitude?: number;
  }>();

  if (!body.client_user_id || !body.category || !body.description) {
    return c.json({ message: "Campos obrigatórios ausentes." }, 400);
  }

  const adminDb = db(c.env);

  const { data: userProfile } = await adminDb
    .from("app_users")
    .select("city")
    .eq("id", body.client_user_id)
    .maybeSingle();

  const today = new Date().toISOString().split("T")[0];

  const insertData: Record<string, unknown> = {
    client_user_id: body.client_user_id,
    category: body.category,
    description: body.description,
    status: "requested",
    city: userProfile?.city ?? "",
    budget_min: 0,
    budget_max: 0,
    scheduled_date: today,
  };

  if (body.latitude != null) insertData.latitude = body.latitude;
  if (body.longitude != null) insertData.longitude = body.longitude;

  const { data, error } = await adminDb
    .from("service_requests")
    .insert(insertData)
    .select("id")
    .single();

  if (error) return c.json({ message: error.message }, 400);

  return c.json({ id: data.id, message: "Pedido criado com sucesso." }, 201);
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

  if (!payload.fullName || !payload.email || !payload.password) {
    return c.json({ message: "Campos obrigatórios ausentes: fullName, email, password." }, 400);
  }

  const adminDb = db(c.env);

  // Create auth user via service key (no rate limit, auto-confirms email)
  const { data: authData, error: authError } = await adminDb.auth.admin.createUser({
    email: payload.email,
    password: payload.password,
    email_confirm: true,
    user_metadata: { full_name: payload.fullName, role: payload.role },
  });

  if (authError) {
    // If user already exists in auth, fetch their ID to proceed
    if (!authError.message.includes("already been registered")) {
      return c.json({ message: authError.message }, 400);
    }
    // User exists in auth — look up their ID so we can upsert the profile
    const { data: existing } = await adminDb.auth.admin.listUsers();
    const found = existing?.users?.find((u) => u.email === payload.email);
    if (!found) return c.json({ message: "Usuário já cadastrado. Faça login." }, 409);
    authData.user = found as typeof authData.user;
  }

  const userId = authData?.user?.id;
  if (!userId) return c.json({ message: "Erro interno ao obter ID do usuário." }, 500);

  // Remove orphaned app_users rows (from previous failed attempts with different UUID)
  await adminDb.from("app_users").delete().eq("email", payload.email).neq("id", userId);

  const { error: userError } = await adminDb
    .from("app_users")
    .upsert({
      id: userId,
      role: payload.role ?? "client",
      full_name: payload.fullName,
      email: payload.email,
      phone: payload.phone ?? "",
      document_number: payload.document ?? "",
      city: payload.city ?? "",
    }, { onConflict: "id" });

  if (userError) return c.json({ message: userError.message }, 400);

  const role = payload.role ?? "client";

  if (["builder", "contractor", "company", "supplier"].includes(role)) {
    const { error: profileError } = await adminDb
      .from("provider_profiles")
      .upsert({
        user_id: userId,
        description: "",
        company_name: payload.companyName ?? null,
        accepts_emergency_jobs: payload.acceptsEmergencyJobs ?? false,
      }, { onConflict: "user_id" });

    if (profileError) return c.json({ message: profileError.message }, 400);

    const specialtyLabels = (payload.specialties ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (specialtyLabels.length > 0) {
      const skillRows = specialtyLabels.map((label) => ({
        slug: label.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""),
        label,
      }));

      const { data: skills, error: skillsError } = await adminDb
        .from("skills")
        .upsert(skillRows, { onConflict: "slug" })
        .select("id");

      if (skillsError) return c.json({ message: skillsError.message }, 400);

      await adminDb.from("provider_skills").delete().eq("provider_user_id", userId);

      const providerSkillRows = (skills ?? []).map((skill: { id: string }) => ({
        provider_user_id: userId,
        skill_id: skill.id,
      }));

      if (providerSkillRows.length > 0) {
        const { error: linkError } = await adminDb
          .from("provider_skills")
          .insert(providerSkillRows);

        if (linkError) return c.json({ message: linkError.message }, 400);
      }
    }
  }

  return c.json({ message: "Cadastro realizado com sucesso." }, 201);
});

app.put("/v1/profile", async (c) => {
  const body = await c.req.json<{
    userId: string;
    fullName: string;
    phone: string;
    city: string;
    companyName?: string;
    specialties?: string;
    acceptsEmergencyJobs?: boolean;
    status?: string;
  }>();

  if (!body.userId) return c.json({ message: "userId obrigatório." }, 400);

  const adminDb = db(c.env);

  // Fetch role first (separate from update to avoid .single() on update)
  const { data: existing, error: fetchError } = await adminDb
    .from("app_users")
    .select("role")
    .eq("id", body.userId)
    .maybeSingle();

  if (fetchError) return c.json({ message: fetchError.message }, 400);

  if (!existing) {
    // User exists in auth but not in app_users — get metadata from auth and create the row
    const { data: authUser, error: authErr } = await adminDb.auth.admin.getUserById(body.userId);
    if (authErr || !authUser?.user) return c.json({ message: "Usuário não encontrado." }, 404);

    const meta = authUser.user.user_metadata ?? {};
    const email = authUser.user.email ?? "";

    // Remove orphaned rows with same email but different id
    await adminDb.from("app_users").delete().eq("email", email).neq("id", body.userId);

    const { error: upsertError } = await adminDb.from("app_users").upsert({
      id: body.userId,
      role: meta.role ?? "client",
      full_name: body.fullName ?? meta.full_name ?? "",
      email,
      phone: body.phone ?? "",
      city: body.city ?? "",
      document_number: "",
    }, { onConflict: "id" });
    if (upsertError) return c.json({ message: upsertError.message }, 400);

    return c.json({ message: "Perfil criado com sucesso." }, 200);
  }

  const { error: userError } = await adminDb
    .from("app_users")
    .update({ full_name: body.fullName, phone: body.phone ?? "", city: body.city ?? "" })
    .eq("id", body.userId);

  if (userError) return c.json({ message: userError.message }, 400);

  if (["builder", "contractor", "company", "supplier"].includes(existing.role)) {
    const profileUpdates: Record<string, unknown> = {};
    if (body.companyName !== undefined) profileUpdates.company_name = body.companyName;
    if (body.acceptsEmergencyJobs !== undefined) profileUpdates.accepts_emergency_jobs = body.acceptsEmergencyJobs;
    if (body.status !== undefined) profileUpdates.status = body.status;

    if (Object.keys(profileUpdates).length > 0) {
      const { error: profileError } = await adminDb
        .from("provider_profiles")
        .update(profileUpdates)
        .eq("user_id", body.userId);
      if (profileError) return c.json({ message: profileError.message }, 400);
    }

    if (body.specialties !== undefined) {
      const labels = body.specialties.split(",").map((s) => s.trim()).filter(Boolean);
      await adminDb.from("provider_skills").delete().eq("provider_user_id", body.userId);

      if (labels.length > 0) {
        const skillRows = labels.map((label) => ({
          slug: label.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""),
          label,
        }));
        const { data: skills, error: skillsError } = await adminDb
          .from("skills").upsert(skillRows, { onConflict: "slug" }).select("id");
        if (skillsError) return c.json({ message: skillsError.message }, 400);

        const linkRows = (skills ?? []).map((s: { id: string }) => ({
          provider_user_id: body.userId,
          skill_id: s.id,
        }));
        if (linkRows.length > 0) {
          const { error: linkError } = await adminDb.from("provider_skills").insert(linkRows);
          if (linkError) return c.json({ message: linkError.message }, 400);
        }
      }
    }
  }

  return c.json({ message: "Perfil atualizado com sucesso." }, 200);
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
