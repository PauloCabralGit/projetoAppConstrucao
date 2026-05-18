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

  const { data: user, error: userError } = await adminDb
    .from("app_users")
    .upsert({
      id: userId,
      role: payload.role ?? "client",
      full_name: payload.fullName,
      email: payload.email,
      phone: payload.phone ?? "",
      document_number: payload.document ?? "",
      city: payload.city ?? "",
    }, { onConflict: "id" })
    .select()
    .single();

  if (userError) return c.json({ message: userError.message }, 400);

  if (["builder", "contractor", "company", "supplier"].includes(user.role)) {
    const { error: profileError } = await adminDb
      .from("provider_profiles")
      .upsert({
        user_id: user.id,
        description: "",
        company_name: payload.companyName ?? null,
        accepts_emergency_jobs: payload.acceptsEmergencyJobs ?? false,
      }, { onConflict: "user_id" });

    if (profileError) return c.json({ message: profileError.message }, 400);

    // Save specialties: upsert into skills, then link via provider_skills
    const rawSpecialties = payload.specialties ?? "";
    const specialtyLabels = rawSpecialties
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

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

      // Remove old skills for this provider before re-linking
      await adminDb.from("provider_skills").delete().eq("provider_user_id", user.id);

      const providerSkillRows = (skills ?? []).map((skill: { id: string }) => ({
        provider_user_id: user.id,
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

  return c.json({ message: "Cadastro realizado com sucesso.", data: user }, 201);
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

  const { data: user, error: userError } = await adminDb
    .from("app_users")
    .update({ full_name: body.fullName, phone: body.phone ?? "", city: body.city ?? "" })
    .eq("id", body.userId)
    .select("role")
    .single();

  if (userError) return c.json({ message: userError.message }, 400);

  if (["builder", "contractor", "company", "supplier"].includes(user.role)) {
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
