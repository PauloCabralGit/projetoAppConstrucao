import { Hono } from "hono";
import { cors } from "hono/cors";
import { createClient } from "@supabase/supabase-js";
import type { RegistrationPayload } from "@construconnect/shared";

type Bindings = {
  APP_NAME: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  MERCADOPAGO_ACCESS_TOKEN: string;
  ADMIN_KEY: string;
  FEATURE_FLAGS: KVNamespace;
};

const DEFAULT_FLAGS = [
  { key: "new_registrations",   label: "Novos cadastros",           description: "Permite que novos usuários e prestadores se cadastrem na plataforma.",       category: "Acesso",      enabled: true  },
  { key: "maintenance_mode",    label: "Modo de manutenção",         description: "Bloqueia o acesso ao app exibindo uma mensagem de manutenção.",              category: "Acesso",      enabled: false },
  { key: "emergency_requests",  label: "Pedidos de emergência",      description: "Habilita a opção de pedido urgente na criação de chamados.",                 category: "Chamados",    enabled: true  },
  { key: "provider_bidding",    label: "Sistema de lances",          description: "Permite que prestadores enviem propostas de valor para chamados.",           category: "Chamados",    enabled: true  },
  { key: "pix_payments",        label: "Pagamento via Pix",          description: "Habilita a geração de QR Code Pix para pagamentos.",                        category: "Pagamentos",  enabled: true  },
  { key: "cash_payments",       label: "Pagamento em dinheiro",      description: "Permite pagamento em dinheiro como forma de pagamento.",                    category: "Pagamentos",  enabled: true  },
  { key: "chat",                label: "Chat cliente-prestador",     description: "Habilita o sistema de mensagens entre clientes e prestadores.",              category: "Comunicação", enabled: true  },
  { key: "push_notifications",  label: "Notificações push",          description: "Habilita o envio de notificações push para usuários.",                      category: "Comunicação", enabled: true  },
  { key: "ratings",             label: "Avaliações",                 description: "Permite que clientes avaliem prestadores após o serviço.",                  category: "Qualidade",   enabled: true  },
  { key: "formal_complaints",   label: "Reclamações formais",        description: "Habilita o formulário de reclamação formal para clientes.",                 category: "Qualidade",   enabled: true  },
  { key: "provider_tracking",   label: "Rastreamento de prestador",  description: "Permite que clientes vejam a localização do prestador em tempo real.",     category: "Localização", enabled: true  },
];

async function getFlags(kv: KVNamespace) {
  const results = await Promise.all(
    DEFAULT_FLAGS.map(async (def) => {
      const stored = await kv.get(def.key, "json") as { enabled: boolean; updated_at: string } | null;
      return {
        ...def,
        enabled: stored != null ? stored.enabled : def.enabled,
        updated_at: stored?.updated_at ?? new Date(0).toISOString(),
      };
    })
  );
  return results.sort((a, b) => a.category.localeCompare(b.category) || a.key.localeCompare(b.key));
}

const app = new Hono<{ Bindings: Bindings }>();

app.use(cors({
  origin: ["https://projetoappconstrucao.pages.dev", "http://localhost:5173"],
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization", "x-admin-key"]
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
    const { data, error: dbErr } = await db(env)
      .from("app_users")
      .select("push_token")
      .eq("id", userId)
      .maybeSingle();
    if (dbErr) { console.error("[Push] DB error fetching token:", dbErr.message); return; }
    const token = data?.push_token;
    if (!token) { console.warn("[Push] No token for user:", userId); return; }
    if (!token.startsWith("ExponentPushToken")) { console.warn("[Push] Invalid token format:", token.slice(0, 30)); return; }
    const res = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ to: token, title, body, sound: "default" }),
    });
    const result = await res.json() as any;
    if (result?.data?.status === "error") {
      console.error("[Push] Expo error:", result.data.message, "details:", JSON.stringify(result.data.details));
    }
  } catch (err) {
    console.error("[Push] Exception:", err);
  }
}

app.get("/v1/providers", async (c) => {
  const role = c.req.query("role");
  const city = c.req.query("city");
  const now = new Date().toISOString();

  let query = db(c.env)
    .from("provider_profiles")
    .select(`
      user_id,
      company_name,
      description,
      status,
      last_seen_at,
      price_from,
      average_rating,
      completed_jobs,
      accepts_emergency_jobs,
      app_users!inner(id, full_name, role, city),
      provider_skills(skill_id, skills(slug, label))
    `)
    .or(`blocked_until.is.null,blocked_until.lt.${now}`);

  if (role) query = query.eq("app_users.role", role);
  if (city) query = query.ilike("app_users.city", `%${city}%`);

  const { data, error } = await query;
  if (error) return c.json({ error: error.message }, 500);

  return c.json({ data, total: data!.length });
});

