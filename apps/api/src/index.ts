import { Hono } from "hono";
import { cors } from "hono/cors";
import { createClient } from "@supabase/supabase-js";
import type { RegistrationPayload } from "@construconnect/shared";

type Bindings = {
  APP_NAME: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  MERCADOPAGO_ACCESS_TOKEN: string;
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

// ── Push notification helper ───────────────────────────────────────────────
async function sendPush(env: Bindings, userId: string, title: string, body: string) {
  try {
    const { data } = await db(env)
      .from("app_users")
      .select("push_token")
      .eq("id", userId)
      .maybeSingle();
    const token = data?.push_token;
    if (!token || !token.startsWith("ExponentPushToken")) return;
    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ to: token, title, body, sound: "default" }),
    });
  } catch {}
}

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
  const now = new Date().toISOString();
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
    .eq("status", "available")
    .or(`blocked_until.is.null,blocked_until.lt.${now}`);

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

  const { data: req } = await db(c.env)
    .from("service_requests")
    .select("client_user_id")
    .eq("id", jobId)
    .maybeSingle();

  const { error } = await db(c.env)
    .from("service_requests")
    .update({ status: "completed" })
    .eq("id", jobId)
    .eq("provider_user_id", body.provider_user_id);

  if (error) return c.json({ message: error.message }, 400);

  if (req?.client_user_id) {
    await sendPush(c.env, req.client_user_id, "✅ Serviço concluído!", "O prestador concluiu o serviço. Confira as fotos de evidência.");
  }

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
    pixKey?: string;
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

  const userUpdate: Record<string, unknown> = { full_name: body.fullName, phone: body.phone ?? "", city: body.city ?? "" };
  if (body.pixKey !== undefined) userUpdate.pix_key = body.pixKey;

  const { error: userError } = await adminDb
    .from("app_users")
    .update(userUpdate)
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

// ── Photo upload (base64 → Supabase Storage) ──────────────────────────────
app.post("/v1/photos/upload", async (c) => {
  const body = await c.req.json<{
    request_id: string;
    photo_type: "client_request" | "provider_start" | "provider_end";
    file_data: string;
    file_name?: string;
    mime_type?: string;
  }>();

  const fileData = body.file_data;
  if (!body.request_id || !fileData || !body.photo_type) {
    return c.json({ message: "Parâmetros obrigatórios ausentes." }, 400);
  }

  const binaryStr = atob(fileData);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

  const filePath = `${body.request_id}/${body.photo_type}/${Date.now()}.jpg`;

  const { error: storageError } = await db(c.env).storage
    .from("request-photos")
    .upload(filePath, bytes, { contentType: "image/jpeg", upsert: true });

  if (storageError) {
    return c.json({ message: `Erro no upload: ${storageError.message}` }, 500);
  }

  const publicUrl = `${c.env.SUPABASE_URL}/storage/v1/object/public/request-photos/${filePath}`;

  const { error } = await db(c.env).from("request_photos").insert({
    request_id: body.request_id,
    photo_type: body.photo_type,
    url: publicUrl,
  });

  if (error) return c.json({ message: error.message }, 400);

  return c.json({ url: publicUrl });
});

// ── Get photos for a request ───────────────────────────────────────────────
app.get("/v1/service-requests/:id/photos", async (c) => {
  const { data, error } = await db(c.env)
    .from("request_photos")
    .select("id, photo_type, url, created_at")
    .eq("request_id", c.req.param("id"))
    .order("created_at");

  if (error) return c.json({ error: error.message }, 500);
  return c.json({ photos: data ?? [] });
});

// ── Provider submits quote ─────────────────────────────────────────────────
app.post("/v1/service-requests/:id/quote", async (c) => {
  const body = await c.req.json<{
    provider_user_id: string;
    quote_amount: number;
    quote_notes?: string;
  }>();

  if (!body.provider_user_id || body.quote_amount == null) {
    return c.json({ message: "Parâmetros obrigatórios ausentes." }, 400);
  }

  const adminDb = db(c.env);
  await adminDb
    .from("provider_profiles")
    .upsert({ user_id: body.provider_user_id, description: "" }, { onConflict: "user_id" });

  const { error, data: updated } = await adminDb
    .from("service_requests")
    .update({
      provider_user_id: body.provider_user_id,
      quote_amount: body.quote_amount,
      quote_notes: body.quote_notes ?? null,
      quote_status: "quoted",
    })
    .eq("id", c.req.param("id"))
    .eq("status", "requested")
    .is("quote_status", null)
    .select("id, client_user_id");

  if (error) return c.json({ message: error.message }, 400);
  if (!updated || updated.length === 0) {
    return c.json({ message: "Este chamado já possui um orçamento ou não está disponível." }, 409);
  }

  const amountStr = `R$ ${body.quote_amount.toFixed(2).replace(".", ",")}`;
  await sendPush(c.env, updated[0].client_user_id, "💰 Orçamento recebido!", `Um profissional enviou um orçamento de ${amountStr}. Toque para ver.`);

  return c.json({ message: "Orçamento enviado com sucesso." });
});

