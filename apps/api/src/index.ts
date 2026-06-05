import { Hono } from "hono";
import { cors } from "hono/cors";
import { createClient } from "@supabase/supabase-js";
import type { RegistrationPayload } from "@construconnect/shared";

type Bindings = {
  APP_NAME: string;
  SENTRY_DSN: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  MERCADOPAGO_ACCESS_TOKEN: string;
  MERCADOPAGO_WEBHOOK_SECRET: string;
  MERCADOPAGO_PUBLIC_KEY: string;
  MP_APP_ID: string;
  MP_APP_SECRET: string;
  MP_REDIRECT_URI: string;
  ADMIN_KEY: string;
  FEATURE_FLAGS: KVNamespace;
};

type Variables = {
  userId: string;
  authorized: boolean;
  isMaster: boolean;
  crmUser: { id: string; nome: string; perfil: string; areas: string[]; ativo: boolean };
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

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.use(cors({
  origin: (origin) => {
    const allowed = [
      "https://construconnect-web.pages.dev",
      "https://projetoappconstrucao.pages.dev",
      "http://localhost:5173",
      "http://localhost:8081", // Expo web dev
    ];
    return allowed.includes(origin ?? "") ? origin! : allowed[0];
  },
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization", "x-admin-key"],
}));

const db = (env: Bindings) =>
  createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);

// ── Sentry error reporting via REST API ───────────────────────────────────────
async function reportError(env: Bindings, err: unknown, context?: Record<string, unknown>) {
  if (!env.SENTRY_DSN) return;
  try {
    const dsn = new URL(env.SENTRY_DSN);
    const projectId = dsn.pathname.replace("/", "");
    const sentryUrl = `${dsn.protocol}//${dsn.host}/api/${projectId}/envelope/`;
    const key = dsn.username;

    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;

    const header = JSON.stringify({ dsn: env.SENTRY_DSN, sdk: { name: "construconnect.workers", version: "1.0" } });
    const itemHeader = JSON.stringify({ type: "event" });
    const event = JSON.stringify({
      event_id: crypto.randomUUID().replace(/-/g, ""),
      timestamp: new Date().toISOString(),
      platform: "javascript",
      level: "error",
      environment: "production",
      exception: { values: [{ type: "Error", value: message, stacktrace: stack ? { frames: [{ filename: "api/index.ts", function: "handler", abs_path: stack }] } : undefined }] },
      extra: context,
    });

    await fetch(sentryUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-sentry-envelope", "X-Sentry-Auth": `Sentry sentry_key=${key}, sentry_version=7` },
      body: `${header}\n${itemHeader}\n${event}`,
    });
  } catch {} // nunca deixar o reporter quebrar a requisição
}

// ── US-019: Rate limiting simples via KV ──────────────────────────────────────
// Limite: 120 req/min por IP nos endpoints de escrita
const RATE_LIMIT_WRITE = 120;
const rateCache = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string, limit = RATE_LIMIT_WRITE): boolean {
  const now = Date.now();
  const window = 60_000;
  const entry = rateCache.get(ip);
  if (!entry || now > entry.resetAt) {
    rateCache.set(ip, { count: 1, resetAt: now + window });
    return true;
  }
  entry.count++;
  if (entry.count > limit) return false;
  return true;
}

app.use("/v1/*", async (c, next) => {
  const method = c.req.method;
  // Apenas limitar POST/PATCH/PUT/DELETE
  if (method === "GET" || method === "OPTIONS") return next();
  const ip = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? "unknown";
  if (!checkRateLimit(ip)) {
    return c.json({ message: "Muitas requisições. Tente novamente em 1 minuto." }, 429);
  }
  return next();
});

// ── Auth middleware (JWT) ─────────────────────────────────────────────────────
// Rotas públicas que não exigem autenticação
const PUBLIC_PATHS = new Set([
  "/",
  "/health",
  "/v1/register",
  "/v1/auth/webauthn/register-options",
  "/v1/auth/webauthn/verify-registration",
  "/v1/webhooks/mercadopago",
  "/v1/feature-flags",
  "/v1/providers",
  "/v1/providers/available",
  "/v1/crm/auth/login",
]);

app.use("/v1/*", async (c, next) => {
  const path = c.req.path;

  // Rotas admin têm checagem própria via x-admin-key
  if (path.startsWith("/v1/admin/")) return next();

  // Rotas totalmente públicas
  if (PUBLIC_PATHS.has(path)) return next();

  // GET de portfólio e certificações são públicos (qualquer cliente pode visualizar)
  if (c.req.method === "GET" && (
    /^\/v1\/providers\/[^/]+\/portfolio$/.test(path) ||
    /^\/v1\/providers\/[^/]+\/certifications$/.test(path)
  )) return next();

  const token = c.req.header("Authorization")?.replace("Bearer ", "");
  if (!token) return c.json({ message: "Não autorizado." }, 401);

  const { data: { user }, error } = await db(c.env).auth.getUser(token);
  if (error || !user) return c.json({ message: "Token inválido ou expirado." }, 401);

  c.set("userId", user.id);
  return next();
});