app.get("/v1/providers/available", async (c) => {
  const now = new Date().toISOString();
  const heartbeatCutoff = new Date(Date.now() - 3 * 60 * 1000).toISOString();
  const { data, error } = await db(c.env)
    .from("provider_profiles")
    .select(`
      user_id,
      status,
      last_seen_at,
      accepts_emergency_jobs,
      average_rating,
      app_users!inner(full_name, city),
      provider_skills(skills(label))
    `)
    .eq("status", "available")
    .or(`blocked_until.is.null,blocked_until.lt.${now}`)
    .gt("last_seen_at", heartbeatCutoff);

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

app.post("/v1/service-requests/:id/reject", async (c) => {
  const jobId = c.req.param("id");
  const body = await c.req.json<{ provider_user_id: string; reason?: string }>().catch(() => ({} as any));
  if (!jobId || !body.provider_user_id) return c.json({ message: "Parâmetros obrigatórios ausentes." }, 400);
  return c.json({ message: "Chamado recusado." });
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
    scheduled_date?: string;
    preferred_provider_id?: string;
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

  const city = userProfile?.city ?? "";
  const scheduledDate = body.scheduled_date ?? new Date().toISOString().split("T")[0];

  const insertData: Record<string, unknown> = {
    client_user_id: body.client_user_id,
    category: body.category,
    description: body.description,
    status: "requested",
    city,
    budget_min: 0,
    budget_max: 0,
    scheduled_date: scheduledDate,
  };

  if (body.latitude != null) insertData.latitude = body.latitude;
  if (body.longitude != null) insertData.longitude = body.longitude;

  const { data, error } = await adminDb
    .from("service_requests")
    .insert(insertData)
    .select("id")
    .single();

  if (error) return c.json({ message: error.message }, 400);

  // Notify preferred provider directly (if specified)
  if (body.preferred_provider_id) {
    const catLabels2: Record<string, string> = {
      alvenaria: "Alvenaria", hidraulica: "Hidráulica", eletrica: "Elétrica",
      pintura: "Pintura", piso: "Piso", acabamento: "Acabamento",
    };
    await sendPush(
      c.env,
      body.preferred_provider_id,
      "⭐ Cliente quer te contratar!",
      `Um cliente escolheu você para um serviço de ${catLabels2[body.category] ?? body.category}. Abra o app para aceitar.`
    );
  }

  // Notify available providers in the same city
  if (city && !body.preferred_provider_id) {
    const { data: nearbyProviders } = await adminDb
      .from("provider_profiles")
      .select("user_id, app_users!user_id(push_token, city)")
      .eq("status", "available")
      .limit(50);

    const catLabels: Record<string, string> = {
      alvenaria: "Alvenaria", hidraulica: "Hidráulica", eletrica: "Elétrica",
      pintura: "Pintura", piso: "Piso", acabamento: "Acabamento",
    };
    const catLabel = catLabels[body.category] ?? body.category;

    for (const prov of nearbyProviders ?? []) {
      const user = Array.isArray((prov as any).app_users) ? (prov as any).app_users[0] : (prov as any).app_users;
      if (!user?.push_token?.startsWith("ExponentPushToken")) continue;
      if (user.city && !user.city.toLowerCase().includes(city.toLowerCase())) continue;
      await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          to: user.push_token,
          title: "🔨 Novo chamado disponível!",
          body: `Serviço de ${catLabel} em ${city}. Abra o app para aceitar.`,
          sound: "default",
        }),
      }).catch(() => {});
    }
  }

  return c.json({ id: data.id, message: "Pedido criado com sucesso." }, 201);
});