// ── Client accepts quote → status: accepted ────────────────────────────────
app.patch("/v1/service-requests/:id/accept-quote", async (c) => {
  const body = await c.req.json<{ client_user_id: string }>();
  const id = c.req.param("id");

  const { data: req } = await db(c.env)
    .from("service_requests")
    .select("provider_user_id, quote_amount")
    .eq("id", id)
    .maybeSingle();

  const { error } = await db(c.env)
    .from("service_requests")
    .update({ status: "accepted", quote_status: "accepted" })
    .eq("id", id)
    .eq("client_user_id", body.client_user_id)
    .eq("quote_status", "quoted");

  if (error) return c.json({ message: error.message }, 400);

  if (req?.provider_user_id) {
    const amountStr = req.quote_amount ? `R$ ${Number(req.quote_amount).toFixed(2).replace(".", ",")}` : "";
    await sendPush(c.env, req.provider_user_id, "✅ Orçamento aceito!", `O cliente aceitou seu orçamento${amountStr ? ` de ${amountStr}` : ""}. Prepare-se para o deslocamento!`);
  }

  return c.json({ message: "Orçamento aceito." });
});

// ── Client counter-proposes ────────────────────────────────────────────────
app.patch("/v1/service-requests/:id/counter", async (c) => {
  const body = await c.req.json<{ client_user_id: string; counter_amount: number }>();
  const id = c.req.param("id");

  if (body.counter_amount == null) return c.json({ message: "Valor obrigatório." }, 400);

  const { data: req } = await db(c.env)
    .from("service_requests")
    .select("provider_user_id")
    .eq("id", id)
    .maybeSingle();

  const { error } = await db(c.env)
    .from("service_requests")
    .update({ counter_amount: body.counter_amount, quote_status: "negotiating" })
    .eq("id", id)
    .eq("client_user_id", body.client_user_id);

  if (error) return c.json({ message: error.message }, 400);

  if (req?.provider_user_id) {
    const amountStr = `R$ ${Number(body.counter_amount).toFixed(2).replace(".", ",")}`;
    await sendPush(c.env, req.provider_user_id, "🔄 Contra-proposta recebida", `O cliente propôs ${amountStr}. Abra o app para responder.`);
  }

  return c.json({ message: "Contra-proposta enviada." });
});

// ── Provider accepts counter → status: accepted ────────────────────────────
app.patch("/v1/service-requests/:id/accept-counter", async (c) => {
  const body = await c.req.json<{ provider_user_id: string }>();
  const id = c.req.param("id");

  const adminDb = db(c.env);
  const { data: req } = await adminDb
    .from("service_requests")
    .select("counter_amount, client_user_id")
    .eq("id", id)
    .maybeSingle();

  const { error } = await adminDb
    .from("service_requests")
    .update({
      status: "accepted",
      quote_status: "accepted",
      quote_amount: req?.counter_amount ?? null,
    })
    .eq("id", id)
    .eq("provider_user_id", body.provider_user_id)
    .eq("quote_status", "negotiating");

  if (error) return c.json({ message: error.message }, 400);

  if (req?.client_user_id) {
    await sendPush(c.env, req.client_user_id, "✅ Proposta aceita!", "O prestador aceitou sua contra-proposta. Ele está a caminho!");
  }

  return c.json({ message: "Contra-proposta aceita. Serviço confirmado." });
});

// ── Client marks payment sent ─────────────────────────────────────────────
app.patch("/v1/service-requests/:id/payment-send", async (c) => {
  const body = await c.req.json<{ client_user_id: string; payment_method?: string }>();
  const id = c.req.param("id");

  if (!body.client_user_id) return c.json({ message: "client_user_id obrigatório." }, 400);

  const { data: req } = await db(c.env)
    .from("service_requests")
    .select("provider_user_id, quote_amount")
    .eq("id", id)
    .maybeSingle();

  const { error } = await db(c.env)
    .from("service_requests")
    .update({ payment_status: "client_paid", payment_method: body.payment_method ?? "pix" })
    .eq("id", id)
    .eq("client_user_id", body.client_user_id)
    .eq("status", "completed");

  if (error) return c.json({ message: error.message }, 400);

  if (req?.provider_user_id) {
    const amountStr = req.quote_amount ? `R$ ${Number(req.quote_amount).toFixed(2).replace(".", ",")}` : "";
    await sendPush(c.env, req.provider_user_id, "💳 Pagamento enviado!", `O cliente informou que enviou o pagamento${amountStr ? ` de ${amountStr}` : ""}. Confirme o recebimento no app.`);
  }

  return c.json({ message: "Pagamento registrado." });
});