// ── CRM: controle de acesso por área ────────────────────────────────────────
// Senhas com PBKDF2-SHA256 (Web Crypto, disponível no Workers).
async function hashSenha(senha: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMat = await crypto.subtle.importKey("raw", new TextEncoder().encode(senha), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, keyMat, 256);
  const toHex = (a: Uint8Array) => [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${toHex(salt)}:${toHex(new Uint8Array(bits))}`;
}
async function verifySenha(senha: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = (stored || "").split(":");
  if (!saltHex || !hashHex) return false;
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
  const keyMat = await crypto.subtle.importKey("raw", new TextEncoder().encode(senha), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, keyMat, 256);
  const calc = [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return calc === hashHex;
}
function genToken(): string {
  return [...crypto.getRandomValues(new Uint8Array(32))].map((x) => x.toString(16).padStart(2, "0")).join("");
}

// Mapeia o caminho da requisição para uma "área" de permissão.
function areaForPath(path: string): string {
  const m = path.match(/^\/v1\/admin\/crm\/([^/]+)/);
  if (m) {
    const a = m[1];
    if (a === "leads") return "vendas";
    if (a === "lancamentos" || a === "faturas") return "financeiro";
    if (a === "rh") return "rh";
    if (a === "jur") return "juridico";
    if (a === "mkt") return "marketing";
    if (a === "forn") return "fornecedores";
    if (a === "sup") return "suporte";
    if (a === "agenda") return "agenda";
    if (a === "relatorios") return "relatorios";
    return "operacao";
  }
  return "operacao";
}
function operatorAllowed(user: any, area: string, method: string): boolean {
  if (user.perfil === "admin") return true;
  const areas: string[] = user.areas ?? [];
  if (areas.includes(area)) return true;
  // "relatorios" implica leitura de vendas/financeiro (o BI consolida ambos)
  if (method === "GET" && areas.includes("relatorios") && (area === "vendas" || area === "financeiro")) return true;
  return false;
}

// ── Auditoria ───────────────────────────────────────────────────────────────
type AuditActor = { tipo: "master" | "operador"; id: string | null; nome: string; email: string };

function extractRegistroId(path: string): string | null {
  const segs = path.split("/").filter(Boolean);
  const last = segs[segs.length - 1];
  return last && /^[0-9a-f-]{8,}$/i.test(last) ? last : null;
}

async function recordAudit(
  env: Bindings,
  info: { actor: AuditActor; acao: string; area: string; recurso: string; status: number; ip: string },
) {
  try {
    await db(env).from("crm_audit_log").insert({
      actor_tipo: info.actor.tipo,
      actor_id: info.actor.id,
      actor_nome: info.actor.nome,
      actor_email: info.actor.email,
      acao: info.acao,
      area: info.area,
      recurso: info.recurso.replace(/^\/v1\/admin\//, ""),
      registro_id: extractRegistroId(info.recurso),
      status: info.status,
      ip: info.ip,
    });
  } catch {
    /* auditoria nunca deve quebrar a requisição */
  }
}

// Middleware de autorização para todo /v1/admin/*: aceita a chave master
// (dono) OU um token de sessão de operador (no mesmo header x-admin-key).
// Registra em auditoria toda mutação bem-sucedida e tentativas negadas.
app.use("/v1/admin/*", async (c, next) => {
  const path = c.req.path;
  const method = c.req.method;
  const key = c.req.header("x-admin-key") ?? "";
  const ip = c.req.header("cf-connecting-ip") ?? "";

  let actor: AuditActor | null = null;

  // Dono / master
  if (c.env.ADMIN_KEY && key === c.env.ADMIN_KEY) {
    c.set("authorized", true);
    c.set("isMaster", true);
    actor = { tipo: "master", id: null, nome: "Administrador", email: "" };
  } else if (key) {
    // Operador via token de sessão
    const adminDb = db(c.env);
    const { data: sess } = await adminDb
      .from("crm_sessions").select("user_id, expires_at").eq("token", key).maybeSingle();
    if (!sess || new Date(sess.expires_at) <= new Date()) {
      return c.json({ message: "Sessão inválida ou expirada." }, 401);
    }
    const { data: user } = await adminDb
      .from("crm_users").select("id, nome, email, perfil, areas, ativo").eq("id", sess.user_id).maybeSingle();
    if (!user || !user.ativo) {
      return c.json({ message: "Sessão inválida ou expirada." }, 401);
    }
    c.set("crmUser", user);
    actor = { tipo: "operador", id: user.id, nome: user.nome, email: user.email };
    const area = areaForPath(path);

    if (path.startsWith("/v1/admin/crm-users")) {
      await recordAudit(c.env, { actor, acao: "acesso negado", area: "acesso", recurso: path, status: 403, ip });
      return c.json({ message: "Apenas o administrador master gerencia acessos." }, 403);
    }
    if (path === "/v1/admin/overview") {
      c.set("authorized", true);
    } else if (operatorAllowed(user, area, method)) {
      c.set("authorized", true);
    } else {
      await recordAudit(c.env, { actor, acao: "acesso negado", area, recurso: path, status: 403, ip });
      return c.json({ message: "Sem permissão para esta área." }, 403);
    }
  } else {
    return c.json({ message: "Não autorizado." }, 401);
  }

  await next();

  // Registra mutações bem-sucedidas
  if (actor && (method === "POST" || method === "PATCH" || method === "DELETE") && c.res.status < 400) {
    const acao = method === "POST" ? "criou" : method === "DELETE" ? "excluiu" : "atualizou";
    await recordAudit(c.env, { actor, acao, area: areaForPath(path), recurso: path, status: c.res.status, ip });
  }
});

// ── MercadoPago webhook HMAC validation ───────────────────────────────────────
async function validateMPWebhookSignature(
  secret: string,
  xSignature: string | undefined,
  xRequestId: string | undefined,
  dataId: string | undefined
): Promise<boolean> {
  if (!secret || !xSignature) return false;

  const parts: Record<string, string> = {};
  for (const part of xSignature.split(",")) {
    const [k, v] = part.split("=");
    if (k && v) parts[k.trim()] = v.trim();
  }
  const ts = parts["ts"] ?? "";
  const v1 = parts["v1"] ?? "";
  if (!ts || !v1) return false;

  const manifest = [
    dataId ? `id:${dataId}` : "",
    xRequestId ? `request-id:${xRequestId}` : "",
    `ts:${ts}`,
  ].filter(Boolean).join(";") + ";";

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(manifest));
  const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
  return hex === v1;
}

app.get("/", (c) =>
  c.json({
    name: c.env.APP_NAME,
    status: "ok",
    date: new Date().toISOString(),
    message: "API ConstruConnect com Supabase."
  })
);

app.get("/health", (c) => c.json({
  ok: true,
  version: "2.0.0",
  features: ["jwt-auth","hmac-webhook","payments","saas","ratings","chat","tracking","lgpd"],
  timestamp: new Date().toISOString(),
}));

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

  // US-016: Verificar limite mensal do plano Free
  const limitCheck = await enforceJobLimit(c.env, body.provider_user_id);
  if (!limitCheck.allowed) {
    return c.json({ message: limitCheck.message, code: "PLAN_LIMIT_REACHED" }, 403);
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

  // Incrementar contador mensal do plano
  await incrementJobCount(c.env, body.provider_user_id);

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

  const adminDb = db(c.env);

  // Buscar client_user_id para notificar
  const { data: req } = await adminDb
    .from("service_requests")
    .select("client_user_id, status")
    .eq("id", jobId)
    .maybeSingle();

  if (!req) return c.json({ message: "Chamado não encontrado." }, 404);

  // Resetar chamado: remover prestador e voltar para "requested" para outros aceitarem
  const { error } = await adminDb
    .from("service_requests")
    .update({
      status: "requested",
      provider_user_id: null,
      quote_amount: null,
      quote_status: null,
    })
    .eq("id", jobId)
    .eq("provider_user_id", body.provider_user_id);

  if (error) return c.json({ message: error.message }, 400);

  // Notificar cliente que o prestador recusou
  if (req.client_user_id) {
    await sendPush(
      c.env,
      req.client_user_id,
      "🔄 Prestador recusou o chamado",
      "Um prestador recusou seu chamado. Seu pedido continua disponível para outros prestadores."
    );
  }

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

// ── Notify client about a quote/bid (write already done on device) ────────────
app.post("/v1/service-requests/:id/notify-client", async (c) => {
  const body = await c.req.json<{ title: string; body: string }>().catch(() => ({} as any));
  if (!body.title || !body.body) return c.json({ ok: true });
  const { data: req } = await db(c.env)
    .from("service_requests")
    .select("client_user_id")
    .eq("id", c.req.param("id"))
    .maybeSingle();
  if (req?.client_user_id) {
    await sendPush(c.env, req.client_user_id, body.title, body.body);
  }
  return c.json({ ok: true });
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
    authData.user = found as unknown as typeof authData.user;
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
    accessibilitySpecialist?: boolean;
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
    if (body.accessibilitySpecialist !== undefined) profileUpdates.accessibility_specialist = body.accessibilitySpecialist;
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

// ── Carregar perfil completo (service role, à prova de RLS) ─────────────────
app.get("/v1/profile", async (c) => {
  const userId = c.get("userId");
  const adminDb = db(c.env);

  // 1. Buscar linha do usuário
  let { data: userRow } = await adminDb
    .from("app_users")
    .select("id, role, full_name, email, city, phone, pix_key, document_number")
    .eq("id", userId)
    .maybeSingle();

  // 2. Self-heal: se não existe linha com id = auth.uid(), tentar reconciliar por email
  if (!userRow) {
    const { data: authUser } = await adminDb.auth.admin.getUserById(userId);
    const email = authUser?.user?.email ?? "";
    const meta = authUser?.user?.user_metadata ?? {};

    if (email) {
      // Existe uma linha órfã com o mesmo email mas id diferente?
      const { data: orphan } = await adminDb
        .from("app_users")
        .select("id, role, full_name, email, city, phone, pix_key, document_number")
        .eq("email", email)
        .maybeSingle();

      if (orphan) {
        // Re-vincular: criar linha correta com o id do auth e remover a órfã
        await adminDb.from("app_users").delete().eq("email", email).neq("id", userId);
        const { data: fixed } = await adminDb.from("app_users").upsert({
          id: userId,
          role: orphan.role ?? meta.role ?? "client",
          full_name: orphan.full_name,
          email,
          phone: orphan.phone ?? "",
          city: orphan.city ?? "",
          pix_key: orphan.pix_key ?? null,
          document_number: orphan.document_number ?? "",
        }, { onConflict: "id" }).select("id, role, full_name, email, city, phone, pix_key, document_number").maybeSingle();
        userRow = fixed ?? null;
      } else {
        // Criar linha a partir dos metadados do auth
        const { data: created } = await adminDb.from("app_users").upsert({
          id: userId,
          role: meta.role ?? "client",
          full_name: meta.full_name ?? "",
          email,
          phone: "",
          city: "",
          document_number: "",
        }, { onConflict: "id" }).select("id, role, full_name, email, city, phone, pix_key, document_number").maybeSingle();
        userRow = created ?? null;
      }
    }
  }

  if (!userRow) return c.json({ message: "Perfil não encontrado." }, 404);

  // 3. Buscar dados de prestador (se houver)
  const { data: providerRow } = await adminDb
    .from("provider_profiles")
    .select("company_name, accepts_emergency_jobs, accessibility_specialist, status, provider_skills(skills(label))")
    .eq("user_id", userId)
    .maybeSingle();

  const specialties = ((providerRow as any)?.provider_skills ?? [])
    .map((ps: any) => ps?.skills?.label)
    .filter(Boolean)
    .join(", ");

  return c.json({
    profile: {
      id: userRow.id,
      role: userRow.role,
      full_name: userRow.full_name ?? "",
      email: userRow.email ?? "",
      city: userRow.city ?? "",
      phone: userRow.phone ?? "",
      pix_key: userRow.pix_key ?? "",
      company_name: (providerRow as any)?.company_name ?? "",
      accepts_emergency_jobs: (providerRow as any)?.accepts_emergency_jobs ?? false,
      accessibility_specialist: (providerRow as any)?.accessibility_specialist ?? false,
      status: (providerRow as any)?.status ?? "available",
      specialties,
    },
  });
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

  const { error: storageError, data: uploadData } = await db(c.env).storage
    .from("request-photos")
    .upload(filePath, bytes, { contentType: "image/jpeg", upsert: true });

  if (storageError) {
    return c.json({ message: `Erro no upload: ${storageError.message}` }, 500);
  }

  // Usar o método getPublicUrl do Supabase para obter a URL correta
  const { data: publicData } = db(c.env).storage
    .from("request-photos")
    .getPublicUrl(filePath);

  const publicUrl = publicData?.publicUrl || `${c.env.SUPABASE_URL}/storage/v1/object/public/request-photos/${filePath}`;

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

// ── Helpers de plano/comissão ────────────────────────────────────────────────
async function getProviderCommissionRate(env: Bindings, providerUserId: string): Promise<number> {
  const { data } = await db(env)
    .from("provider_subscriptions")
    .select("commission_rate, status")
    .eq("provider_user_id", providerUserId)
    .maybeSingle();
  if (!data || data.status !== "active") return 0.10;
  return Number(data.commission_rate ?? 0.10);
}

// ── US-008: MP Connect OAuth — URL de autorização ────────────────────────────
app.get("/v1/providers/:id/mp-connect-url", async (c) => {
  const providerId = c.req.param("id");
  const userId = c.get("userId");

  if (userId !== providerId) return c.json({ message: "Não autorizado." }, 403);

  if (!c.env.MP_APP_ID) {
    return c.json({ message: "Integração MP Connect não configurada." }, 503);
  }

  const url = new URL("https://auth.mercadopago.com/authorization");
  url.searchParams.set("client_id", c.env.MP_APP_ID);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("platform_id", "mp");
  url.searchParams.set("state", providerId);
  url.searchParams.set("redirect_uri", c.env.MP_REDIRECT_URI);

  return c.json({ url: url.toString() });
});

// ── US-008: MP Connect OAuth — Callback ──────────────────────────────────────
app.get("/v1/auth/mp-callback", async (c) => {
  const code = c.req.query("code");
  const providerId = c.req.query("state");

  if (!code || !providerId) {
    return c.text("Parâmetros inválidos.", 400);
  }

  if (!c.env.MP_APP_ID || !c.env.MP_APP_SECRET) {
    return c.text("Integração não configurada.", 503);
  }

  // Trocar code por access_token do prestador
  const tokenRes = await fetch("https://api.mercadopago.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: c.env.MP_APP_ID,
      client_secret: c.env.MP_APP_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: c.env.MP_REDIRECT_URI,
    }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    console.error("[MP Connect] Token exchange failed:", err);
    return c.text("Erro ao conectar conta MercadoPago.", 500);
  }

  const tokenData = await tokenRes.json() as {
    access_token: string;
    user_id: number;
    refresh_token?: string;
  };

  await db(c.env)
    .from("provider_profiles")
    .update({
      mp_access_token: tokenData.access_token,
      mp_user_id: String(tokenData.user_id),
      mp_refresh_token: tokenData.refresh_token ?? null,
    })
    .eq("user_id", providerId);

  // Redireciona de volta ao app (deep link)
  return c.redirect(`construconnect://mp-connect-success`);
});