// ── Notify providers about a new request (insert already done on client) ──────
app.post("/v1/service-requests/:id/notify-providers", async (c) => {
  const body = await c.req.json<{
    category: string;
    city?: string;
    preferred_provider_id?: string;
  }>().catch(() => ({} as any));

  const adminDb = db(c.env);
  const catLabels: Record<string, string> = {
    alvenaria: "Alvenaria", hidraulica: "Hidráulica", eletrica: "Elétrica",
    pintura: "Pintura", piso: "Piso", acabamento: "Acabamento",
  };
  const catLabel = catLabels[body.category] ?? body.category;

  if (body.preferred_provider_id) {
    await sendPush(
      c.env,
      body.preferred_provider_id,
      "⭐ Cliente quer te contratar!",
      `Um cliente escolheu você para um serviço de ${catLabel}. Abra o app para aceitar.`
    );
  } else if (body.city) {
    const { data: nearbyProviders } = await adminDb
      .from("provider_profiles")
      .select("user_id, app_users!user_id(push_token, city)")
      .eq("status", "available")
      .limit(50);

    for (const prov of nearbyProviders ?? []) {
      const user = Array.isArray((prov as any).app_users) ? (prov as any).app_users[0] : (prov as any).app_users;
      if (!user?.push_token?.startsWith("ExponentPushToken")) continue;
      if (user.city && body.city && !user.city.toLowerCase().includes(body.city.toLowerCase())) continue;
      await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          to: user.push_token,
          title: "🔨 Novo chamado disponível!",
          body: `Serviço de ${catLabel} em ${body.city}. Abra o app para aceitar.`,
          sound: "default",
        }),
      }).catch(() => {});
    }
  }

  return c.json({ ok: true });
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

// ═══════════════════════════════════════════════════════════════════════════
// ADMIN ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════

function isAdmin(c: any): boolean {
  const key = c.req.header("x-admin-key");
  return !!c.env.ADMIN_KEY && key === c.env.ADMIN_KEY;
}

// ── Overview stats ────────────────────────────────────────────────────────
app.get("/v1/admin/overview", async (c) => {
  if (!isAdmin(c)) return c.json({ message: "Não autorizado." }, 401);
  const d = db(c.env);
  const now = new Date().toISOString();
  const heartbeatCutoff = new Date(Date.now() - 3 * 60 * 1000).toISOString();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [
    { data: usersRows },
    { data: providerRows },
    { data: activeRows },
    { data: completedRows },
    { data: blockedRows },
    { data: newUserRows },
    { data: revenueRows },
    { data: pendingRows },
    { data: openComplaintsRows },
    { data: onlineProviderRows },
    { data: onlineClientRows },
  ] = await Promise.all([
    d.from("app_users").select("id"),
    d.from("provider_profiles").select("user_id"),
    d.from("service_requests").select("id").in("status", ["requested", "accepted", "in_progress"]),
    d.from("service_requests").select("id").eq("status", "completed"),
    d.from("provider_profiles").select("user_id").gt("blocked_until", now),
    d.from("app_users").select("id").gte("created_at", sevenDaysAgo),
    d.from("service_requests").select("quote_amount").eq("payment_status", "confirmed"),
    d.from("service_requests").select("quote_amount").eq("payment_status", "client_paid"),
    d.from("formal_complaints").select("id, created_at").in("status", ["open", "investigating"]),
    d.from("provider_profiles").select("user_id").eq("status", "available").gt("last_seen_at", heartbeatCutoff),
    d.from("app_users").select("id").eq("role", "client").gt("last_seen_at", heartbeatCutoff),
  ]);

  const totalRevenue = (revenueRows ?? []).reduce((s: number, r: any) => s + Number(r.quote_amount ?? 0), 0);
  const pendingRevenue = (pendingRows ?? []).reduce((s: number, r: any) => s + Number(r.quote_amount ?? 0), 0);

  // SLA de reclamações abertas/em análise
  const nowMs = Date.now();
  const H24 = 24 * 60 * 60 * 1000;
  const H72 = 72 * 60 * 60 * 1000;
  const openList = openComplaintsRows ?? [];
  const slaOnTime  = openList.filter((c: any) => nowMs - new Date(c.created_at).getTime() < H24).length;
  const slaWarning = openList.filter((c: any) => { const a = nowMs - new Date(c.created_at).getTime(); return a >= H24 && a < H72; }).length;
  const slaCritical = openList.filter((c: any) => nowMs - new Date(c.created_at).getTime() >= H72).length;

  return c.json({
    totalUsers: (usersRows ?? []).length,
    totalProviders: (providerRows ?? []).length,
    activeRequests: (activeRows ?? []).length,
    completedJobs: (completedRows ?? []).length,
    totalRevenue,
    pendingRevenue,
    blockedProviders: (blockedRows ?? []).length,
    newUsers: (newUserRows ?? []).length,
    openComplaints: openList.length,
    onlineProviders: (onlineProviderRows ?? []).length,
    onlineClients: (onlineClientRows ?? []).length,
    sla: { onTime: slaOnTime, warning: slaWarning, critical: slaCritical },
  });
});