// ── Provider confirms payment received ────────────────────────────────────
app.patch("/v1/service-requests/:id/payment-confirm", async (c) => {
  const body = await c.req.json<{ provider_user_id: string }>();
  const id = c.req.param("id");

  if (!body.provider_user_id) return c.json({ message: "provider_user_id obrigatório." }, 400);

  const { data: req } = await db(c.env)
    .from("service_requests")
    .select("client_user_id, quote_amount")
    .eq("id", id)
    .maybeSingle();

  const { error } = await db(c.env)
    .from("service_requests")
    .update({ payment_status: "confirmed" })
    .eq("id", id)
    .eq("provider_user_id", body.provider_user_id)
    .eq("payment_status", "client_paid");

  if (error) return c.json({ message: error.message }, 400);

  if (req?.client_user_id) {
    await sendPush(c.env, req.client_user_id, "✅ Pagamento confirmado!", "O prestador confirmou o recebimento do pagamento. Obrigado!");
  }

  return c.json({ message: "Pagamento confirmado." });
});

// ── Client rates provider ──────────────────────────────────────────────────
app.post("/v1/service-requests/:id/rate", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ rating: number; client_user_id: string }>();

  if (!body.rating || body.rating < 1 || body.rating > 5) {
    return c.json({ message: "Avaliação inválida (1 a 5 estrelas)." }, 400);
  }
  const rating = Math.round(body.rating);

  const { data: req } = await db(c.env)
    .from("service_requests")
    .select("provider_user_id, client_rating, status, client_user_id")
    .eq("id", id)
    .maybeSingle();

  if (!req) return c.json({ message: "Pedido não encontrado." }, 404);
  if (req.status !== "completed") return c.json({ message: "Serviço não concluído." }, 400);
  if (req.client_rating != null) return c.json({ message: "Pedido já avaliado." }, 400);
  if (req.client_user_id !== body.client_user_id) return c.json({ message: "Não autorizado." }, 403);

  await db(c.env)
    .from("service_requests")
    .update({ client_rating: rating })
    .eq("id", id);

  // Recalculate provider average from all rated completed jobs
  const { data: allRatings } = await db(c.env)
    .from("service_requests")
    .select("client_rating")
    .eq("provider_user_id", req.provider_user_id)
    .not("client_rating", "is", null);

  const values = (allRatings ?? []).map((r: any) => Number(r.client_rating));
  const avg = values.reduce((a: number, b: number) => a + b, 0) / values.length;
  const roundedAvg = Math.round(avg * 10) / 10;

  const providerUpdate: Record<string, unknown> = { average_rating: roundedAvg };

  if (roundedAvg < 4.6) {
    const blockedUntil = new Date();
    blockedUntil.setMonth(blockedUntil.getMonth() + 1);
    providerUpdate.blocked_until = blockedUntil.toISOString();
    providerUpdate.status = "offline";
    await sendPush(
      c.env,
      req.provider_user_id!,
      "⚠️ Conta suspensa",
      `Sua avaliação média é ${roundedAvg}⭐. Você foi suspenso por 30 dias da plataforma.`
    );
  }

  await db(c.env)
    .from("provider_profiles")
    .update(providerUpdate)
    .eq("user_id", req.provider_user_id);

  return c.json({ ok: true, average_rating: roundedAvg, blocked: roundedAvg < 4.6 });
});

// ── Provider starts job → status: in_progress ─────────────────────────────
app.patch("/v1/service-requests/:id/start", async (c) => {
  const body = await c.req.json<{ provider_user_id: string }>();
  const id = c.req.param("id");

  const { data: req } = await db(c.env)
    .from("service_requests")
    .select("client_user_id")
    .eq("id", id)
    .maybeSingle();

  const { error } = await db(c.env)
    .from("service_requests")
    .update({ status: "in_progress" })
    .eq("id", id)
    .eq("provider_user_id", body.provider_user_id)
    .eq("status", "accepted");

  if (error) return c.json({ message: error.message }, 400);

  if (req?.client_user_id) {
    await sendPush(c.env, req.client_user_id, "🔨 Serviço iniciado!", "O prestador chegou ao local e iniciou o serviço.");
  }

  return c.json({ message: "Serviço iniciado." });
});