// ── US-008: Verificar status do MP Connect ────────────────────────────────────
app.get("/v1/providers/:id/mp-status", async (c) => {
  const providerId = c.req.param("id");
  const { data } = await db(c.env)
    .from("provider_profiles")
    .select("mp_user_id")
    .eq("user_id", providerId)
    .maybeSingle();
  return c.json({ connected: !!data?.mp_user_id });
});

// ── Provider online/offline toggle ───────────────────────────────────────────
app.patch("/v1/providers/:id/status", async (c) => {
  const providerId = c.req.param("id");
  const userId = c.get("userId");
  const body = await c.req.json<{ status: "available" | "busy" | "offline" }>().catch(() => ({} as any));

  if (!body.status || !["available", "busy", "offline"].includes(body.status)) {
    return c.json({ message: "Status inválido. Use: available, busy ou offline." }, 400);
  }

  // Prestador só pode atualizar o próprio status
  if (userId !== providerId) return c.json({ message: "Não autorizado." }, 403);

  const { error } = await db(c.env)
    .from("provider_profiles")
    .update({ status: body.status, last_seen_at: new Date().toISOString() })
    .eq("user_id", providerId);

  if (error) return c.json({ message: error.message }, 400);
  return c.json({ message: "Status atualizado.", status: body.status });
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

// ── US-009: Gerar Pix via Mercado Pago com split ─────────────────────────────
app.post("/v1/service-requests/:id/create-pix", async (c) => {
  const id = c.req.param("id");

  if (!c.env.MERCADOPAGO_ACCESS_TOKEN) {
    return c.json({ message: "Integração com Mercado Pago não configurada." }, 503);
  }

  const adminDb = db(c.env);

  const { data: req } = await adminDb
    .from("service_requests")
    .select("quote_amount, category, client_user_id, provider_user_id, status, payment_status")
    .eq("id", id)
    .maybeSingle();

  if (!req || req.status !== "completed") {
    return c.json({ message: "Serviço não encontrado ou não concluído." }, 400);
  }
  if (!req.quote_amount) {
    return c.json({ message: "Valor do serviço não definido." }, 400);
  }
  if (req.payment_status === "confirmed") {
    return c.json({ message: "Este serviço já foi pago." }, 409);
  }

  const amount = Number(req.quote_amount);

  // Calcular comissão com base no plano do prestador
  const commissionRate = req.provider_user_id
    ? await getProviderCommissionRate(c.env, req.provider_user_id)
    : 0.10;
  const platformFee = Math.round(amount * commissionRate * 100) / 100;
  const providerAmount = Math.round((amount - platformFee) * 100) / 100;

  const { data: client } = await adminDb
    .from("app_users")
    .select("full_name, email, document_number")
    .eq("id", req.client_user_id)
    .maybeSingle();

  try {
    const pixData = await createMercadoPagoPix(c.env, {
      amount,
      description: `Serviço de ${req.category} - ConstruConnect`,
      payerEmail: (client as any)?.email ?? `cliente_${req.client_user_id}@construconnect.app`,
      payerName: (client as any)?.full_name ?? "Cliente",
      payerDocument: (client as any)?.document_number || undefined,
      externalReference: id,
    });

    // Registrar pagamento pendente na tabela payments
    await adminDb.from("payments").upsert({
      service_request_id: id,
      mp_payment_id: pixData.mpPaymentId,
      amount,
      platform_fee: platformFee,
      provider_amount: providerAmount,
      payment_method: "pix",
      status: "pending",
      payer_email: (client as any)?.email ?? null,
    }, { onConflict: "mp_payment_id" });

    return c.json({
      qrCode: pixData.qrCode,
      qrCodeBase64: pixData.qrCodeBase64,
      mpPaymentId: pixData.mpPaymentId,
      amount,
      platformFee,
      providerAmount,
    });
  } catch (err: any) {
    return c.json({ message: err.message ?? "Erro ao gerar Pix." }, 500);
  }
});

// ── US-010: Pagamento via cartão com split ────────────────────────────────────
app.post("/v1/service-requests/:id/create-card-payment", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{
    token: string;
    installments: number;
    payment_method_id: string;
    issuer_id?: string;
    payer_email: string;
  }>().catch(() => ({} as any));

  if (!body.token || !body.installments || !body.payment_method_id || !body.payer_email) {
    return c.json({ message: "Campos obrigatórios: token, installments, payment_method_id, payer_email." }, 400);
  }

  if (!c.env.MERCADOPAGO_ACCESS_TOKEN) {
    return c.json({ message: "Integração com Mercado Pago não configurada." }, 503);
  }

  const adminDb = db(c.env);

  const { data: req } = await adminDb
    .from("service_requests")
    .select("quote_amount, category, client_user_id, provider_user_id, status, payment_status")
    .eq("id", id)
    .maybeSingle();

  if (!req || req.status !== "completed") {
    return c.json({ message: "Serviço não encontrado ou não concluído." }, 400);
  }
  if (!req.quote_amount) {
    return c.json({ message: "Valor do serviço não definido." }, 400);
  }
  if (req.payment_status === "confirmed") {
    return c.json({ message: "Este serviço já foi pago." }, 409);
  }

  const amount = Number(req.quote_amount);
  const commissionRate = req.provider_user_id
    ? await getProviderCommissionRate(c.env, req.provider_user_id)
    : 0.10;
  const platformFee = Math.round(amount * commissionRate * 100) / 100;
  const providerAmount = Math.round((amount - platformFee) * 100) / 100;

  const payload: Record<string, unknown> = {
    transaction_amount: amount,
    token: body.token,
    description: `Serviço de ${req.category} - ConstruConnect`,
    installments: body.installments,
    payment_method_id: body.payment_method_id,
    external_reference: id,
    payer: { email: body.payer_email },
  };
  if (body.issuer_id) payload.issuer_id = body.issuer_id;

  const mpRes = await fetch("https://api.mercadopago.com/v1/payments", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${c.env.MERCADOPAGO_ACCESS_TOKEN}`,
      "X-Idempotency-Key": `card-${id}-${Date.now()}`,
    },
    body: JSON.stringify(payload),
  });

  if (!mpRes.ok) {
    const err = await mpRes.text();
    return c.json({ message: `Erro MercadoPago: ${err}` }, 400);
  }

  const mpPayment = await mpRes.json() as {
    id: number;
    status: string;
    status_detail: string;
  };

  // Registrar na tabela payments
  await adminDb.from("payments").insert({
    service_request_id: id,
    mp_payment_id: String(mpPayment.id),
    amount,
    platform_fee: platformFee,
    provider_amount: providerAmount,
    payment_method: "card",
    status: mpPayment.status === "approved" ? "approved" : "pending",
    payer_email: body.payer_email,
    confirmed_at: mpPayment.status === "approved" ? new Date().toISOString() : null,
  });

  if (mpPayment.status === "approved") {
    await adminDb
      .from("service_requests")
      .update({ payment_status: "confirmed", payment_method: "card" })
      .eq("id", id);

    // Criar split para o prestador imediatamente (cartão aprova na hora)
    const { data: paymentRecord } = await adminDb
      .from("payments")
      .select("id")
      .eq("mp_payment_id", String(mpPayment.id))
      .maybeSingle();

    if (paymentRecord && req.provider_user_id) {
      await adminDb.from("provider_splits").upsert({
        payment_id: paymentRecord.id,
        provider_user_id: req.provider_user_id,
        amount: providerAmount,
        status: "transferred",
        transferred_at: new Date().toISOString(),
      }, { onConflict: "payment_id" });
    }

    if (req.client_user_id) {
      await sendPush(c.env, req.client_user_id, "✅ Pagamento aprovado!", "Seu pagamento no cartão foi aprovado.");
    }
    if (req.provider_user_id) {
      await sendPush(c.env, req.provider_user_id, "💳 Pagamento recebido!", `O cliente pagou R$ ${providerAmount.toFixed(2).replace(".", ",")} via cartão.`);
    }
  }

  return c.json({
    status: mpPayment.status,
    statusDetail: mpPayment.status_detail,
    mpPaymentId: String(mpPayment.id),
    amount,
    platformFee,
    providerAmount,
  });
});

// ── Webhook Mercado Pago (pagamento aprovado) ─────────────────────────────
app.post("/v1/webhooks/mercadopago", async (c) => {
  try {
    const rawBody = await c.req.text();
    let body: { type?: string; data?: { id?: string } };
    try { body = JSON.parse(rawBody); } catch { return c.json({ ok: true }); }

    // Validar assinatura HMAC antes de processar
    if (c.env.MERCADOPAGO_WEBHOOK_SECRET) {
      const xSignature = c.req.header("x-signature");
      const xRequestId = c.req.header("x-request-id");
      const isValid = await validateMPWebhookSignature(
        c.env.MERCADOPAGO_WEBHOOK_SECRET,
        xSignature,
        xRequestId,
        body.data?.id
      );
      if (!isValid) {
        console.warn("[Webhook MP] Assinatura inválida rejeitada.");
        return c.json({ ok: false }, 400);
      }
    }

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

    // Atualizar registro de payment como aprovado e criar split para o prestador
    const { data: paymentRecord } = await adminDb
      .from("payments")
      .update({ status: "approved", confirmed_at: new Date().toISOString() })
      .eq("mp_payment_id", String(payment.id))
      .select("id, provider_amount")
      .maybeSingle();

    if (paymentRecord && req.provider_user_id) {
      await adminDb.from("provider_splits").upsert({
        payment_id: paymentRecord.id,
        provider_user_id: req.provider_user_id,
        amount: paymentRecord.provider_amount,
        status: "transferred",
        transferred_at: new Date().toISOString(),
      }, { onConflict: "payment_id" });
    }

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
  // O middleware /v1/admin/* já autorizou (master ou operador com permissão).
  if (c.get("authorized") === true) return true;
  const key = c.req.header("x-admin-key");
  return !!c.env.ADMIN_KEY && key === c.env.ADMIN_KEY;
}

function isMaster(c: any): boolean {
  return c.get("isMaster") === true;
}

// ── Login de operador do CRM ────────────────────────────────────────────────
app.post("/v1/crm/auth/login", async (c) => {
  const { email, senha } = await c.req.json<{ email?: string; senha?: string }>();
  if (!email || !senha) return c.json({ message: "Informe e-mail e senha." }, 400);
  const adminDb = db(c.env);
  const { data: user } = await adminDb
    .from("crm_users").select("*").eq("email", String(email).toLowerCase().trim()).maybeSingle();
  if (!user || !user.ativo) return c.json({ message: "Credenciais inválidas." }, 401);
  if (!(await verifySenha(senha, user.senha_hash))) return c.json({ message: "Credenciais inválidas." }, 401);

  const token = genToken();
  const expires_at = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();
  await adminDb.from("crm_sessions").insert({ token, user_id: user.id, expires_at });

  const areas = user.perfil === "admin" ? ["*"] : (user.areas ?? []);
  return c.json({ token, nome: user.nome, perfil: user.perfil, areas });
});

// ── Gestão de operadores (somente master) ───────────────────────────────────
app.get("/v1/admin/crm-users", async (c) => {
  if (!isMaster(c)) return c.json({ message: "Não autorizado." }, 403);
  const { data, error } = await db(c.env)
    .from("crm_users").select("id, nome, email, perfil, areas, ativo, created_at").order("created_at", { ascending: false });
  if (error) return c.json({ message: error.message }, 500);
  return c.json({ items: data ?? [] });
});

app.post("/v1/admin/crm-users", async (c) => {
  if (!isMaster(c)) return c.json({ message: "Não autorizado." }, 403);
  const b = await c.req.json<{ nome?: string; email?: string; senha?: string; perfil?: string; areas?: string[] }>();
  if (!b.email || !b.senha) return c.json({ message: "E-mail e senha são obrigatórios." }, 400);
  const row = {
    nome: b.nome ?? "",
    email: String(b.email).toLowerCase().trim(),
    senha_hash: await hashSenha(b.senha),
    perfil: b.perfil ?? "operador",
    areas: b.areas ?? [],
    ativo: true,
  };
  const { data, error } = await db(c.env)
    .from("crm_users").insert(row).select("id, nome, email, perfil, areas, ativo, created_at").maybeSingle();
  if (error) return c.json({ message: error.message }, 500);
  return c.json({ item: data });
});

app.patch("/v1/admin/crm-users/:id", async (c) => {
  if (!isMaster(c)) return c.json({ message: "Não autorizado." }, 403);
  const b = await c.req.json<{ nome?: string; email?: string; senha?: string; perfil?: string; areas?: string[]; ativo?: boolean }>();
  const patch: Record<string, any> = {};
  if (b.nome !== undefined) patch.nome = b.nome;
  if (b.email !== undefined) patch.email = String(b.email).toLowerCase().trim();
  if (b.perfil !== undefined) patch.perfil = b.perfil;
  if (b.areas !== undefined) patch.areas = b.areas;
  if (b.ativo !== undefined) patch.ativo = b.ativo;
  if (b.senha) patch.senha_hash = await hashSenha(b.senha);
  const { data, error } = await db(c.env)
    .from("crm_users").update(patch).eq("id", c.req.param("id")).select("id, nome, email, perfil, areas, ativo, created_at").maybeSingle();
  if (error) return c.json({ message: error.message }, 500);
  return c.json({ item: data });
});

app.delete("/v1/admin/crm-users/:id", async (c) => {
  if (!isMaster(c)) return c.json({ message: "Não autorizado." }, 403);
  const { error } = await db(c.env).from("crm_users").delete().eq("id", c.req.param("id"));
  if (error) return c.json({ message: error.message }, 500);
  return c.json({ ok: true });
});

// ── Log de auditoria (somente master) ───────────────────────────────────────
app.get("/v1/admin/audit", async (c) => {
  if (!isMaster(c)) return c.json({ message: "Não autorizado." }, 403);
  const area = c.req.query("area");
  const actorId = c.req.query("actor");
  const limit = Math.min(Number(c.req.query("limit") ?? 200), 500);

  let q = db(c.env)
    .from("crm_audit_log")
    .select("id, actor_tipo, actor_nome, actor_email, acao, area, recurso, registro_id, status, ip, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (area && area !== "todas") q = q.eq("area", area);
  if (actorId) q = q.eq("actor_id", actorId);

  const { data, error } = await q;
  if (error) return c.json({ message: error.message }, 500);
  return c.json({ items: data ?? [] });
});

// ── CRM: factory de CRUD admin (Vendas/Financeiro) ──────────────────────────
function pick(obj: Record<string, any>, fields: string[]): Record<string, any> {
  const out: Record<string, any> = {};
  for (const f of fields) if (obj[f] !== undefined) out[f] = obj[f];
  return out;
}

function registerCrmCrud(
  path: string,
  table: string,
  fields: string[],
  opts?: { mapIn?: (b: any) => any; mapOut?: (r: any) => any },
) {
  const mapOut = opts?.mapOut ?? ((r: any) => r);
  const mapIn = opts?.mapIn ?? ((b: any) => b);

  app.get(`/v1/admin/crm/${path}`, async (c) => {
    if (!isAdmin(c)) return c.json({ message: "Não autorizado." }, 401);
    const { data, error } = await db(c.env).from(table).select("*").order("created_at", { ascending: false });
    if (error) return c.json({ message: error.message }, 500);
    return c.json({ items: (data ?? []).map(mapOut) });
  });

  app.post(`/v1/admin/crm/${path}`, async (c) => {
    if (!isAdmin(c)) return c.json({ message: "Não autorizado." }, 401);
    const row = pick(mapIn(await c.req.json()), fields);
    const { data, error } = await db(c.env).from(table).insert(row).select("*").maybeSingle();
    if (error) return c.json({ message: error.message }, 500);
    return c.json({ item: mapOut(data) });
  });

  app.patch(`/v1/admin/crm/${path}/:id`, async (c) => {
    if (!isAdmin(c)) return c.json({ message: "Não autorizado." }, 401);
    const row = pick(mapIn(await c.req.json()), fields);
    const { data, error } = await db(c.env).from(table).update(row).eq("id", c.req.param("id")).select("*").maybeSingle();
    if (error) return c.json({ message: error.message }, 500);
    return c.json({ item: mapOut(data) });
  });

  app.delete(`/v1/admin/crm/${path}/:id`, async (c) => {
    if (!isAdmin(c)) return c.json({ message: "Não autorizado." }, 401);
    const { error } = await db(c.env).from(table).delete().eq("id", c.req.param("id"));
    if (error) return c.json({ message: error.message }, 500);
    return c.json({ ok: true });
  });
}

// Vendas — leads (mapeia createdAt <-> created_at)
registerCrmCrud(
  "leads",
  "crm_leads",
  ["nome", "empresa", "telefone", "email", "valor", "origem", "estagio", "responsavel", "notas", "created_at"],
  {
    mapIn: (b) => ({ ...b, created_at: b.createdAt ?? b.created_at }),
    mapOut: (r) => (r ? { ...r, createdAt: r.created_at } : r),
  },
);

// Financeiro — lançamentos e faturas
registerCrmCrud("lancamentos", "crm_lancamentos", ["data", "descricao", "categoria", "tipo", "valor"]);
registerCrmCrud("faturas", "crm_faturas", ["parte", "direcao", "valor", "vencimento", "status"]);

// RH — equipe, vagas, ausências
registerCrmCrud("rh/equipe", "crm_rh_equipe", ["nome", "cargo", "departamento", "salario", "beneficios", "admissao", "status"]);
registerCrmCrud("rh/vagas", "crm_rh_vagas", ["cargo", "departamento", "candidatos", "status", "abertura"]);
registerCrmCrud("rh/ausencias", "crm_rh_ausencias", ["colaborador", "tipo", "inicio", "fim", "status"]);

// Jurídico — contratos, compliance, disputas
registerCrmCrud("jur/contratos", "crm_jur_contratos", ["tipo", "contraparte", "status", "inicio", "fim", "valor", "obs"]);
registerCrmCrud("jur/compliance", "crm_jur_compliance", ["titulo", "descricao", "status"]);
registerCrmCrud("jur/disputas", "crm_jur_disputas", ["parte", "tipo", "status", "valor", "advogado", "obs"]);

// Marketing — campanhas
registerCrmCrud("mkt/campanhas", "crm_mkt_campanhas", ["nome", "canal", "orcamento", "gasto", "leads", "status"]);

// Fornecedores / Estoque / Cotações
registerCrmCrud("forn/fornecedores", "crm_forn_fornecedores", ["nome", "cnpj", "categoria", "contato", "telefone", "cidade", "avaliacao"]);
registerCrmCrud("forn/estoque", "crm_forn_estoque", ["item", "categoria", "quantidade", "unidade", "minimo", "custo"]);
registerCrmCrud("forn/cotacoes", "crm_forn_cotacoes", ["item", "fornecedor", "valor", "prazo", "status"]);

// Suporte — tickets e base de conhecimento
registerCrmCrud("sup/tickets", "crm_sup_tickets", ["assunto", "solicitante", "canal", "prioridade", "status", "responsavel", "abertura", "resposta"]);
registerCrmCrud("sup/kb", "crm_sup_kb", ["titulo", "categoria", "conteudo"]);

// Agenda — tarefas e compromissos
registerCrmCrud("agenda/tarefas", "crm_agenda_tarefas", ["titulo", "responsavel", "prioridade", "prazo", "concluida"]);
registerCrmCrud("agenda/compromissos", "crm_agenda_compromissos", ["titulo", "data", "hora", "participantes", "tipo", "notas"]);

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
    { data: investigatingRows },
    { data: resolvedRows },
    { data: dismissedRows },
  ] = await Promise.all([
    d.from("app_users").select("id"),
    d.from("provider_profiles").select("user_id"),
    d.from("service_requests").select("id").in("status", ["requested", "accepted", "in_progress"]),
    d.from("service_requests").select("id").eq("status", "completed"),
    d.from("provider_profiles").select("user_id").gt("blocked_until", now),
    d.from("app_users").select("id").gte("created_at", sevenDaysAgo),
    d.from("service_requests").select("quote_amount").eq("payment_status", "confirmed"),
    d.from("service_requests").select("quote_amount").eq("payment_status", "client_paid"),
    d.from("formal_complaints").select("id, created_at").eq("status", "open"),
    d.from("provider_profiles").select("user_id").eq("status", "available").gt("last_seen_at", heartbeatCutoff),
    d.from("app_users").select("id").eq("role", "client").gt("last_seen_at", heartbeatCutoff),
    d.from("formal_complaints").select("id, created_at").eq("status", "investigating"),
    d.from("formal_complaints").select("id").eq("status", "resolved"),
    d.from("formal_complaints").select("id").eq("status", "dismissed"),
  ]);

  const totalRevenue = (revenueRows ?? []).reduce((s: number, r: any) => s + Number(r.quote_amount ?? 0), 0);
  const pendingRevenue = (pendingRows ?? []).reduce((s: number, r: any) => s + Number(r.quote_amount ?? 0), 0);

  // SLA de reclamações abertas/em análise
  const nowMs = Date.now();
  const H24 = 24 * 60 * 60 * 1000;
  const H72 = 72 * 60 * 60 * 1000;
  const openList = openComplaintsRows ?? [];
  const investigatingList = investigatingRows ?? [];
  const slaSource = [...openList, ...investigatingList];
  const slaOnTime  = slaSource.filter((c: any) => nowMs - new Date(c.created_at).getTime() < H24).length;
  const slaWarning = slaSource.filter((c: any) => { const a = nowMs - new Date(c.created_at).getTime(); return a >= H24 && a < H72; }).length;
  const slaCritical = slaSource.filter((c: any) => nowMs - new Date(c.created_at).getTime() >= H72).length;

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
    complaintsByStatus: {
      open: openList.length,
      investigating: investigatingList.length,
      resolved: (resolvedRows ?? []).length,
      dismissed: (dismissedRows ?? []).length,
    },
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

  // Busca complaint antes de atualizar para pegar client/provider e status atual
  const { data: complaint } = await adminDb
    .from("formal_complaints")
    .select("client_user_id, provider_user_id, reason, status")
    .eq("id", id)
    .maybeSingle();

  if (!complaint) return c.json({ message: "Reclamação não encontrada." }, 404);
  if (complaint.status === "resolved") {
    return c.json({ message: "Reclamações resolvidas não podem ser reabertas." }, 400);
  }

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
      quote_status: "accepted",
    })
    .eq("id", requestId);

  if (error) return c.json({ message: error.message }, 400);

  // Notify winning provider
  const amtStr = `R$ ${Number(bid.amount).toFixed(2).replace(".", ",")}`;
  await sendPush(c.env, bid.provider_user_id, "✅ Seu orçamento foi aceito!", `O cliente aceitou seu orçamento de ${amtStr}. Prepare-se para o serviço!`);

  return c.json({ message: "Bid aceito. Prestador atribuído ao chamado." });
});

// ── US-012: Cálculo de saldo (compartilhado entre /balance e /withdrawal) ──────
// IMPORTANTE: /balance e /withdrawal DEVEM usar exatamente o mesmo cálculo,
// senão o app exibe um saldo (ex.: R$ 14.011) mas o saque rejeita com
// "Saldo insuficiente: R$ 0,00".
async function computeProviderBalance(
  adminDb: ReturnType<typeof db>,
  providerId: string,
): Promise<{ available: number; pending: number }> {
  // Fonte 1: splits explícitos (pagamentos via novo sistema)
  const { data: splits } = await adminDb
    .from("provider_splits")
    .select("amount, status")
    .eq("provider_user_id", providerId);

  const totalFromSplits = (splits ?? [])
    .filter((s: any) => s.status === "transferred")
    .reduce((sum: number, s: any) => sum + Number(s.amount), 0);

  const pendingFromSplits = (splits ?? [])
    .filter((s: any) => s.status === "pending")
    .reduce((sum: number, s: any) => sum + Number(s.amount), 0);

  // Fonte 2: pagamentos confirmados antigos (sem split explícito)
  // Calcula provider_amount = quote_amount * (1 - commission_rate)
  const { data: sub } = await adminDb
    .from("provider_subscriptions")
    .select("commission_rate")
    .eq("provider_user_id", providerId)
    .maybeSingle();
  const commissionRate = Number(sub?.commission_rate ?? 0.10);

  const { data: confirmedJobs } = await adminDb
    .from("service_requests")
    .select("id, quote_amount")
    .eq("provider_user_id", providerId)
    .eq("payment_status", "confirmed")
    .not("quote_amount", "is", null);

  // Verificar quais já têm split para não contar dobrado
  const splitPaymentIds = new Set<string>();
  if (splits && splits.length > 0) {
    const { data: paymentRefs } = await adminDb
      .from("provider_splits")
      .select("payment_id")
      .eq("provider_user_id", providerId);
    const { data: relatedPayments } = await adminDb
      .from("payments")
      .select("id, service_request_id")
      .in("id", (paymentRefs ?? []).map((p: any) => p.payment_id));
    (relatedPayments ?? []).forEach((p: any) => splitPaymentIds.add(p.service_request_id));
  }

  const totalFromOldPayments = (confirmedJobs ?? [])
    .filter((j: any) => !splitPaymentIds.has(j.id))
    .reduce((sum: number, j: any) => {
      const gross = Number(j.quote_amount ?? 0);
      return sum + Math.round(gross * (1 - commissionRate) * 100) / 100;
    }, 0);

  // Total sacado
  const { data: withdrawn } = await adminDb
    .from("provider_withdrawals")
    .select("amount")
    .eq("provider_user_id", providerId)
    .in("status", ["completed", "processing"]);

  const totalWithdrawn = (withdrawn ?? []).reduce((s: number, r: any) => s + Number(r.amount), 0);
  const totalEarned = totalFromSplits + totalFromOldPayments;
  const available = Math.max(0, totalEarned - totalWithdrawn);

  return { available, pending: pendingFromSplits };
}

// ── US-012: Saldo disponível do prestador ─────────────────────────────────────
app.get("/v1/providers/:id/balance", async (c) => {
  const providerId = c.req.param("id");
  const userId = c.get("userId");
  if (userId !== providerId) return c.json({ message: "Não autorizado." }, 403);

  const { available, pending } = await computeProviderBalance(db(c.env), providerId);
  return c.json({ available, pending });
});

// ── US-012: Solicitar saque via Pix ──────────────────────────────────────────
app.post("/v1/providers/:id/withdrawal", async (c) => {
  const providerId = c.req.param("id");
  const userId = c.get("userId");
  if (userId !== providerId) return c.json({ message: "Não autorizado." }, 403);

  const body = await c.req.json<{ amount: number; pix_key: string }>().catch(() => ({} as any));

  if (!body.amount || body.amount <= 0) return c.json({ message: "Valor inválido." }, 400);
  if (!body.pix_key?.trim()) return c.json({ message: "Chave Pix obrigatória." }, 400);

  const adminDb = db(c.env);

  // Verificar saldo disponível — usa o MESMO cálculo do endpoint /balance
  // para evitar divergência entre o saldo exibido e o saldo de saque.
  const { available } = await computeProviderBalance(adminDb, providerId);

  if (body.amount > available) {
    return c.json({ message: `Saldo insuficiente. Disponível: R$ ${available.toFixed(2).replace(".", ",")}` }, 400);
  }

  const { data, error } = await adminDb
    .from("provider_withdrawals")
    .insert({
      provider_user_id: providerId,
      amount: body.amount,
      pix_key: body.pix_key.trim(),
      status: "requested",
    })
    .select("id, amount, pix_key, status, created_at")
    .single();

  if (error) return c.json({ message: error.message }, 400);

  await sendPush(c.env, providerId, "💸 Saque solicitado!", `Seu saque de R$ ${body.amount.toFixed(2).replace(".", ",")} via Pix foi solicitado e será processado em até 1 dia útil.`);

  return c.json({ withdrawal: data }, 201);
});

// ── Listar saques do prestador ────────────────────────────────────────────────
app.get("/v1/providers/:id/withdrawals", async (c) => {
  const providerId = c.req.param("id");
  const userId = c.get("userId");
  if (userId !== providerId) return c.json({ message: "Não autorizado." }, 403);

  const { data, error } = await db(c.env)
    .from("provider_withdrawals")
    .select("id, amount, pix_key, status, created_at, processed_at")
    .eq("provider_user_id", providerId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return c.json({ error: error.message }, 500);
  return c.json({ withdrawals: data ?? [] });
});

// ── Retornar chave pública MP para tokenizar cartão no client ─────────────────
app.get("/v1/mp-public-key", (c) => {
  if (!c.env.MERCADOPAGO_PUBLIC_KEY) {
    return c.json({ message: "Chave pública não configurada." }, 503);
  }
  return c.json({ publicKey: c.env.MERCADOPAGO_PUBLIC_KEY });
});

// ═══════════════════════════════════════════════════════════════════════════
// US-013: ASSINATURAS SAAS (MP Preapproval)
// ═══════════════════════════════════════════════════════════════════════════

const PLAN_CONFIG = {
  free:    { price: 0,     jobsLimit: 5,    commission: 0.10, label: "Free" },
  pro:     { price: 49.90, jobsLimit: null, commission: 0.08, label: "Pro" },
  premium: { price: 99.90, jobsLimit: null, commission: 0.06, label: "Premium" },
} as const;
type PlanId = keyof typeof PLAN_CONFIG;

// Retornar plano atual do prestador
app.get("/v1/providers/:id/subscription", async (c) => {
  const { data } = await db(c.env)
    .from("provider_subscriptions")
    .select("plan, status, current_period_end, monthly_job_count, commission_rate")
    .eq("provider_user_id", c.req.param("id"))
    .maybeSingle();

  return c.json({
    plan: data?.plan ?? "free",
    status: data?.status ?? "active",
    current_period_end: data?.current_period_end ?? null,
    monthly_job_count: data?.monthly_job_count ?? 0,
    commission_rate: data?.commission_rate ?? 0.10,
    jobs_limit: PLAN_CONFIG[(data?.plan as PlanId) ?? "free"].jobsLimit,
  });
});

// Criar / atualizar assinatura Pro ou Premium
app.post("/v1/providers/:id/subscription", async (c) => {
  const providerId = c.req.param("id");
  const userId = c.get("userId");
  if (userId !== providerId) return c.json({ message: "Não autorizado." }, 403);

  const body = await c.req.json<{ plan: string; payer_email: string }>().catch(() => ({} as any));
  const planId = body.plan as PlanId;
  if (!planId || !(planId in PLAN_CONFIG)) {
    return c.json({ message: "Plano inválido. Use: free, pro ou premium." }, 400);
  }

  // Plano free → apenas atualizar no banco, sem MP
  if (planId === "free") {
    await db(c.env).from("provider_subscriptions").upsert({
      provider_user_id: providerId,
      plan: "free",
      status: "active",
      commission_rate: 0.10,
      mp_subscription_id: null,
      current_period_end: null,
    }, { onConflict: "provider_user_id" });
    return c.json({ plan: "free", message: "Plano gratuito ativado." });
  }

  if (!c.env.MERCADOPAGO_ACCESS_TOKEN) {
    return c.json({ message: "Integração com MercadoPago não configurada." }, 503);
  }

  const planConf = PLAN_CONFIG[planId];

  // Criar preapproval no MP
  const mpRes = await fetch("https://api.mercadopago.com/preapproval", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${c.env.MERCADOPAGO_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      reason: `ConstruConnect — Plano ${planConf.label}`,
      auto_recurring: {
        frequency: 1,
        frequency_type: "months",
        transaction_amount: planConf.price,
        currency_id: "BRL",
      },
      back_url: "construconnect://subscription-success",
      payer_email: body.payer_email,
      external_reference: providerId,
    }),
  });

  if (!mpRes.ok) {
    const err = await mpRes.text();
    return c.json({ message: `Erro MercadoPago: ${err}` }, 400);
  }

  const mpSub = await mpRes.json() as { id: string; init_point: string; status: string };

  // Salvar assinatura pendente
  await db(c.env).from("provider_subscriptions").upsert({
    provider_user_id: providerId,
    plan: planId,
    status: "pending",
    commission_rate: planConf.commission,
    mp_subscription_id: mpSub.id,
    current_period_end: null,
  }, { onConflict: "provider_user_id" });

  return c.json({ initPoint: mpSub.init_point, subscriptionId: mpSub.id });
});

// Webhook de assinatura MP (preapproval)
app.post("/v1/webhooks/mercadopago/subscription", async (c) => {
  try {
    const body = await c.req.json<{ type?: string; data?: { id?: string } }>().catch(() => ({ type: undefined, data: undefined }));
    if (body.type !== "preapproval" || !body.data?.id) return c.json({ ok: true });
    if (!c.env.MERCADOPAGO_ACCESS_TOKEN) return c.json({ ok: true });

    const mpRes = await fetch(`https://api.mercadopago.com/preapproval/${body.data.id}`, {
      headers: { Authorization: `Bearer ${c.env.MERCADOPAGO_ACCESS_TOKEN}` },
    });
    if (!mpRes.ok) return c.json({ ok: true });

    const sub = await mpRes.json() as {
      status: string;
      external_reference: string;
      next_payment_date?: string;
    };

    if (!sub.external_reference) return c.json({ ok: true });
    const providerId = sub.external_reference;

    const { data: existing } = await db(c.env)
      .from("provider_subscriptions")
      .select("plan")
      .eq("provider_user_id", providerId)
      .maybeSingle();

    const planId = (existing?.plan as PlanId | undefined) ?? "free";
    const planConf = PLAN_CONFIG[planId] ?? PLAN_CONFIG.free;

    const periodEnd = sub.next_payment_date
      ? new Date(sub.next_payment_date).toISOString()
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    await db(c.env).from("provider_subscriptions").update({
      status: sub.status === "authorized" ? "active" : sub.status === "cancelled" ? "cancelled" : "past_due",
      current_period_end: periodEnd,
      commission_rate: planConf.commission,
    }).eq("provider_user_id", providerId);

    if (sub.status === "authorized") {
      await sendPush(c.env, providerId, "✅ Assinatura ativa!", `Seu plano ${planConf.label} está ativo até ${new Date(periodEnd).toLocaleDateString("pt-BR")}.`);
    }

    return c.json({ ok: true });
  } catch { return c.json({ ok: true }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// US-016: LIMITE DE CHAMADOS PARA PLANO FREE
// ═══════════════════════════════════════════════════════════════════════════

async function enforceJobLimit(env: Bindings, providerUserId: string): Promise<{ allowed: boolean; message?: string }> {
  const { data: sub } = await db(env)
    .from("provider_subscriptions")
    .select("plan, status, monthly_job_count")
    .eq("provider_user_id", providerUserId)
    .maybeSingle();

  const plan = (sub?.plan ?? "free") as PlanId;
  const conf = PLAN_CONFIG[plan];

  // Planos pagos sem limite
  if (!conf.jobsLimit) return { allowed: true };

  // Verificar se assinatura está ativa
  if (sub?.status !== "active") return { allowed: true };

  const count = sub?.monthly_job_count ?? 0;
  if (count >= conf.jobsLimit) {
    return {
      allowed: false,
      message: `Limite de ${conf.jobsLimit} chamados/mês atingido no plano Free. Faça upgrade para o plano Pro para chamados ilimitados.`,
    };
  }
  return { allowed: true };
}

async function incrementJobCount(env: Bindings, providerUserId: string) {
  // Ler e incrementar de forma segura
  const { data } = await db(env).from("provider_subscriptions")
    .select("monthly_job_count")
    .eq("provider_user_id", providerUserId)
    .maybeSingle();

  await db(env).from("provider_subscriptions")
    .update({ monthly_job_count: (data?.monthly_job_count ?? 0) + 1 })
    .eq("provider_user_id", providerUserId);
}

// ═══════════════════════════════════════════════════════════════════════════
// US-017: HEARTBEAT DE GPS DO PRESTADOR
// ═══════════════════════════════════════════════════════════════════════════

app.post("/v1/providers/:id/location", async (c) => {
  const providerId = c.req.param("id");
  const userId = c.get("userId");
  if (userId !== providerId) return c.json({ message: "Não autorizado." }, 403);

  const body = await c.req.json<{ latitude: number; longitude: number; heading?: number }>().catch(() => ({} as any));
  if (body.latitude == null || body.longitude == null) {
    return c.json({ message: "latitude e longitude são obrigatórios." }, 400);
  }

  await db(c.env).from("provider_locations").upsert({
    provider_user_id: providerId,
    latitude: body.latitude,
    longitude: body.longitude,
    heading: body.heading ?? null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "provider_user_id" });

  // Atualizar last_seen_at em provider_profiles também
  await db(c.env).from("provider_profiles")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("user_id", providerId);

  return c.json({ ok: true });
});

// ── Salvar relatório de serviço ────────────────────────────────────────────
app.post("/v1/service-requests/:id/report", async (c) => {
  const userId = c.get("userId");
  const serviceRequestId = c.req.param("id");

  const body = await c.req.json<{
    overall_rating: number;
    punctuality: number;
    behavior: number;
    cleanliness: number;
    material_quality: number;
    estimated_time?: number;
    actual_time?: number;
    comments?: string;
    issues_found?: string;
  }>();

  const adminDb = db(c.env);

  // Validar que o chamado pertence ao cliente
  const { data: request } = await adminDb
    .from("service_requests")
    .select("client_user_id, provider_user_id, status")
    .eq("id", serviceRequestId)
    .maybeSingle();

  if (!request || request.client_user_id !== userId) {
    return c.json({ message: "Chamado não encontrado ou não autorizado." }, 404);
  }

  if (request.status !== "completed") {
    return c.json({ message: "Relatório só pode ser preenchido após serviço finalizado." }, 400);
  }

  // Validar ratings
  for (const [key, val] of Object.entries(body)) {
    if (["overall_rating", "punctuality", "behavior", "cleanliness", "material_quality"].includes(key)) {
      const num = Number(val);
      if (num < 1 || num > 5) {
        return c.json({ message: `${key} deve estar entre 1 e 5.` }, 400);
      }
    }
  }

  const { error } = await adminDb.from("service_reports").upsert({
    request_id: serviceRequestId,
    client_user_id: userId,
    provider_user_id: request.provider_user_id,
    overall_rating: body.overall_rating,
    punctuality: body.punctuality,
    behavior: body.behavior,
    cleanliness: body.cleanliness,
    material_quality: body.material_quality,
    estimated_time: body.estimated_time,
    actual_time: body.actual_time,
    comments: body.comments,
    issues_found: body.issues_found,
  }, { onConflict: "request_id" });

  if (error) return c.json({ message: error.message }, 500);

  return c.json({ ok: true, message: "Relatório salvo com sucesso." });
});

// ── Buscar relatório do serviço ────────────────────────────────────────────
app.get("/v1/service-requests/:id/report", async (c) => {
  const userId = c.get("userId");
  const serviceRequestId = c.req.param("id");

  const adminDb = db(c.env);

  const { data: request } = await adminDb
    .from("service_requests")
    .select("client_user_id, provider_user_id")
    .eq("id", serviceRequestId)
    .maybeSingle();

  if (!request || (request.client_user_id !== userId && request.provider_user_id !== userId)) {
    return c.json({ message: "Não autorizado." }, 403);
  }

  const { data: report } = await adminDb
    .from("service_reports")
    .select("*")
    .eq("request_id", serviceRequestId)
    .maybeSingle();

  return c.json({ report: report ?? null });
});

// ═══════════════════════════════════════════════════════════════════════════
// US-020: LGPD — EXCLUSÃO / ANONIMIZAÇÃO DE CONTA
// ═══════════════════════════════════════════════════════════════════════════

app.delete("/v1/account", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{ confirm: string }>().catch(() => ({} as any));

  if (body.confirm !== "EXCLUIR MINHA CONTA") {
    return c.json({ message: 'Para confirmar, envie { "confirm": "EXCLUIR MINHA CONTA" } no corpo da requisição.' }, 400);
  }

  const adminDb = db(c.env);

  // 1. Anonimizar dados pessoais em app_users (LGPD art. 18)
  const anonymized = {
    full_name: `Usuário Removido ${userId.slice(0, 8)}`,
    email: `removed_${userId.slice(0, 8)}@deleted.construconnect`,
    phone: "",
    document_number: "",
    avatar_url: null,
    blocked_until: new Date().toISOString(), // bloqueia acesso imediato
  };
  await adminDb.from("app_users").update(anonymized).eq("id", userId);

  // 2. Remover chave Pix e tokens de push
  await adminDb.from("app_users").update({ pix_key: null, push_token: null }).eq("id", userId);

  // 3. Cancelar assinatura ativa (se houver)
  const { data: sub } = await adminDb
    .from("provider_subscriptions")
    .select("mp_subscription_id")
    .eq("provider_user_id", userId)
    .maybeSingle();

  if (sub?.mp_subscription_id && c.env.MERCADOPAGO_ACCESS_TOKEN) {
    await fetch(`https://api.mercadopago.com/preapproval/${sub.mp_subscription_id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${c.env.MERCADOPAGO_ACCESS_TOKEN}` },
      body: JSON.stringify({ status: "cancelled" }),
    }).catch(() => {});
  }
  await adminDb.from("provider_subscriptions").update({ status: "cancelled" }).eq("provider_user_id", userId);

  // 4. Remover credenciais WebAuthn
  await adminDb.from("webauthn_credentials").delete().eq("user_id", userId);

  // 5. Deixar service_requests histórico mas sem vínculo claro (provider_user_id fica)
  //    Mensagens e fotos são removidas em cascata pelo ON DELETE

  // 6. Desativar conta no Supabase Auth
  await adminDb.auth.admin.updateUserById(userId, { ban_duration: "876000h" }).catch(() => {});

  console.log(`[LGPD] Conta anonimizada: ${userId} em ${new Date().toISOString()}`);

  return c.json({ message: "Conta excluída. Seus dados foram anonimizados conforme a LGPD." });
});