// ── All requests ──────────────────────────────────────────────────────────
app.get("/v1/admin/requests", async (c) => {
  if (!isAdmin(c)) return c.json({ message: "Não autorizado." }, 401);
  const status = c.req.query("status");
  let q = db(c.env)
    .from("service_requests")
    .select("id, category, description, status, city, quote_amount, payment_status, payment_method, client_rating, created_at, client_user_id, provider_user_id")
    .order("created_at", { ascending: false })
    .limit(300);
  if (status) q = q.eq("status", status);
  const { data } = await q;
  return c.json({ data: data ?? [] });
});

// ── All providers ─────────────────────────────────────────────────────────
app.get("/v1/admin/providers", async (c) => {
  if (!isAdmin(c)) return c.json({ message: "Não autorizado." }, 401);
  const { data, error } = await db(c.env)
    .from("provider_profiles")
    .select(`user_id, status, last_seen_at, average_rating, completed_jobs, blocked_until,
      app_users!user_id(full_name, email, city, phone, created_at)`)
    .order("average_rating", { ascending: false })
    .limit(300);
  if (error) console.error("admin/providers error:", JSON.stringify(error));
  return c.json({ data: data ?? [] });
});

// ── All users ─────────────────────────────────────────────────────────────
app.get("/v1/admin/users", async (c) => {
  if (!isAdmin(c)) return c.json({ message: "Não autorizado." }, 401);
  const { data, error } = await db(c.env)
    .from("app_users")
    .select("id, full_name, email, phone, city, role, created_at, blocked_until")
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) console.error("admin/users error:", JSON.stringify(error));
  return c.json({ data: data ?? [] });
});

// ── Payments ──────────────────────────────────────────────────────────────
app.get("/v1/admin/payments", async (c) => {
  if (!isAdmin(c)) return c.json({ message: "Não autorizado." }, 401);
  const { data } = await db(c.env)
    .from("service_requests")
    .select("id, category, city, quote_amount, payment_status, payment_method, created_at, client_user_id, provider_user_id")
    .in("payment_status", ["client_paid", "confirmed"])
    .order("created_at", { ascending: false })
    .limit(300);
  return c.json({ data: data ?? [] });
});

// ── Complaints (formal + low ratings + cancelled) ─────────────────────────
app.get("/v1/admin/complaints", async (c) => {
  if (!isAdmin(c)) return c.json({ message: "Não autorizado." }, 401);
  const d = db(c.env);

  const [{ data: formalRaw }, { data: lowRated }, { data: cancelled }] = await Promise.all([
    d.from("formal_complaints")
      .select("id, reason, description, status, admin_note, created_at, request_id, client_user_id, provider_user_id")
      .order("created_at", { ascending: false })
      .limit(100),
    d.from("service_requests")
      .select("id, category, city, description, client_rating, status, created_at, client_user_id, provider_user_id")
      .lte("client_rating", 2)
      .not("client_rating", "is", null)
      .order("created_at", { ascending: false })
      .limit(150),
    d.from("service_requests")
      .select("id, category, city, description, client_rating, status, created_at, client_user_id, provider_user_id")
      .eq("status", "cancelled")
      .order("created_at", { ascending: false })
      .limit(150),
  ]);

  // Enrich formal complaints with user + request details
  let formal: any[] = [];
  if (formalRaw && formalRaw.length > 0) {
    const userIds = [...new Set([
      ...formalRaw.map((f: any) => f.client_user_id),
      ...formalRaw.map((f: any) => f.provider_user_id).filter(Boolean),
    ])];
    const requestIds = [...new Set(formalRaw.map((f: any) => f.request_id))];

    const [{ data: users }, { data: requests }] = await Promise.all([
      d.from("app_users").select("id, full_name, phone, email, city").in("id", userIds),
      d.from("service_requests")
        .select("id, category, description, city, quote_amount, scheduled_date, status, payment_status")
        .in("id", requestIds),
    ]);

    const userMap: Record<string, any> = Object.fromEntries((users ?? []).map((u: any) => [u.id, u]));
    const reqMap: Record<string, any> = Object.fromEntries((requests ?? []).map((r: any) => [r.id, r]));

    formal = formalRaw.map((f: any) => ({
      ...f,
      client: userMap[f.client_user_id] ?? null,
      provider: f.provider_user_id ? (userMap[f.provider_user_id] ?? null) : null,
      request: reqMap[f.request_id] ?? null,
    }));
  }

  return c.json({ formal, lowRated: lowRated ?? [], cancelled: cancelled ?? [] });
});