// ── Mercado Pago helper ───────────────────────────────────────────────────
async function createMercadoPagoPix(env: Bindings, params: {
  amount: number;
  description: string;
  payerEmail: string;
  payerName: string;
  payerDocument?: string;
  externalReference: string;
}) {
  const nameParts = params.payerName.trim().split(" ");
  const firstName = nameParts[0] ?? "Cliente";
  const lastName = nameParts.slice(1).join(" ") || "ConstruConnect";

  const payer: Record<string, unknown> = {
    email: params.payerEmail,
    first_name: firstName,
    last_name: lastName,
  };
  if (params.payerDocument) {
    payer.identification = { type: "CPF", number: params.payerDocument.replace(/\D/g, "") };
  }

  const res = await fetch("https://api.mercadopago.com/v1/payments", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.MERCADOPAGO_ACCESS_TOKEN}`,
      "X-Idempotency-Key": params.externalReference,
    },
    body: JSON.stringify({
      transaction_amount: params.amount,
      description: params.description,
      payment_method_id: "pix",
      external_reference: params.externalReference,
      payer,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(err);
  }

  const data = await res.json() as any;
  return {
    mpPaymentId: String(data.id),
    qrCode: (data.point_of_interaction?.transaction_data?.qr_code ?? "") as string,
    qrCodeBase64: (data.point_of_interaction?.transaction_data?.qr_code_base64 ?? "") as string,
  };
}

// ── Gerar Pix via Mercado Pago ────────────────────────────────────────────
app.post("/v1/service-requests/:id/create-pix", async (c) => {
  const id = c.req.param("id");

  if (!c.env.MERCADOPAGO_ACCESS_TOKEN) {
    return c.json({ message: "Integração com Mercado Pago não configurada." }, 503);
  }

  const adminDb = db(c.env);

  const { data: req } = await adminDb
    .from("service_requests")
    .select("quote_amount, category, client_user_id, status")
    .eq("id", id)
    .maybeSingle();

  if (!req || req.status !== "completed") {
    return c.json({ message: "Serviço não encontrado ou não concluído." }, 400);
  }
  if (!req.quote_amount) {
    return c.json({ message: "Valor do serviço não definido." }, 400);
  }

  const { data: client } = await adminDb
    .from("app_users")
    .select("full_name, email, document_number")
    .eq("id", req.client_user_id)
    .maybeSingle();

  try {
    const pixData = await createMercadoPagoPix(c.env, {
      amount: Number(req.quote_amount),
      description: `Serviço de ${req.category} - ConstruConnect`,
      payerEmail: (client as any)?.email ?? `cliente_${req.client_user_id}@construconnect.app`,
      payerName: (client as any)?.full_name ?? "Cliente",
      payerDocument: (client as any)?.document_number || undefined,
      externalReference: id,
    });

    return c.json({
      qrCode: pixData.qrCode,
      qrCodeBase64: pixData.qrCodeBase64,
      mpPaymentId: pixData.mpPaymentId,
      amount: Number(req.quote_amount),
    });
  } catch (err: any) {
    return c.json({ message: err.message ?? "Erro ao gerar Pix." }, 500);
  }
});

// ── Webhook Mercado Pago (pagamento aprovado) ─────────────────────────────
app.post("/v1/webhooks/mercadopago", async (c) => {
  try {
    const body = await c.req.json<{ type?: string; data?: { id?: string } }>();

    if (body.type !== "payment" || !body.data?.id) return c.json({ ok: true });
    if (!c.env.MERCADOPAGO_ACCESS_TOKEN) return c.json({ ok: true });

    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${body.data.id}`, {
      headers: { Authorization: `Bearer ${c.env.MERCADOPAGO_ACCESS_TOKEN}` },
    });
    if (!mpRes.ok) return c.json({ ok: true });

    const payment = await mpRes.json() as any;
    if (payment.status !== "approved") return c.json({ ok: true });

    const serviceRequestId = payment.external_reference;
    if (!serviceRequestId) return c.json({ ok: true });

    const adminDb = db(c.env);

    const { data: req } = await adminDb
      .from("service_requests")
      .select("client_user_id, provider_user_id, payment_status")
      .eq("id", serviceRequestId)
      .maybeSingle();

    if (!req || req.payment_status === "confirmed") return c.json({ ok: true });

    await adminDb
      .from("service_requests")
      .update({ payment_status: "confirmed", payment_method: "pix" })
      .eq("id", serviceRequestId);

    if (req.client_user_id) {
      await sendPush(c.env, req.client_user_id, "✅ Pagamento confirmado!", "Seu Pix foi aprovado automaticamente.");
    }
    if (req.provider_user_id) {
      await sendPush(c.env, req.provider_user_id, "💳 Pagamento recebido!", "O pagamento via Pix foi aprovado. O cliente será notificado.");
    }

    return c.json({ ok: true });
  } catch {
    return c.json({ ok: true });
  }
});

export default app;