// ═══════════════════════════════════════════════════════════════════════════
// US-015: CRON — Verificar assinaturas expiradas (todo dia 03h BRT)
// ═══════════════════════════════════════════════════════════════════════════

async function checkExpiredSubscriptions(env: Bindings) {
  const now = new Date().toISOString();
  const adminDb = db(env);

  const { data: expired } = await adminDb
    .from("provider_subscriptions")
    .select("provider_user_id, plan")
    .eq("status", "active")
    .not("current_period_end", "is", null)
    .lt("current_period_end", now);

  for (const sub of expired ?? []) {
    await adminDb.from("provider_subscriptions")
      .update({ status: "expired" })
      .eq("provider_user_id", sub.provider_user_id);

    await sendPush(
      env,
      sub.provider_user_id,
      "⚠️ Assinatura expirada",
      `Seu plano ${sub.plan} expirou. Renove agora para continuar recebendo chamados ilimitados.`
    );
    console.log(`[Cron] Assinatura expirada: ${sub.provider_user_id}`);
  }

  // Reset de contador mensal (executar no dia 1 de cada mês)
  const today = new Date();
  if (today.getDate() === 1) {
    await adminDb.from("provider_subscriptions").update({ monthly_job_count: 0 });
    console.log("[Cron] Contador mensal de chamados resetado.");
  }

  return { expired: (expired ?? []).length };
}

// ─── Worker export com scheduled handler e error boundary ────────────────────
export default {
  async fetch(request: Request, env: Bindings, ctx: ExecutionContext) {
    try {
      return await app.fetch(request, env, ctx);
    } catch (err) {
      await reportError(env, err, { url: request.url, method: request.method });
      return new Response(JSON.stringify({ message: "Erro interno do servidor." }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  },
  async scheduled(_event: ScheduledEvent, env: Bindings, _ctx: ExecutionContext) {
    try {
      const result = await checkExpiredSubscriptions(env);
      console.log("[Cron] checkExpiredSubscriptions:", JSON.stringify(result));
    } catch (err) {
      await reportError(env, err, { cron: "checkExpiredSubscriptions" });
      console.error("[Cron] Error:", err);
    }
  },
};