// ── Update complaint status ────────────────────────────────────────────────
app.patch("/v1/admin/complaints/:id/status", async (c) => {
  if (!isAdmin(c)) return c.json({ message: "Não autorizado." }, 401);

  const id = c.req.param("id");
  const body = await c.req.json<{ status: string; admin_note?: string }>();
  const { status, admin_note } = body;

  const adminDb = db(c.env);

  // Busca complaint antes de atualizar para pegar client/provider
  const { data: complaint } = await adminDb
    .from("formal_complaints")
    .select("client_user_id, provider_user_id, reason")
    .eq("id", id)
    .maybeSingle();

  const updatePayload: Record<string, unknown> = { status };
  if (admin_note !== undefined) updatePayload.admin_note = admin_note;

  const { error } = await adminDb
    .from("formal_complaints")
    .update(updatePayload)
    .eq("id", id);

  if (error) return c.json({ message: error.message }, 400);

  // Notificações por status
  const statusMessages: Record<string, { title: string; body: string }> = {
    investigating: {
      title: "🔍 Reclamação em análise",
      body: "Sua reclamação está sendo analisada pelo administrador da plataforma.",
    },
    resolved: {
      title: "✅ Reclamação resolvida",
      body: "Sua reclamação foi resolvida. Obrigado pelo contato com a ConstruConnect.",
    },
    dismissed: {
      title: "📁 Reclamação arquivada",
      body: "Sua reclamação foi arquivada pelo administrador. Entre em contato para mais informações.",
    },
    open: {
      title: "📋 Reclamação reaberta",
      body: "Sua reclamação foi reaberta e está aguardando análise.",
    },
  };

  const msg = statusMessages[status];
  if (msg && complaint?.client_user_id) {
    const notifyBody = admin_note ? `${msg.body} Obs: ${admin_note}` : msg.body;
    await sendPush(c.env, complaint.client_user_id, msg.title, notifyBody);
    // Notifica prestador também se houver
    if (complaint.provider_user_id) {
      await sendPush(c.env, complaint.provider_user_id, msg.title, notifyBody);
    }
  }

  return c.json({ message: "Status atualizado." });
});

// ── Verify provider ───────────────────────────────────────────────────────
app.patch("/v1/admin/providers/:id/verify", async (c) => {
  if (!isAdmin(c)) return c.json({ message: "Não autorizado." }, 401);
  await db(c.env).from("provider_profiles").update({ verified: true }).eq("user_id", c.req.param("id"));
  return c.json({ message: "Prestador verificado." });
});

// ── Block provider ────────────────────────────────────────────────────────
app.patch("/v1/admin/providers/:id/block", async (c) => {
  if (!isAdmin(c)) return c.json({ message: "Não autorizado." }, 401);
  const providerId = c.req.param("id");
  const body = await c.req.json<{ days?: number; until?: string }>().catch(() => ({} as any));
  let blockedUntil: string;
  if (body.until) {
    blockedUntil = new Date(body.until).toISOString();
  } else {
    const days = body.days ?? 30;
    blockedUntil = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  }

  // Penalidade: perde 1 estrela (mínimo 0)
  const { data: profile } = await db(c.env)
    .from("provider_profiles")
    .select("average_rating")
    .eq("user_id", providerId)
    .maybeSingle();
  const currentRating = Number(profile?.average_rating ?? 0);
  const newRating = Math.max(0, Math.round((currentRating - 1) * 10) / 10);

  const { error } = await db(c.env)
    .from("provider_profiles")
    .update({ blocked_until: blockedUntil, status: "offline", average_rating: newRating })
    .eq("user_id", providerId);
  if (error) return c.json({ message: error.message }, 400);
  await sendPush(c.env, providerId, "⛔ Conta suspensa", "Sua conta foi suspensa pelo administrador da plataforma.");
  return c.json({ message: "Prestador bloqueado.", new_rating: newRating });
});

// ── Unblock provider ──────────────────────────────────────────────────────
app.patch("/v1/admin/providers/:id/unblock", async (c) => {
  if (!isAdmin(c)) return c.json({ message: "Não autorizado." }, 401);
  const { error } = await db(c.env)
    .from("provider_profiles")
    .update({ blocked_until: null, status: "available" })
    .eq("user_id", c.req.param("id"));
  if (error) return c.json({ message: error.message }, 400);
  await sendPush(c.env, c.req.param("id"), "✅ Conta reativada", "Sua conta foi reativada pelo administrador.");
  return c.json({ message: "Prestador desbloqueado." });
});

// ── Block client ──────────────────────────────────────────────────────────
app.patch("/v1/admin/users/:id/block", async (c) => {
  if (!isAdmin(c)) return c.json({ message: "Não autorizado." }, 401);
  const id = c.req.param("id");
  const body = await c.req.json<{ until?: string; days?: number }>().catch(() => ({} as any));
  let blockedUntil: string;
  if (body.until) {
    blockedUntil = new Date(body.until).toISOString();
  } else {
    const days = body.days ?? 30;
    blockedUntil = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  }
  const { error } = await db(c.env).from("app_users").update({ blocked_until: blockedUntil }).eq("id", id);
  if (error) return c.json({ message: error.message }, 400);
  await sendPush(c.env, id, "⛔ Conta suspensa", "Sua conta foi suspensa pelo administrador da plataforma.");
  return c.json({ message: "Cliente bloqueado." });
});

// ── Unblock client ────────────────────────────────────────────────────────
app.patch("/v1/admin/users/:id/unblock", async (c) => {
  if (!isAdmin(c)) return c.json({ message: "Não autorizado." }, 401);
  const id = c.req.param("id");
  const { error } = await db(c.env).from("app_users").update({ blocked_until: null }).eq("id", id);
  if (error) return c.json({ message: error.message }, 400);
  await sendPush(c.env, id, "✅ Conta reativada", "Sua conta foi reativada pelo administrador da plataforma.");
  return c.json({ message: "Cliente desbloqueado." });
});

// ── Feature Flags (public read) ───────────────────────────────────────────
app.get("/v1/feature-flags", async (c) => {
  const flags = await getFlags(c.env.FEATURE_FLAGS);
  const result: Record<string, boolean> = {};
  for (const f of flags) result[f.key] = f.enabled;
  return c.json(result);
});

// ── Feature Flags (admin) ─────────────────────────────────────────────────
app.get("/v1/admin/feature-flags", async (c) => {
  if (!isAdmin(c)) return c.json({ message: "Não autorizado." }, 401);
  const data = await getFlags(c.env.FEATURE_FLAGS);
  return c.json({ data });
});

app.patch("/v1/admin/feature-flags/:key", async (c) => {
  if (!isAdmin(c)) return c.json({ message: "Não autorizado." }, 401);
  const key = c.req.param("key");
  const { enabled } = await c.req.json<{ enabled: boolean }>();
  if (!DEFAULT_FLAGS.find((f) => f.key === key)) {
    return c.json({ message: "Flag não encontrada." }, 404);
  }
  await c.env.FEATURE_FLAGS.put(key, JSON.stringify({ enabled, updated_at: new Date().toISOString() }));
  return c.json({ ok: true });
});

// ── Chat: list messages for a request ────────────────────────────────────
app.get("/v1/service-requests/:id/messages", async (c) => {
  const requestId = c.req.param("id");
  const { data, error } = await db(c.env)
    .from("messages")
    .select("id, sender_id, sender_role, content, created_at")
    .eq("request_id", requestId)
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ messages: data ?? [] });
});

// ── Chat: send a message ──────────────────────────────────────────────────
app.post("/v1/service-requests/:id/messages", async (c) => {
  const requestId = c.req.param("id");
  const body = await c.req.json<{
    sender_id: string;
    sender_role: "client" | "provider";
    content: string;
  }>().catch(() => ({} as any));

  if (!body.sender_id || !body.sender_role || !body.content?.trim()) {
    return c.json({ message: "Campos obrigatórios ausentes." }, 400);
  }

  const { data, error } = await db(c.env)
    .from("messages")
    .insert({
      request_id: requestId,
      sender_id: body.sender_id,
      sender_role: body.sender_role,
      content: body.content.trim(),
    })
    .select("id, sender_id, sender_role, content, created_at")
    .single();

  if (error) return c.json({ message: error.message }, 400);

  // Notify the other party
  const { data: req } = await db(c.env)
    .from("service_requests")
    .select("client_user_id, provider_user_id")
    .eq("id", requestId)
    .maybeSingle();

  if (req) {
    const recipientId = body.sender_role === "client" ? req.provider_user_id : req.client_user_id;
    if (recipientId) {
      await sendPush(c.env, recipientId, "💬 Nova mensagem", body.content.trim().slice(0, 80));
    }
  }

  return c.json({ message: data }, 201);
});

// ── Portfolio: list photos for a provider ─────────────────────────────────
app.get("/v1/providers/:id/portfolio", async (c) => {
  const providerId = c.req.param("id");
  const { data, error } = await db(c.env)
    .from("portfolio_photos")
    .select("id, url, caption, category, created_at")
    .eq("provider_user_id", providerId)
    .order("created_at", { ascending: false });
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ photos: data ?? [] });
});

// ── Portfolio: upload a photo ─────────────────────────────────────────────
app.post("/v1/providers/:id/portfolio", async (c) => {
  const providerId = c.req.param("id");
  const body = await c.req.json<{
    file_data: string;
    file_name?: string;
    mime_type?: string;
    caption?: string;
    category?: string;
  }>().catch(() => ({} as any));

  if (!body.file_data) return c.json({ message: "file_data obrigatório." }, 400);

  const supabaseDb = db(c.env);

  const base64Data = body.file_data.includes(",") ? body.file_data.split(",")[1] : body.file_data;
  const binary = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));
  const fileName = body.file_name ?? `portfolio_${providerId}_${Date.now()}.jpg`;
  const mimeType = body.mime_type ?? "image/jpeg";

  const { error: uploadError } = await supabaseDb.storage
    .from("portfolio")
    .upload(fileName, binary, { contentType: mimeType, upsert: false });

  if (uploadError) return c.json({ message: uploadError.message }, 400);

  const { data: urlData } = supabaseDb.storage.from("portfolio").getPublicUrl(fileName);

  const { data, error } = await supabaseDb
    .from("portfolio_photos")
    .insert({
      provider_user_id: providerId,
      url: urlData.publicUrl,
      caption: body.caption ?? null,
      category: body.category ?? null,
    })
    .select("id, url, caption, category, created_at")
    .single();

  if (error) return c.json({ message: error.message }, 400);
  return c.json({ photo: data }, 201);
});

// ── Portfolio: delete a photo ─────────────────────────────────────────────
app.delete("/v1/providers/:id/portfolio/:photoId", async (c) => {
  const providerId = c.req.param("id");
  const photoId = c.req.param("photoId");

  const { error } = await db(c.env)
    .from("portfolio_photos")
    .delete()
    .eq("id", photoId)
    .eq("provider_user_id", providerId);

  if (error) return c.json({ message: error.message }, 400);
  return c.json({ message: "Foto removida." });
});

// ── Certifications: list ──────────────────────────────────────────────────
app.get("/v1/providers/:id/certifications", async (c) => {
  const { data, error } = await db(c.env)
    .from("provider_certifications")
    .select("id, name, url, issued_by, issued_date, created_at")
    .eq("provider_user_id", c.req.param("id"))
    .order("created_at", { ascending: false });
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ certifications: data ?? [] });
});

// ── Certifications: upload ────────────────────────────────────────────────
app.post("/v1/providers/:id/certifications", async (c) => {
  const providerId = c.req.param("id");
  const body = await c.req.json<{
    file_data: string;
    file_name?: string;
    mime_type?: string;
    name: string;
    issued_by?: string;
    issued_date?: string;
  }>().catch(() => ({} as any));

  if (!body.file_data || !body.name) {
    return c.json({ message: "file_data e name são obrigatórios." }, 400);
  }

  const supabaseDb = db(c.env);
  const base64Data = body.file_data.includes(",") ? body.file_data.split(",")[1] : body.file_data;
  const binary = Uint8Array.from(atob(base64Data), (ch) => ch.charCodeAt(0));
  const fileName = body.file_name ?? `cert_${providerId}_${Date.now()}.jpg`;
  const mimeType = body.mime_type ?? "image/jpeg";

  const { error: uploadError } = await supabaseDb.storage
    .from("certifications")
    .upload(fileName, binary, { contentType: mimeType, upsert: false });

  if (uploadError) return c.json({ message: uploadError.message }, 400);

  const { data: urlData } = supabaseDb.storage.from("certifications").getPublicUrl(fileName);

  const { data, error } = await supabaseDb
    .from("provider_certifications")
    .insert({
      provider_user_id: providerId,
      name: body.name,
      url: urlData.publicUrl,
      issued_by: body.issued_by ?? null,
      issued_date: body.issued_date ?? null,
    })
    .select("id, name, url, issued_by, issued_date, created_at")
    .single();

  if (error) return c.json({ message: error.message }, 400);
  return c.json({ certification: data }, 201);
});

// ── Certifications: delete ────────────────────────────────────────────────
app.delete("/v1/providers/:id/certifications/:certId", async (c) => {
  const { error } = await db(c.env)
    .from("provider_certifications")
    .delete()
    .eq("id", c.req.param("certId"))
    .eq("provider_user_id", c.req.param("id"));
  if (error) return c.json({ message: error.message }, 400);
  return c.json({ message: "Certificação removida." });
});

// ── Complaints: submit a formal complaint ─────────────────────────────────
app.post("/v1/complaints", async (c) => {
  const body = await c.req.json<{
    request_id: string;
    client_user_id: string;
    provider_user_id?: string;
    reason: string;
    description: string;
  }>().catch(() => ({} as any));

  if (!body.request_id || !body.client_user_id || !body.reason || !body.description) {
    return c.json({ message: "Campos obrigatórios ausentes." }, 400);
  }

  console.log("complaint body:", JSON.stringify(body));

  const { data, error } = await db(c.env)
    .from("formal_complaints")
    .insert({
      request_id: body.request_id,
      client_user_id: body.client_user_id,
      provider_user_id: body.provider_user_id ?? null,
      reason: body.reason,
      description: body.description,
      status: "open",
    })
    .select("id")
    .single();

  if (error) {
    console.error("complaint insert error:", JSON.stringify(error));
    return c.json({ message: error.message }, 400);
  }
  return c.json({ id: data.id, message: "Reclamação registrada com sucesso." }, 201);
});

// ── Bids: provider submits a bid ──────────────────────────────────────────
app.post("/v1/service-requests/:id/bids", async (c) => {
  const requestId = c.req.param("id");
  const body = await c.req.json<{
    provider_user_id: string;
    amount: number;
    notes?: string;
  }>().catch(() => ({} as any));

  if (!body.provider_user_id || !body.amount) {
    return c.json({ message: "Campos obrigatórios ausentes." }, 400);
  }

  const { data, error } = await db(c.env)
    .from("bids")
    .upsert({
      request_id: requestId,
      provider_user_id: body.provider_user_id,
      amount: body.amount,
      notes: body.notes ?? null,
      status: "pending",
    }, { onConflict: "request_id,provider_user_id" })
    .select("id, amount, notes, status, created_at")
    .single();

  if (error) return c.json({ message: error.message }, 400);

  // Notify the client
  const { data: req } = await db(c.env)
    .from("service_requests")
    .select("client_user_id")
    .eq("id", requestId)
    .maybeSingle();

  if (req?.client_user_id) {
    const amtStr = `R$ ${Number(body.amount).toFixed(2).replace(".", ",")}`;
    await sendPush(c.env, req.client_user_id, "💰 Novo orçamento recebido!", `Um profissional enviou um orçamento de ${amtStr}. Toque para comparar.`);
  }

  return c.json({ bid: data }, 201);
});

// ── Bids: list bids for a request ─────────────────────────────────────────
app.get("/v1/service-requests/:id/bids", async (c) => {
  const requestId = c.req.param("id");
  const { data, error } = await db(c.env)
    .from("bids")
    .select(`
      id, amount, notes, status, created_at,
      provider_user_id,
      app_users!provider_user_id(full_name, city),
      provider_profiles!provider_user_id(average_rating, completed_jobs, description)
    `)
    .eq("request_id", requestId)
    .order("amount", { ascending: true });
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ bids: data ?? [] });
});

// ── Bids: client accepts a bid ────────────────────────────────────────────
app.patch("/v1/service-requests/:id/bids/:bidId/accept", async (c) => {
  const requestId = c.req.param("id");
  const bidId = c.req.param("bidId");

  // Fetch the winning bid
  const { data: bid, error: bidErr } = await db(c.env)
    .from("bids")
    .select("provider_user_id, amount")
    .eq("id", bidId)
    .eq("request_id", requestId)
    .maybeSingle();

  if (bidErr || !bid) return c.json({ message: "Bid não encontrado." }, 404);

  // Mark winning bid accepted, reject others
  await db(c.env).from("bids").update({ status: "accepted" }).eq("id", bidId);
  await db(c.env)
    .from("bids")
    .update({ status: "rejected" })
    .eq("request_id", requestId)
    .neq("id", bidId);

  // Assign provider and quote to the request
  const { error } = await db(c.env)
    .from("service_requests")
    .update({
      provider_user_id: bid.provider_user_id,
      quote_amount: bid.amount,
      status: "accepted",
    })
    .eq("id", requestId);

  if (error) return c.json({ message: error.message }, 400);

  // Notify winning provider
  const amtStr = `R$ ${Number(bid.amount).toFixed(2).replace(".", ",")}`;
  await sendPush(c.env, bid.provider_user_id, "✅ Seu orçamento foi aceito!", `O cliente aceitou seu orçamento de ${amtStr}. Prepare-se para o serviço!`);

  return c.json({ message: "Bid aceito. Prestador atribuído ao chamado." });
});

export default app;
