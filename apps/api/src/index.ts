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
  { key: "card_saved_cards",    label: "Cartão salvo",               description: "Habilita pagamento com cartão (crédito/débito) e cartões salvos no app.",   category: "Pagamentos",  enabled: false },
  { key: "chat",                label: "Chat cliente-prestador",     description: "Habilita o sistema de mensagens entre clientes e prestadores.",              category: "Comunicação", enabled: true  },
  { key: "push_notifications",  label: "Notificações push",          description: "Habilita o envio de notificações push para usuários.",                      category: "Comunicação", enabled: true  },
  { key: "ratings",             label: "Avaliações",                 description: "Permite que clientes avaliem prestadores após o serviço.",                  category: "Qualidade",   enabled: true  },
  { key: "formal_complaints",   label: "Reclamações formais",        description: "Habilita o formulário de reclamação formal para clientes.",                 category: "Qualidade",   enabled: true  },
  { key: "provider_tracking",   label: "Rastreamento de prestador",  description: "Permite que clientes vejam a localização do prestador em tempo real.",     category: "Localização", enabled: true  },
  { key: "ads_enabled",         label: "Propagandas",                description: "Exibe banners externos e prestadores patrocinados nos apps.",                 category: "Marketing",   enabled: false },
  { key: "telemedicine",        label: "Telemedicina",               description: "Habilita acesso ao parceiro de telemedicina para usuários verificados.",      category: "Parceiros",   enabled: false },
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

// ── Security headers ─────────────────────────────────────────────────────────
app.use("/v1/*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("Permissions-Policy", "camera=(), microphone=(), payment=()");
  c.header("Cache-Control", "no-store");
});

// ── Rate limiting por IP (escrita geral) + anti-carding por userId ───────────
// Limite geral: 120 req/min por IP para mutações
// Limite de cartão: 5 tentativas recusadas/hora por usuário → bloqueia 1h
const RATE_LIMIT_WRITE = 120;
const CARD_FAIL_LIMIT  = 5;
const CARD_FAIL_WINDOW = 60 * 60 * 1000; // 1 hora

const rateCache    = new Map<string, { count: number; resetAt: number }>();
const cardFailCache = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(key: string, limit = RATE_LIMIT_WRITE, windowMs = 60_000): boolean {
  const now = Date.now();
  const entry = rateCache.get(key);
  if (!entry || now > entry.resetAt) {
    rateCache.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  entry.count++;
  return entry.count <= limit;
}

function checkCardFailLimit(userId: string): boolean {
  const now = Date.now();
  const entry = cardFailCache.get(userId);
  if (!entry || now > entry.resetAt) return true;
  return entry.count < CARD_FAIL_LIMIT;
}

function recordCardFail(userId: string): void {
  const now = Date.now();
  const entry = cardFailCache.get(userId);
  if (!entry || now > entry.resetAt) {
    cardFailCache.set(userId, { count: 1, resetAt: now + CARD_FAIL_WINDOW });
  } else {
    entry.count++;
  }
}

function clearCardFails(userId: string): void {
  cardFailCache.delete(userId);
}

// Middleware de rate limit por IP
app.use("/v1/*", async (c, next) => {
  const method = c.req.method;
  if (method === "GET" || method === "OPTIONS") return next();
  const ip = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? "unknown";
  if (!checkRateLimit(`ip:${ip}`)) {
    return c.json({ message: "Muitas requisições. Tente novamente em 1 minuto." }, 429);
  }
  return next();
});

// ── Audit log helper (best-effort, nunca falha a requisição principal) ────────
async function logPaymentEvent(env: Bindings, event: {
  event_type: string;
  service_request_id?: string | null;
  user_id?: string | null;
  mp_payment_id?: string | null;
  amount?: number | null;
  status_before?: string | null;
  status_after?: string | null;
  ip?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    await db(env).from("payment_audit_log").insert({
      event_type:         event.event_type,
      service_request_id: event.service_request_id ?? null,
      user_id:            event.user_id ?? null,
      mp_payment_id:      event.mp_payment_id ?? null,
      amount:             event.amount ?? null,
      status_before:      event.status_before ?? null,
      status_after:       event.status_after ?? null,
      ip_address:         event.ip ?? null,
      metadata:           event.metadata ?? null,
    });
  } catch (e) {
    console.error("[audit] falha ao registrar evento de pagamento:", e);
  }
}

// ── Ads: registrar clique (anônimo — antes do middleware de auth) ────────────
// Endpoint público: qualquer cliente pode registrar um clique em um anúncio.
// Race condition intencional documentada: MVP anônimo aceita pequeno desvio de
// contagem em cenários de alta concorrência (aceitável para billing estimado).
app.post("/v1/ads/:id/click", async (c) => {
  const id = c.req.param("id");

  // Valida que o id tem formato UUID para evitar injeção via path
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return c.json({ message: "ID inválido." }, 400);
  }

  const adminDb = db(c.env);

  // Busca o valor atual para garantir que o anúncio existe
  const { data: ad } = await adminDb
    .from("ads")
    .select("clicks_total")
    .eq("id", id)
    .maybeSingle();

  if (!ad) return c.json({ message: "Anúncio não encontrado." }, 404);

  const { error } = await adminDb
    .from("ads")
    .update({ clicks_total: ad.clicks_total + 1 })
    .eq("id", id);

  if (error) {
    console.error("[ads/click] erro ao incrementar clique:", error.message, "ad_id:", id);
    return c.json({ message: "Erro ao registrar clique." }, 500);
  }

  return c.json({ ok: true });
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
  "/v1/mp-public-key",
  "/v1/crm/auth/login",
  "/v1/ads/banners",
  "/v1/ads/sponsored-providers",
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
// PBKDF2-SHA256 (Web Crypto). Novos hashes: v2 (600 000 iter, OWASP 2024).
// Hashes legados sem prefixo usavam 100 000 iter e ainda são verificados.
const toHex = (a: Uint8Array) => [...a].map((b) => b.toString(16).padStart(2, "0")).join("");

async function hashSenha(senha: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMat = await crypto.subtle.importKey("raw", new TextEncoder().encode(senha), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 600_000, hash: "SHA-256" }, keyMat, 256);
  return `v2:${toHex(salt)}:${toHex(new Uint8Array(bits))}`;
}

async function verifySenha(senha: string, stored: string): Promise<boolean> {
  if (!stored) return false;
  let saltHex: string, hashHex: string, iterations: number;
  if (stored.startsWith("v2:")) {
    // PBKDF2 600 000 (OWASP 2024)
    const parts = stored.slice(3).split(":");
    [saltHex, hashHex] = parts;
    iterations = 600_000;
  } else {
    // Legado: PBKDF2 100 000
    [saltHex, hashHex] = stored.split(":");
    iterations = 100_000;
  }
  if (!saltHex || !hashHex) return false;
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
  const keyMat = await crypto.subtle.importKey("raw", new TextEncoder().encode(senha), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, keyMat, 256);
  // Comparação em tempo constante via HMAC para evitar timing attack
  const calc = toHex(new Uint8Array(bits));
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode("timing-safe"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const [aSig, bSig] = await Promise.all([
    crypto.subtle.sign("HMAC", key, enc.encode(calc)),
    crypto.subtle.sign("HMAC", key, enc.encode(hashHex)),
  ]);
  const aArr = new Uint8Array(aSig), bArr = new Uint8Array(bSig);
  return aArr.length === bArr.length && aArr.every((v, i) => v === bArr[i]);
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
  if (path.startsWith("/v1/admin/telemedicine")) return "marketing";
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
    const pushFlag = await env.FEATURE_FLAGS.get("push_notifications", "json") as { enabled: boolean } | null;
    if (pushFlag != null && !pushFlag.enabled) return;
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

  const adminDb = db(c.env);

  const { data: sr } = await adminDb
    .from("service_requests")
    .select("status, payment_status, client_user_id")
    .eq("id", jobId)
    .maybeSingle();

  if (!sr) return c.json({ message: "Pedido não encontrado." }, 404);
  if (sr.client_user_id !== body.client_user_id) return c.json({ message: "Não autorizado." }, 403);
  if (sr.status === "completed") return c.json({ message: "Não é possível cancelar um pedido já concluído." }, 422);
  if (sr.status === "cancelled") return c.json({ message: "Pedido já cancelado." }, 409);

  const { error } = await adminDb
    .from("service_requests")
    .update({ status: "cancelled" })
    .eq("id", jobId)
    .eq("client_user_id", body.client_user_id);

  if (error) return c.json({ message: error.message }, 400);

  // Estorno automático apenas se o pagamento já foi confirmado
  let refund_status: "none" | "ok" | "failed" = "none";

  if (sr.payment_status === "confirmed" && c.env.MERCADOPAGO_ACCESS_TOKEN) {
    const { data: pay } = await adminDb
      .from("payments")
      .select("mp_payment_id")
      .eq("service_request_id", jobId)
      .eq("status", "approved")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (pay?.mp_payment_id) {
      try {
        const mpRes = await fetch(
          `https://api.mercadopago.com/v1/payments/${pay.mp_payment_id}/refunds`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${c.env.MERCADOPAGO_ACCESS_TOKEN}`,
            },
            body: "{}",
          }
        );

        if (mpRes.ok) {
          await adminDb
            .from("service_requests")
            .update({ payment_status: "refunded" })
            .eq("id", jobId);
          await adminDb
            .from("payments")
            .update({ status: "refunded" })
            .eq("mp_payment_id", pay.mp_payment_id);
          refund_status = "ok";
        } else {
          await adminDb
            .from("service_requests")
            .update({ payment_status: "refund_failed" })
            .eq("id", jobId);
          refund_status = "failed";
          console.error("[Refund] MP error:", mpRes.status, "jobId:", jobId, "mp_id:", pay.mp_payment_id);
        }
      } catch (err) {
        await adminDb
          .from("service_requests")
          .update({ payment_status: "refund_failed" })
          .eq("id", jobId);
        refund_status = "failed";
        console.error("[Refund] Exception:", err, "jobId:", jobId);
      }
    }
  }

  return c.json({ message: "Pedido cancelado com sucesso.", refund_status });
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
    .select("provider_user_id, client_rating, status, client_user_id, payment_status")
    .eq("id", id)
    .maybeSingle();

  if (!req) return c.json({ message: "Pedido não encontrado." }, 404);
  if (req.status !== "completed") return c.json({ message: "Serviço não concluído." }, 400);
  if (req.client_rating != null) return c.json({ message: "Pedido já avaliado." }, 400);
  if (req.client_user_id !== body.client_user_id) return c.json({ message: "Não autorizado." }, 403);
  if (req.payment_status !== "confirmed") return c.json({ message: "Avalie após a confirmação do pagamento." }, 422);

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

// ── US-010 / F3: Pagamento via cartão com split (hardening) ───────────────────
// Authz por dono (corrige IDOR), idempotência via key do cliente (corrige
// cobrança dupla), split descontando a taxa do MP do prestador, save_card
// opt-in best-effort e recusa (rejected) → 402. Forma de resposta =
// CardPaymentResult (packages/shared).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const round2 = (n: number) => Math.round(n * 100) / 100;

app.post("/v1/service-requests/:id/create-card-payment", async (c) => {
  const clientId = c.get("userId");
  const id = c.req.param("id");
  const body = await c.req.json<{
    token: string;
    installments: number;
    payment_method_id: string;
    issuer_id?: string;
    payer_email: string;
    payer_first_name?: string;
    payer_last_name?: string;
    payer_cpf?: string;
    device_id?: string;
    save_card?: boolean;
    idempotency_key?: string;
  }>().catch(() => ({} as any));

  // ── Validação de entrada ──────────────────────────────────────────────────
  if (!body.token || !body.installments || !body.payment_method_id || !body.payer_email) {
    return c.json({ message: "Campos obrigatórios: token, installments, payment_method_id, payer_email." }, 400);
  }
  if (typeof body.installments !== "number" || !Number.isInteger(body.installments) || body.installments < 1 || body.installments > 24) {
    return c.json({ message: "installments deve ser inteiro entre 1 e 24." }, 400);
  }
  // idempotency_key obrigatória para evitar cobranças duplas
  if (!body.idempotency_key || !UUID_RE.test(body.idempotency_key)) {
    return c.json({ message: "idempotency_key inválida ou ausente (UUID v4 obrigatório)." }, 400);
  }
  // Tokens MP são strings não-vazias de no máximo 256 chars
  if (typeof body.token !== "string" || body.token.length < 4 || body.token.length > 256) {
    return c.json({ message: "Token de cartão inválido." }, 400);
  }
  // payer_email básico
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.payer_email)) {
    return c.json({ message: "payer_email inválido." }, 400);
  }

  if (!c.env.MERCADOPAGO_ACCESS_TOKEN) {
    return c.json({ message: "Integração com Mercado Pago não configurada." }, 503);
  }

  // ── Anti-carding: bloqueia após 5 recusas/hora por usuário ───────────────
  if (!checkCardFailLimit(clientId)) {
    const ip = c.req.header("cf-connecting-ip") ?? "unknown";
    console.warn("[card-payment] anti-carding: usuário bloqueado", { clientId, ip });
    await logPaymentEvent(c.env, {
      event_type: "blocked_carding",
      service_request_id: id,
      user_id: clientId,
      ip,
      metadata: { reason: "exceeded_card_fail_limit" },
    });
    return c.json({ message: "Muitas tentativas recusadas. Aguarde 1 hora antes de tentar novamente." }, 429);
  }

  const adminDb = db(c.env);
  const ip = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? null;

  const { data: req } = await adminDb
    .from("service_requests")
    .select("quote_amount, category, client_user_id, provider_user_id, status, payment_status, quote_status")
    .eq("id", id)
    .maybeSingle();

  // Aceita pagamento quando orçamento foi enviado pelo prestador (quoted) e ainda não foi pago.
  // Cobre tanto o pagamento inicial quanto a retentativa após recusa.
  if (!req || req.quote_status !== "quoted") {
    return c.json({ message: "Orçamento não disponível para pagamento." }, 400);
  }
  // Authz por dono: só o cliente da SR pode disparar a cobrança (corrige IDOR).
  if (req.client_user_id !== clientId) {
    console.warn("[card-payment] tentativa de cobrar SR alheia", { id, clientId });
    await logPaymentEvent(c.env, {
      event_type: "unauthorized_attempt",
      service_request_id: id,
      user_id: clientId,
      ip,
      metadata: { owner: req.client_user_id, attacker: clientId },
    });
    return c.json({ message: "Não autorizado." }, 403);
  }
  if (!req.quote_amount) {
    return c.json({ message: "Valor do serviço não definido." }, 400);
  }
  if (req.payment_status === "confirmed") {
    return c.json({ message: "Este serviço já foi pago." }, 409);
  }

  // Log da tentativa antes de chamar o MP
  await logPaymentEvent(c.env, {
    event_type: "attempt",
    service_request_id: id,
    user_id: clientId,
    amount: Number(req.quote_amount),
    status_before: req.payment_status,
    ip,
    metadata: { installments: body.installments, method: body.payment_method_id },
  });

  // Telefone do cliente p/ enriquecer o pagador — ajuda no antifraude do MP.
  const { data: client } = await adminDb
    .from("app_users")
    .select("phone")
    .eq("id", clientId)
    .maybeSingle();

  const amount = Number(req.quote_amount);
  const commissionRate = req.provider_user_id
    ? await getProviderCommissionRate(c.env, req.provider_user_id)
    : 0.10;
  // Comissão da plataforma incide sobre o BRUTO (decisão de produto).
  const platformFee = round2(amount * commissionRate);

  // save_card sem reusar o token (one-shot, consumido na cobrança): associamos o
  // customer ao pagamento; o MP devolve o cartão salvo em payment.card e nós
  // persistimos a ref após a aprovação. Se o customer falhar, seguimos a cobrança
  // sem salvar (best-effort — nunca derruba o pagamento por causa do "salvar").
  let saveCustomerId: string | null = null;
  if (body.save_card === true) {
    try {
      const cust = await ensureMpCustomer(c.env, clientId);
      if (cust.ok) saveCustomerId = cust.customerId;
      else console.warn("[card-payment] save_card: customer indisponivel, segue sem salvar", cust.status);
    } catch (e) {
      console.error("[card-payment] save_card: ensureMpCustomer lançou", clientId, e);
    }
  }

  // Enriquece o pagador (nome + CPF) — melhora a taxa de aprovação no antifraude do MP.
  const payer: Record<string, unknown> = { email: body.payer_email };
  if (body.payer_first_name) payer.first_name = body.payer_first_name;
  if (body.payer_last_name) payer.last_name = body.payer_last_name;
  if (body.payer_cpf) payer.identification = { type: "CPF", number: body.payer_cpf };
  let phoneDigits = String(client?.phone ?? "").replace(/\D/g, "");
  if (phoneDigits.length > 11 && phoneDigits.startsWith("55")) phoneDigits = phoneDigits.slice(2);
  if (phoneDigits.length >= 10) {
    payer.phone = { area_code: phoneDigits.slice(0, 2), number: phoneDigits.slice(2) };
  }
  if (saveCustomerId) { payer.type = "customer"; payer.id = saveCustomerId; }

  const payload: Record<string, unknown> = {
    transaction_amount: amount,
    token: body.token,
    description: `Serviço de ${req.category} - ConstruConnect`,
    installments: body.installments,
    payment_method_id: body.payment_method_id,
    external_reference: id,
    payer,
    // 3DS 2.0: autenticação adicional que melhora aprovação em transações barradas
    // por risco. "optional" = só desafia quando o emissor exige.
    three_d_secure_mode: "optional",
  };
  if (body.issuer_id) payload.issuer_id = body.issuer_id;

  // additional_info: itens + pagador — recomendado pelo MP p/ melhorar a aprovação.
  const aiPayer: Record<string, unknown> = {};
  if (body.payer_first_name) aiPayer.first_name = body.payer_first_name;
  if (body.payer_last_name) aiPayer.last_name = body.payer_last_name;
  if (payer.phone) aiPayer.phone = payer.phone;
  payload.additional_info = {
    items: [{
      id,
      title: `Serviço de ${req.category}`,
      description: "ConstruConnect",
      category_id: "services",
      quantity: 1,
      unit_price: amount,
    }],
    ...(Object.keys(aiPayer).length ? { payer: aiPayer } : {}),
  };

  // Idempotência: a key do cliente identifica a MESMA intenção de cobrança em
  // retries (corrige cobrança dupla). Fallback determinístico por SR+cliente.
  const idemKey = body.idempotency_key && UUID_RE.test(body.idempotency_key)
    ? body.idempotency_key
    : `card-${id}-${clientId}`;

  const mpRes = await fetch("https://api.mercadopago.com/v1/payments", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${c.env.MERCADOPAGO_ACCESS_TOKEN}`,
      "X-Idempotency-Key": idemKey,
      // Device fingerprint (antifraude) — fator chave de aprovação.
      ...(body.device_id ? { "X-meli-session-id": body.device_id } : {}),
    },
    body: JSON.stringify(payload),
  });

  if (!mpRes.ok) {
    const err = await mpRes.text();
    console.error("[card-payment] MP retornou erro", mpRes.status, err);
    // Não vaza o corpo do MP ao cliente.
    return c.json({ message: "Não foi possível processar o pagamento. Tente novamente." }, 502);
  }

  const mpPayment = await mpRes.json() as {
    id: number;
    status: string;
    status_detail: string;
    payment_type_id?: string;
    fee_details?: Array<{ type?: string; amount?: number; fee_payer?: string }>;
    transaction_details?: { net_received_amount?: number };
    card?: {
      id?: string;
      last_four_digits?: string;
      expiration_month?: number;
      expiration_year?: number;
      cardholder?: { name?: string };
    };
    three_ds_info?: { external_resource_url?: string; creq?: string };
  };
  const mpPaymentId = String(mpPayment.id);

  // Recusa: não registra split nem confirma; devolve o motivo (status_detail).
  if (mpPayment.status === "rejected") {
    console.warn("[card-payment] pagamento recusado", { id, mpPaymentId, statusDetail: mpPayment.status_detail });
    // Contador anti-carding: incrementa falha para esse usuário
    recordCardFail(clientId);
    const failEntry = cardFailCache.get(clientId);
    const failCount = failEntry?.count ?? 1;
    console.warn("[card-payment] anti-carding contador", { clientId, failCount });

    // Auditoria best-effort (não falha o fluxo se duplicar em retry).
    const { error: rejErr } = await adminDb.from("payments").insert({
      service_request_id: id,
      mp_payment_id: mpPaymentId,
      amount,
      platform_fee: platformFee,
      provider_amount: 0,
      payment_method: "card",
      status: "rejected",
      payer_email: body.payer_email,
      installments: body.installments,
    });
    if (rejErr && (rejErr as any).code !== "23505") {
      console.error("[card-payment] auditoria de recusa falhou", id, rejErr.message);
    }
    // Registra no audit log de pagamentos
    await logPaymentEvent(c.env, {
      event_type: "rejected",
      service_request_id: id,
      user_id: clientId,
      mp_payment_id: mpPaymentId,
      amount,
      status_before: req.payment_status,
      status_after: "rejected",
      ip,
      metadata: { statusDetail: mpPayment.status_detail, failCount },
    });
    // Marca a SR como recusada (o cliente pode tentar de novo) e notifica.
    await adminDb
      .from("service_requests")
      .update({ payment_status: "rejected", payment_method: "card" })
      .eq("id", id);
    if (req.client_user_id) {
      await sendPush(c.env, req.client_user_id, "❌ Pagamento recusado", "Seu pagamento com cartão não foi aprovado. Tente outro cartão ou outra forma de pagamento.");
    }
    return c.json({
      status: mpPayment.status,
      statusDetail: mpPayment.status_detail,
      mpPaymentId,
      amount,
      platformFee,
      mpFee: 0,
      providerAmount: 0,
      installments: body.installments,
    }, 402);
  }

  const approved = mpPayment.status === "approved";

  // Taxa do MP: 100% do prestador (decisão). Soma os fee_details do collector;
  // fallback = bruto − net_received_amount. Só é conhecida quando aprovado.
  let mpFee = 0;
  if (approved) {
    const fees = Array.isArray(mpPayment.fee_details) ? mpPayment.fee_details : [];
    const collectorFee = fees
      .filter((f) => f?.fee_payer === "collector")
      .reduce((sum, f) => sum + Number(f?.amount ?? 0), 0);
    mpFee = collectorFee > 0
      ? round2(collectorFee)
      : Math.max(0, round2(amount - Number(mpPayment.transaction_details?.net_received_amount ?? amount)));
  }
  const providerAmount = round2(amount - platformFee - mpFee);

  // Registrar na tabela payments (mp_fee_amount e installments p/ auditoria).
  const { error: payErr } = await adminDb.from("payments").insert({
    service_request_id: id,
    mp_payment_id: mpPaymentId,
    amount,
    platform_fee: platformFee,
    provider_amount: providerAmount,
    mp_fee_amount: mpFee,
    installments: body.installments,
    payment_method: "card",
    status: approved ? "approved" : "pending",
    payer_email: body.payer_email,
    confirmed_at: approved ? new Date().toISOString() : null,
  });
  // 23505 = retry idempotente (mesmo mp_payment_id já registrado): segue.
  if (payErr && (payErr as any).code !== "23505") {
    console.error("[card-payment] insert payments falhou", id, payErr.message);
  }

  if (approved) {
    // Pagamento aprovado: zera o contador anti-carding deste usuário
    clearCardFails(clientId);

    // Registra aprovação no audit log
    await logPaymentEvent(c.env, {
      event_type: "approved",
      service_request_id: id,
      user_id: clientId,
      mp_payment_id: mpPaymentId,
      amount,
      status_before: req.payment_status,
      status_after: "confirmed",
      ip,
      metadata: { installments: body.installments, mpFee, providerAmount, platformFee },
    });

    // Confirma pagamento E aceita o chamado atomicamente: o prestador só é
    // notificado para ir ao local após o dinheiro ser capturado.
    await adminDb
      .from("service_requests")
      .update({ payment_status: "confirmed", payment_method: "card", status: "accepted", quote_status: "accepted" })
      .eq("id", id);

    // Criar split para o prestador imediatamente (cartão aprova na hora)
    const { data: paymentRecord } = await adminDb
      .from("payments")
      .select("id")
      .eq("mp_payment_id", mpPaymentId)
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

    // save_card opt-in e best-effort: só crédito, só após aprovar; nunca derruba
    // a cobrança. O cartão já foi salvo no MP via associação do customer no
    // pagamento (o token one-shot NÃO é reusado); aqui só persistimos a ref a
    // partir de payment.card. Exige mês de validade válido (CHECK 1..12).
    if (
      saveCustomerId &&
      mpPayment.payment_type_id === "credit_card" &&
      mpPayment.card?.id &&
      mpPayment.card?.expiration_month
    ) {
      try {
        const card = mpPayment.card;
        const saved = await persistSavedCard(c.env, clientId, saveCustomerId, {
          mpCardId: card.id!,
          brand: body.payment_method_id ?? null,
          last4: card.last_four_digits ?? "",
          expMonth: Number(card.expiration_month),
          expYear: Number(card.expiration_year ?? 0),
          cardholderName: card.cardholder?.name ?? null,
        }, false);
        if (!saved.ok && saved.status !== 409) {
          console.warn("[card-payment] save_card best-effort falhou", { clientId, status: saved.status, message: saved.message });
        }
      } catch (e) {
        console.error("[card-payment] save_card lançou exceção", clientId, e);
      }
    }

    if (req.client_user_id) {
      await sendPush(c.env, req.client_user_id, "✅ Pagamento aprovado!", "Seu pagamento foi confirmado. O profissional está a caminho.");
    }
    if (req.provider_user_id) {
      await sendPush(c.env, req.provider_user_id, "🔔 Chamado aceito e pago!", `R$ ${providerAmount.toFixed(2).replace(".", ",")} reservado. Dirija-se ao local para iniciar o serviço.`);
    }
  } else {
    // in_process / pending: pagamento em análise (ex.: antifraude / 3DS). NÃO
    // confirma nem credita o prestador ainda — o resultado final (aprovado ou
    // recusado) chega pelo webhook do MP, que atualiza e notifica o cliente.
    await adminDb
      .from("service_requests")
      .update({ payment_status: "processing", payment_method: "card" })
      .eq("id", id);
    if (req.client_user_id) {
      await sendPush(c.env, req.client_user_id, "⏳ Pagamento em processamento", "Seu pagamento com cartão está sendo analisado. Avisaremos assim que for concluído.");
    }
  }

  return c.json({
    status: mpPayment.status,
    statusDetail: mpPayment.status_detail,
    mpPaymentId,
    amount,
    platformFee,
    mpFee,
    providerAmount,
    installments: body.installments,
    // Desafio 3DS: se o emissor exigir, o app abre a WebView com creq+URL e depois
    // sincroniza o status (GET .../card-payment-status).
    ...(mpPayment.three_ds_info?.external_resource_url
      ? { threeDs: {
          externalResourceUrl: mpPayment.three_ds_info.external_resource_url,
          creq: mpPayment.three_ds_info.creq ?? "",
        } }
      : {}),
  });
});

// ── Resolve o resultado FINAL de um pagamento MP (aprovado/recusado) numa SR.
// Compartilhado pelo webhook e pelo sync pós-3DS. Idempotente. ────────────────
async function resolveCardPaymentFinal(
  env: Bindings,
  payment: { id: number | string; status: string; payment_type_id?: string },
): Promise<void> {
  const serviceRequestId = (payment as any).external_reference;
  if (!serviceRequestId) return;
  const adminDb = db(env);

  const { data: req } = await adminDb
    .from("service_requests")
    .select("client_user_id, provider_user_id, payment_status")
    .eq("id", serviceRequestId)
    .maybeSingle();
  if (!req || req.payment_status === "confirmed") return;

  if (payment.status === "approved") {
    const mpType = String(payment.payment_type_id ?? "");
    const method = mpType.includes("card") ? "card" : mpType ? "pix" : null;
    const srUpdate: Record<string, unknown> = { payment_status: "confirmed", status: "accepted", quote_status: "accepted" };
    if (method) srUpdate.payment_method = method;
    await adminDb.from("service_requests").update(srUpdate).eq("id", serviceRequestId);

    const { data: rec } = await adminDb
      .from("payments")
      .update({ status: "approved", confirmed_at: new Date().toISOString() })
      .eq("mp_payment_id", String(payment.id))
      .select("id, provider_amount")
      .maybeSingle();
    if (rec && req.provider_user_id) {
      await adminDb.from("provider_splits").upsert({
        payment_id: rec.id,
        provider_user_id: req.provider_user_id,
        amount: rec.provider_amount,
        status: "transferred",
        transferred_at: new Date().toISOString(),
      }, { onConflict: "payment_id" });
    }
    const label = method === "card" ? "cartão" : "Pix";
    if (req.client_user_id) await sendPush(env, req.client_user_id, "✅ Pagamento aprovado!", `Seu pagamento via ${label} foi confirmado. O profissional está a caminho.`);
    if (req.provider_user_id) await sendPush(env, req.provider_user_id, "🔔 Chamado aceito e pago!", `Pagamento via ${label} aprovado. Dirija-se ao local para iniciar o serviço.`);
  } else if ((payment.status === "rejected" || payment.status === "cancelled") && req.payment_status === "processing") {
    await adminDb.from("service_requests")
      .update({ payment_status: "rejected", payment_method: "card" })
      .eq("id", serviceRequestId);
    await adminDb.from("payments").update({ status: payment.status }).eq("mp_payment_id", String(payment.id));
    if (req.client_user_id) await sendPush(env, req.client_user_id, "❌ Pagamento recusado", "Seu pagamento com cartão não foi aprovado. Tente outro cartão ou outra forma de pagamento.");
  }
}

// ── Sincroniza o status de um pagamento de cartão (usado após o desafio 3DS) ──
app.get("/v1/service-requests/:id/card-payment-status", async (c) => {
  const clientId = c.get("userId");
  if (!clientId) return c.json({ message: "Não autorizado." }, 401);
  const id = c.req.param("id");
  const mpPaymentId = c.req.query("mp_payment_id");
  if (!mpPaymentId) return c.json({ message: "mp_payment_id obrigatório." }, 400);
  if (!c.env.MERCADOPAGO_ACCESS_TOKEN) return c.json({ message: "MP não configurado." }, 503);

  const adminDb = db(c.env);
  const { data: req } = await adminDb
    .from("service_requests").select("client_user_id").eq("id", id).maybeSingle();
  if (!req || req.client_user_id !== clientId) return c.json({ message: "Não autorizado." }, 403);

  const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${mpPaymentId}`, {
    headers: { Authorization: `Bearer ${c.env.MERCADOPAGO_ACCESS_TOKEN}` },
  });
  if (!mpRes.ok) return c.json({ message: "Não foi possível consultar o pagamento." }, 502);
  const payment = await mpRes.json() as any;

  await resolveCardPaymentFinal(c.env, payment);

  return c.json({ status: payment.status, statusDetail: payment.status_detail });
});

// ── Sincroniza o pagamento de cartão pendente de uma SR (auto-curativo) ───────
// Cliente OU prestador podem chamar. Acha o último pagamento NÃO recusado da SR,
// consulta o MP e resolve (confirma/recusa + notifica + cria split). Usado quando
// o webhook/polling não fechou o pagamento (ex.: 3DS concluído fora do app).
app.get("/v1/service-requests/:id/sync-payment", async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ message: "Não autorizado." }, 401);
  const id = c.req.param("id");

  const adminDb = db(c.env);
  const { data: req } = await adminDb
    .from("service_requests")
    .select("client_user_id, provider_user_id, payment_status")
    .eq("id", id).maybeSingle();
  if (!req) return c.json({ message: "Pedido não encontrado." }, 404);
  if (req.client_user_id !== userId && req.provider_user_id !== userId) {
    return c.json({ message: "Não autorizado." }, 403);
  }
  if (req.payment_status === "confirmed") return c.json({ payment_status: "confirmed" });
  if (!c.env.MERCADOPAGO_ACCESS_TOKEN) return c.json({ payment_status: req.payment_status });

  const { data: pay } = await adminDb
    .from("payments")
    .select("mp_payment_id, status")
    .eq("service_request_id", id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Sem pagamento gravado (ou todos rejeitados) + SR travada em 'processing':
  // o MP não chegou a registrar ou já rejeitou. Destrava para nova tentativa.
  if (!pay?.mp_payment_id || pay.status === "rejected") {
    if (req.payment_status === "processing") {
      await adminDb.from("service_requests")
        .update({ payment_status: "rejected" })
        .eq("id", id);
      return c.json({ payment_status: "rejected" });
    }
    return c.json({ payment_status: req.payment_status });
  }

  const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${pay.mp_payment_id}`, {
    headers: { Authorization: `Bearer ${c.env.MERCADOPAGO_ACCESS_TOKEN}` },
  });
  if (!mpRes.ok) return c.json({ payment_status: req.payment_status });
  await resolveCardPaymentFinal(c.env, await mpRes.json());

  const { data: after } = await adminDb
    .from("service_requests").select("payment_status").eq("id", id).maybeSingle();
  return c.json({ payment_status: after?.payment_status ?? req.payment_status });
});

// ── F1: Cartões salvos (Mercado Pago) ─────────────────────────────────────────
// Persistimos só refs não sensíveis (PCI-DSS). Token é one-shot (tokenizado no
// device); PAN/CVV nunca chegam ao backend. Authz por dono em TODAS as rotas
// (deriva do JWT, nunca do body). saved_cards/app_users.mp_customer_id criados
// na migration 20260615_saved_cards.sql.

// Forma de resposta = SavedCard (packages/shared). Montado na mão p/ não acoplar.
function toSavedCard(r: any) {
  return {
    id: r.id as string,
    brand: (r.brand ?? null) as string | null,
    last4: r.last4 as string,
    expMonth: r.exp_month as number,
    expYear: r.exp_year as number,
    cardholderName: (r.cardholder_name ?? null) as string | null,
    isDefault: !!r.is_default,
  };
}
const SAVED_CARD_COLS = "id, brand, last4, exp_month, exp_year, cardholder_name, is_default";

// Resultado discriminado: a borda HTTP (POST /v1/cards) mapeia para status; o
// fluxo best-effort (create-card-payment) só loga em caso de falha.
type SaveCardResult =
  | { ok: true; card: ReturnType<typeof toSavedCard> }
  | { ok: false; status: number; message: string; code?: string };

// ensureMpCustomer — garante o customer 1:1 do usuário no MP (cria/recupera/grava).
async function ensureMpCustomer(
  env: Bindings,
  userId: string,
): Promise<{ ok: true; customerId: string } | { ok: false; status: number; message: string }> {
  if (!env.MERCADOPAGO_ACCESS_TOKEN) {
    return { ok: false, status: 503, message: "Integração com Mercado Pago não configurada." };
  }
  const adminDb = db(env);
  const auth = `Bearer ${env.MERCADOPAGO_ACCESS_TOKEN}`;

  const { data: user, error: uErr } = await adminDb
    .from("app_users").select("email, mp_customer_id").eq("id", userId).maybeSingle();
  if (uErr) return { ok: false, status: 500, message: uErr.message };
  if (!user) return { ok: false, status: 404, message: "Usuário não encontrado." };

  let customerId = (user.mp_customer_id ?? null) as string | null;
  if (customerId) return { ok: true, customerId };

  const custRes = await fetch("https://api.mercadopago.com/v1/customers", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: auth },
    body: JSON.stringify({ email: user.email }),
  });
  if (!custRes.ok) {
    const detail = await custRes.text();
    console.error("[cards] criar customer MP falhou", custRes.status, detail);
    // MP recusa email já cadastrado como customer → recupera o existente
    if (custRes.status === 409 || /already exist|customer.*exist/i.test(detail)) {
      const searchRes = await fetch(
        `https://api.mercadopago.com/v1/customers/search?email=${encodeURIComponent(user.email)}`,
        { headers: { Authorization: auth } },
      );
      if (searchRes.ok) {
        const sr = await searchRes.json() as { results?: Array<{ id: string }> };
        customerId = sr.results?.[0]?.id ?? null;
      }
    }
    if (!customerId) {
      return { ok: false, status: 503, message: "Falha ao registrar cliente no provedor de pagamento." };
    }
  } else {
    const cust = await custRes.json() as { id: string };
    customerId = cust.id;
  }
  await adminDb.from("app_users").update({ mp_customer_id: customerId }).eq("id", userId);
  return { ok: true, customerId };
}

// persistSavedCard — grava a ref não sensível de um cartão que JÁ existe no MP
// como cartão do customer (tratando o preferido). Usado pelo POST /v1/cards
// (cartão recém-criado via token) e pelo create-card-payment (cartão salvo
// durante a cobrança → vem de payment.card, sem reusar o token one-shot).
async function persistSavedCard(
  env: Bindings,
  userId: string,
  customerId: string,
  card: { mpCardId: string; brand: string | null; last4: string; expMonth: number; expYear: number; cardholderName: string | null },
  setDefault: boolean,
): Promise<SaveCardResult> {
  const adminDb = db(env);

  // 1º cartão sempre vira default.
  const { count } = await adminDb
    .from("saved_cards").select("id", { count: "exact", head: true }).eq("user_id", userId);
  const makeDefault = setDefault === true || (count ?? 0) === 0;

  // Insere SEM default primeiro: evita violar uq_saved_cards_default e evita
  // deixar o usuário sem preferido caso o insert caia no UNIQUE(user_id,mp_card_id).
  const { data: inserted, error: insErr } = await adminDb
    .from("saved_cards")
    .insert({
      user_id: userId,
      mp_customer_id: customerId,
      mp_card_id: card.mpCardId,
      brand: card.brand,
      last4: card.last4,
      exp_month: card.expMonth,
      exp_year: card.expYear,
      cardholder_name: card.cardholderName,
      is_default: false,
    })
    .select(SAVED_CARD_COLS)
    .maybeSingle();
  if (insErr) {
    if ((insErr as any).code === "23505") {
      return { ok: false, status: 409, message: "Este cartão já está salvo." };
    }
    console.error("[cards] insert falhou", userId, insErr.message);
    return { ok: false, status: 500, message: insErr.message };
  }
  if (!inserted) {
    return { ok: false, status: 500, message: "Falha ao salvar cartão." };
  }

  if (makeDefault) {
    // zera os demais antes de marcar este (índice parcial exige no máx. 1 true)
    await adminDb.from("saved_cards")
      .update({ is_default: false, updated_at: new Date().toISOString() })
      .eq("user_id", userId).neq("id", inserted.id).eq("is_default", true);
    await adminDb.from("saved_cards")
      .update({ is_default: true, updated_at: new Date().toISOString() })
      .eq("id", inserted.id);
    inserted.is_default = true;
  }

  return { ok: true, card: toSavedCard(inserted) };
}

// saveCardForUser — cria o cartão no MP a partir de um token (one-shot, NÃO
// consumido) e persiste a ref. Usado pelo POST /v1/cards (token fresco do device).
// Authz por dono é responsabilidade do CHAMADOR (userId deriva do JWT).
async function saveCardForUser(
  env: Bindings,
  userId: string,
  token: string,
  setDefault: boolean,
): Promise<SaveCardResult> {
  if (!env.MERCADOPAGO_ACCESS_TOKEN) {
    return { ok: false, status: 503, message: "Integração com Mercado Pago não configurada." };
  }
  const auth = `Bearer ${env.MERCADOPAGO_ACCESS_TOKEN}`;

  const cust = await ensureMpCustomer(env, userId);
  if (!cust.ok) return cust;

  const cardRes = await fetch(`https://api.mercadopago.com/v1/customers/${cust.customerId}/cards`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: auth },
    body: JSON.stringify({ token }),
  });
  if (!cardRes.ok) {
    const detail = await cardRes.text();
    console.error("[cards] salvar cartão MP falhou", cardRes.status, detail);
    if (cardRes.status >= 400 && cardRes.status < 500) {
      return {
        ok: false,
        status: 400,
        message: "Não foi possível validar o cartão. Verifique os dados e tente novamente.",
        code: "CARD_TOKEN_INVALID",
      };
    }
    return { ok: false, status: 503, message: "Provedor de pagamento indisponível. Tente novamente." };
  }
  const mpCard = await cardRes.json() as {
    id: string;
    last_four_digits: string;
    expiration_month: number;
    expiration_year: number;
    cardholder?: { name?: string };
    payment_method?: { id?: string };
  };

  return persistSavedCard(env, userId, cust.customerId, {
    mpCardId: mpCard.id,
    brand: mpCard.payment_method?.id ?? null,
    last4: mpCard.last_four_digits,
    expMonth: mpCard.expiration_month,
    expYear: mpCard.expiration_year,
    cardholderName: mpCard.cardholder?.name ?? null,
  }, setDefault);
}

// GET /v1/cards → cartões do usuário (preferido primeiro, depois mais recentes)
app.get("/v1/cards", async (c) => {
  const userId = c.get("userId");
  const { data, error } = await db(c.env)
    .from("saved_cards")
    .select(SAVED_CARD_COLS)
    .eq("user_id", userId)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) {
    console.error("[cards] erro ao listar", userId, error.message);
    return c.json({ message: error.message }, 500);
  }
  return c.json({ cards: (data ?? []).map(toSavedCard) });
});

// POST /v1/cards { token, setDefault? } → tokeniza no MP e persiste a ref
app.post("/v1/cards", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{ token?: string; setDefault?: boolean }>().catch(() => ({} as any));
  if (!body.token || typeof body.token !== "string") {
    return c.json({ message: "Campo obrigatório: token." }, 400);
  }

  const result = await saveCardForUser(c.env, userId, body.token, body.setDefault === true);
  if (!result.ok) {
    const payload: Record<string, unknown> = { message: result.message };
    if (result.code) payload.code = result.code;
    return c.json(payload, result.status as any);
  }
  return c.json({ card: result.card }, 201);
});

// DELETE /v1/cards/:id → confere dono, apaga no MP e remove; promove o + recente
app.delete("/v1/cards/:id", async (c) => {
  const userId = c.get("userId");
  const cardId = c.req.param("id");
  const adminDb = db(c.env);

  const { data: card } = await adminDb
    .from("saved_cards")
    .select("id, mp_customer_id, mp_card_id, is_default")
    .eq("id", cardId).eq("user_id", userId).maybeSingle();
  if (!card) return c.json({ message: "Cartão não encontrado." }, 404);

  if (c.env.MERCADOPAGO_ACCESS_TOKEN) {
    const delRes = await fetch(
      `https://api.mercadopago.com/v1/customers/${card.mp_customer_id}/cards/${card.mp_card_id}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${c.env.MERCADOPAGO_ACCESS_TOKEN}` } },
    );
    // 404 no MP = já não existe lá; seguimos para limpar a ref local.
    if (!delRes.ok && delRes.status !== 404) {
      const detail = await delRes.text();
      console.error("[cards] remover no MP falhou", delRes.status, detail);
      return c.json({ message: "Provedor de pagamento indisponível. Tente novamente." }, 503);
    }
  } else {
    // Sem MP configurado: ainda assim removemos a ref local (direito do dono, LGPD).
    console.warn("[cards] MP não configurado; removendo apenas a ref local", cardId);
  }

  const { error: delErr } = await adminDb.from("saved_cards").delete().eq("id", cardId).eq("user_id", userId);
  if (delErr) return c.json({ message: delErr.message }, 500);

  if (card.is_default) {
    const { data: next } = await adminDb
      .from("saved_cards")
      .select("id")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (next) {
      await adminDb.from("saved_cards")
        .update({ is_default: true, updated_at: new Date().toISOString() })
        .eq("id", next.id);
    }
  }

  return c.body(null, 204);
});

// PATCH /v1/cards/:id/default → confere dono; zera os demais e marca o alvo
app.patch("/v1/cards/:id/default", async (c) => {
  const userId = c.get("userId");
  const cardId = c.req.param("id");
  const adminDb = db(c.env);

  const { data: card } = await adminDb
    .from("saved_cards").select("id").eq("id", cardId).eq("user_id", userId).maybeSingle();
  if (!card) return c.json({ message: "Cartão não encontrado." }, 404);

  await adminDb.from("saved_cards")
    .update({ is_default: false, updated_at: new Date().toISOString() })
    .eq("user_id", userId).neq("id", cardId).eq("is_default", true);
  const { data: updated, error } = await adminDb
    .from("saved_cards")
    .update({ is_default: true, updated_at: new Date().toISOString() })
    .eq("id", cardId).eq("user_id", userId)
    .select(SAVED_CARD_COLS).maybeSingle();
  if (error) {
    console.error("[cards] set default falhou", userId, error.message);
    return c.json({ message: error.message }, 500);
  }
  return c.json({ card: toSavedCard(updated) });
});

// ── F2: Parcelas (consulta de payer_costs no MP) ──────────────────────────────
// GET /v1/service-requests/:id/installments?bin=123456
//   ou ?payment_method_id=visa  (cartão salvo só tem last4, não tem BIN)
// Valor lido da SR NO SERVIDOR (nunca do client). Só o cliente dono da SR.
app.get("/v1/service-requests/:id/installments", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const bin = c.req.query("bin");
  const paymentMethodId = c.req.query("payment_method_id");

  // Aceita bin OU payment_method_id; prefere bin quando ambos vierem.
  if (bin && !/^\d{6,8}$/.test(bin)) {
    return c.json({ message: "Parâmetro bin inválido (6 a 8 dígitos)." }, 400);
  }
  if (!bin && paymentMethodId && !/^[a-z0-9_-]{1,40}$/i.test(paymentMethodId)) {
    return c.json({ message: "Parâmetro payment_method_id inválido." }, 400);
  }
  if (!bin && !paymentMethodId) {
    return c.json({ message: "Informe bin ou payment_method_id." }, 400);
  }
  if (!c.env.MERCADOPAGO_ACCESS_TOKEN) {
    return c.json({ message: "Integração com Mercado Pago não configurada." }, 503);
  }

  const adminDb = db(c.env);
  const { data: sr } = await adminDb
    .from("service_requests").select("quote_amount, client_user_id").eq("id", id).maybeSingle();
  if (!sr) return c.json({ message: "Serviço não encontrado." }, 404);
  if (sr.client_user_id !== userId) return c.json({ message: "Não autorizado." }, 403);
  if (!sr.quote_amount || Number(sr.quote_amount) <= 0) {
    return c.json({ message: "Valor do serviço não definido." }, 400);
  }
  const amount = Number(sr.quote_amount);

  const selector = bin
    ? `&bin=${bin}`
    : `&payment_method_id=${encodeURIComponent(paymentMethodId as string)}`;
  const mpRes = await fetch(
    `https://api.mercadopago.com/v1/payment_methods/installments?amount=${amount}${selector}`,
    { headers: { Authorization: `Bearer ${c.env.MERCADOPAGO_ACCESS_TOKEN}` } },
  );
  if (!mpRes.ok) {
    const detail = await mpRes.text();
    console.error("[installments] consulta MP falhou", mpRes.status, detail);
    return c.json({ message: "Não foi possível consultar as parcelas. Tente novamente." }, 503);
  }
  const arr = await mpRes.json() as Array<{
    payment_method_id: string;
    issuer?: { id?: string | number };
    payer_costs?: Array<{ installments: number; installment_amount: number; total_amount: number; labels?: string[] }>;
  }>;
  const first = Array.isArray(arr) ? arr[0] : undefined;
  if (!first) return c.json({ message: "Nenhuma opção de parcelamento para este cartão." }, 404);

  // Forma de resposta = InstallmentsResponse (packages/shared)
  return c.json({
    paymentMethodId: first.payment_method_id,
    issuerId: first.issuer?.id != null ? String(first.issuer.id) : "",
    payerCosts: (first.payer_costs ?? []).map((pc) => ({
      installments: pc.installments,
      installmentAmount: pc.installment_amount,
      totalAmount: pc.total_amount,
      labels: pc.labels ?? [],
    })),
  });
});

// ── Webhook Mercado Pago (pagamento aprovado) ─────────────────────────────
app.post("/v1/webhooks/mercadopago", async (c) => {
  try {
    const rawBody = await c.req.text();
    let body: { type?: string; data?: { id?: string } };
    try { body = JSON.parse(rawBody); } catch { return c.json({ ok: true }); }

    // ── Verificação HMAC obrigatória ─────────────────────────────────────────
    // Se MERCADOPAGO_WEBHOOK_SECRET não estiver configurado, rejeitamos o webhook
    // para evitar processamento de eventos não autenticados.
    if (!c.env.MERCADOPAGO_WEBHOOK_SECRET) {
      console.error("[Webhook MP] MERCADOPAGO_WEBHOOK_SECRET não configurado — webhook rejeitado.");
      return c.json({ ok: false }, 500);
    }
    const xSignature = c.req.header("x-signature");
    const xRequestId = c.req.header("x-request-id");
    const isValid = await validateMPWebhookSignature(
      c.env.MERCADOPAGO_WEBHOOK_SECRET,
      xSignature,
      xRequestId,
      body.data?.id
    );
    if (!isValid) {
      console.warn("[Webhook MP] Assinatura inválida rejeitada.", { xSignature: xSignature?.slice(0, 30) });
      return c.json({ ok: false }, 400);
    }

    if (body.type !== "payment" || !body.data?.id) return c.json({ ok: true });
    if (!c.env.MERCADOPAGO_ACCESS_TOKEN) return c.json({ ok: true });

    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${body.data.id}`, {
      headers: { Authorization: `Bearer ${c.env.MERCADOPAGO_ACCESS_TOKEN}` },
    });
    if (!mpRes.ok) return c.json({ ok: true });

    const payment = await mpRes.json() as any;
    // Só agimos em estados FINAIS. in_process/pending aguardam o webhook final.
    if (payment.status !== "approved" && payment.status !== "rejected" && payment.status !== "cancelled") {
      return c.json({ ok: true });
    }

    const serviceRequestId = payment.external_reference;
    // Valida que external_reference é um UUID válido antes de qualquer operação no DB
    if (!serviceRequestId || !UUID_RE.test(serviceRequestId)) {
      console.warn("[Webhook MP] external_reference inválido ou ausente:", serviceRequestId);
      return c.json({ ok: true }); // retorna 200 para o MP não retentar
    }

    const adminDb = db(c.env);

    const { data: req } = await adminDb
      .from("service_requests")
      .select("client_user_id, provider_user_id, payment_status")
      .eq("id", serviceRequestId)
      .maybeSingle();

    if (!req || req.payment_status === "confirmed") return c.json({ ok: true });

    const webhookIp = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? "unknown";

    // Recusado/cancelado: se o pagamento estava EM PROCESSAMENTO, marca a SR como
    // recusada e notifica o cliente (permite nova tentativa). Não mexe se já foi
    // confirmada ou se há uma tentativa mais nova em curso.
    if (payment.status !== "approved") {
      if (req.payment_status === "processing") {
        await adminDb
          .from("service_requests")
          .update({ payment_status: "rejected", payment_method: "card" })
          .eq("id", serviceRequestId);
        await adminDb.from("payments")
          .update({ status: payment.status })
          .eq("mp_payment_id", String(payment.id));
        await logPaymentEvent(c.env, {
          event_type: "webhook_rejected",
          service_request_id: serviceRequestId,
          user_id: req.client_user_id ?? null,
          mp_payment_id: String(payment.id),
          status_before: "processing",
          status_after: "rejected",
          ip: webhookIp,
          metadata: { mp_status: payment.status, payment_type_id: payment.payment_type_id },
        });
        if (req.client_user_id) {
          await sendPush(c.env, req.client_user_id, "❌ Pagamento recusado", "Seu pagamento com cartão não foi aprovado. Tente outro cartão ou outra forma de pagamento.");
        }
      }
      return c.json({ ok: true });
    }

    // Deriva o método do próprio pagamento MP — NÃO forçar "pix", senão um
    // pagamento de cartão que confirme via webhook seria marcado como Pix.
    const mpType = String(payment.payment_type_id ?? "");
    const derivedMethod = mpType.includes("card") ? "card" : mpType ? "pix" : null;
    const srUpdate: Record<string, unknown> = { payment_status: "confirmed" };
    if (derivedMethod) srUpdate.payment_method = derivedMethod;

    await adminDb
      .from("service_requests")
      .update(srUpdate)
      .eq("id", serviceRequestId);

    // Atualizar registro de payment como aprovado e criar split para o prestador
    const { data: paymentRecord } = await adminDb
      .from("payments")
      .update({ status: "approved", confirmed_at: new Date().toISOString() })
      .eq("mp_payment_id", String(payment.id))
      .select("id, provider_amount, amount")
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

    await logPaymentEvent(c.env, {
      event_type: "webhook_approved",
      service_request_id: serviceRequestId,
      user_id: req.client_user_id ?? null,
      mp_payment_id: String(payment.id),
      amount: paymentRecord?.amount ?? null,
      status_before: req.payment_status,
      status_after: "confirmed",
      ip: webhookIp,
      metadata: { payment_type_id: payment.payment_type_id, derived_method: derivedMethod },
    });

    const methodLabel = derivedMethod === "card" ? "cartão" : "Pix";
    if (req.client_user_id) {
      await sendPush(c.env, req.client_user_id, "✅ Pagamento confirmado!", `Seu pagamento via ${methodLabel} foi aprovado automaticamente.`);
    }
    if (req.provider_user_id) {
      await sendPush(c.env, req.provider_user_id, "💳 Pagamento recebido!", `O pagamento via ${methodLabel} foi aprovado. O cliente será notificado.`);
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
    .select(`id, category, city, quote_amount, payment_status, payment_method, created_at, client_user_id, provider_user_id,
      app_users!service_requests_client_user_id_fkey(full_name),
      provider_profiles!service_requests_provider_user_id_fkey(full_name, business_name),
      payments(mp_payment_id, created_at)`)
    .in("payment_status", ["client_paid", "confirmed"])
    .order("created_at", { ascending: false })
    .limit(300);
  return c.json({ data: data ?? [] });
});

// ── Admin: estornar pagamento (janela de 3 dias, só cartão) ──────────────────
app.post("/v1/admin/payments/:requestId/refund", async (c) => {
  if (!isAdmin(c)) return c.json({ message: "Não autorizado." }, 401);
  const requestId = c.req.param("requestId");
  if (!c.env.MERCADOPAGO_ACCESS_TOKEN) return c.json({ message: "MP não configurado." }, 503);

  const adminDb = db(c.env);
  const { data: pay } = await adminDb
    .from("payments")
    .select("mp_payment_id, created_at, status")
    .eq("service_request_id", requestId)
    .eq("status", "approved")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!pay?.mp_payment_id) return c.json({ message: "Nenhum pagamento aprovado encontrado." }, 404);

  // Janela de 3 dias (72 h).
  const paidAt = new Date(pay.created_at).getTime();
  if (Date.now() - paidAt > 72 * 60 * 60 * 1000) {
    return c.json({ message: "Prazo de 3 dias para estorno expirado." }, 422);
  }

  const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${pay.mp_payment_id}/refunds`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${c.env.MERCADOPAGO_ACCESS_TOKEN}`,
    },
    body: "{}",
  });

  if (!mpRes.ok) {
    const err = await mpRes.text();
    console.error("[refund] MP retornou erro", mpRes.status, err);
    return c.json({ message: "Erro ao estornar no Mercado Pago." }, 502);
  }

  // Reverte o status da SR e do pagamento.
  await adminDb.from("service_requests")
    .update({ payment_status: "refunded" })
    .eq("id", requestId);
  await adminDb.from("payments")
    .update({ status: "refunded" })
    .eq("mp_payment_id", pay.mp_payment_id);

  // Notifica o cliente.
  const { data: sr } = await adminDb
    .from("service_requests").select("client_user_id").eq("id", requestId).maybeSingle();
  if (sr?.client_user_id) {
    await sendPush(c.env, sr.client_user_id, "💸 Estorno realizado", "O estorno do seu pagamento foi processado. O valor voltará em até 10 dias úteis.");
  }

  return c.json({ ok: true });
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

// ═══════════════════════════════════════════════════════════════════════════
// VERIFICAÇÃO DE IDENTIDADE (selfie + documento RG/CNH, revisão manual admin)
// ═══════════════════════════════════════════════════════════════════════════

function base64ToBytes(d: string): Uint8Array {
  const b64 = d.includes(",") ? d.split(",")[1] : d;
  return Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
}

// Submeter verificação (usuário autenticado)
app.post("/v1/verifications", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{
    doc_type: "rg" | "cnh";
    role?: "client" | "provider";
    selfie_data: string;
    document_data: string;
  }>().catch(() => ({} as any));

  if (body.doc_type !== "rg" && body.doc_type !== "cnh") {
    return c.json({ message: "doc_type deve ser 'rg' ou 'cnh'." }, 400);
  }
  if (!body.selfie_data || !body.document_data) {
    return c.json({ message: "selfie_data e document_data são obrigatórios." }, 400);
  }

  const adminDb = db(c.env);
  // Garante o bucket privado (idempotente)
  await adminDb.storage.createBucket("verifications", { public: false }).catch(() => {});

  const ts = Date.now();
  const selfiePath = `${userId}/selfie_${ts}.jpg`;
  const documentPath = `${userId}/document_${ts}.jpg`;

  const up1 = await adminDb.storage.from("verifications").upload(selfiePath, base64ToBytes(body.selfie_data), { contentType: "image/jpeg", upsert: true });
  if (up1.error) return c.json({ message: up1.error.message }, 400);
  const up2 = await adminDb.storage.from("verifications").upload(documentPath, base64ToBytes(body.document_data), { contentType: "image/jpeg", upsert: true });
  if (up2.error) return c.json({ message: up2.error.message }, 400);

  // Limpa pendências/reprovações anteriores do mesmo usuário (mantém só a nova)
  await adminDb.from("identity_verifications").delete().eq("user_id", userId).in("status", ["pending", "rejected"]);

  const { data, error } = await adminDb.from("identity_verifications").insert({
    user_id: userId,
    role: body.role === "provider" ? "provider" : "client",
    doc_type: body.doc_type,
    selfie_path: selfiePath,
    document_path: documentPath,
    status: "pending",
  }).select("id, status, created_at").single();

  if (error) return c.json({ message: error.message }, 400);

  await adminDb.from("app_users").update({ verification_status: "pending" }).eq("id", userId);
  return c.json({ verification: data, status: "pending" }, 201);
});

// Status da própria verificação
app.get("/v1/verifications/me", async (c) => {
  const userId = c.get("userId");
  const adminDb = db(c.env);
  const { data: u } = await adminDb.from("app_users").select("verification_status").eq("id", userId).maybeSingle();
  const { data: v } = await adminDb.from("identity_verifications")
    .select("id, doc_type, status, admin_note, created_at, reviewed_at")
    .eq("user_id", userId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  return c.json({ status: u?.verification_status ?? "unverified", verification: v ?? null });
});

// Admin: listar verificações (default: pendentes) com URLs assinadas
app.get("/v1/admin/verifications", async (c) => {
  if (!isAdmin(c)) return c.json({ message: "Não autorizado." }, 401);
  const status = c.req.query("status") ?? "pending";
  const adminDb = db(c.env);
  const { data, error } = await adminDb.from("identity_verifications")
    .select("id, user_id, role, doc_type, selfie_path, document_path, status, admin_note, created_at, reviewed_at, app_users!inner(full_name, email, phone)")
    .eq("status", status).order("created_at", { ascending: true }).limit(200);
  if (error) return c.json({ error: error.message }, 500);

  const rows = await Promise.all((data ?? []).map(async (v: any) => {
    const [s, d] = await Promise.all([
      adminDb.storage.from("verifications").createSignedUrl(v.selfie_path, 3600),
      adminDb.storage.from("verifications").createSignedUrl(v.document_path, 3600),
    ]);
    return {
      id: v.id, user_id: v.user_id, role: v.role, doc_type: v.doc_type, status: v.status,
      admin_note: v.admin_note, created_at: v.created_at, reviewed_at: v.reviewed_at,
      full_name: v.app_users?.full_name ?? "", email: v.app_users?.email ?? "", phone: v.app_users?.phone ?? "",
      selfie_url: s.data?.signedUrl ?? null, document_url: d.data?.signedUrl ?? null,
    };
  }));
  return c.json({ verifications: rows });
});

// Admin: aprovar/reprovar verificação
app.patch("/v1/admin/verifications/:id", async (c) => {
  if (!isAdmin(c)) return c.json({ message: "Não autorizado." }, 401);
  const id = c.req.param("id");
  const body = await c.req.json<{ action: "approve" | "reject"; note?: string }>().catch(() => ({} as any));
  if (body.action !== "approve" && body.action !== "reject") {
    return c.json({ message: 'action inválida. Use "approve" ou "reject".' }, 400);
  }
  const adminDb = db(c.env);
  const { data: v } = await adminDb.from("identity_verifications").select("id, user_id, status").eq("id", id).maybeSingle();
  if (!v) return c.json({ message: "Verificação não encontrada." }, 404);

  const newStatus = body.action === "approve" ? "approved" : "rejected";
  const { error } = await adminDb.from("identity_verifications").update({
    status: newStatus, admin_note: body.note ?? null, reviewed_at: new Date().toISOString(),
  }).eq("id", id);
  if (error) return c.json({ message: error.message }, 400);

  await adminDb.from("app_users").update({ verification_status: newStatus }).eq("id", v.user_id);

  if (body.action === "approve") {
    await sendPush(c.env, v.user_id, "✅ Identidade verificada!", "Sua identidade foi aprovada. Você já pode usar o app normalmente.");
  } else {
    await sendPush(c.env, v.user_id, "❌ Verificação reprovada", body.note ? `Motivo: ${body.note}. Reenvie seus documentos.` : "Reenvie seus documentos para tentar novamente.");
  }
  return c.json({ status: newStatus });
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
  const biddingFlag = await c.env.FEATURE_FLAGS.get("provider_bidding", "json") as { enabled: boolean } | null;
  if (biddingFlag != null && !biddingFlag.enabled) {
    return c.json({ message: "Sistema de lances desabilitado." }, 503);
  }

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

  // Prepara a SR para o pagamento: define prestador, valor e quote_status='quoted'.
  // NÃO muda status para 'accepted' — isso só ocorre após a captura do pagamento
  // via create-card-payment, que também notifica o prestador para ir ao local.
  const { error } = await db(c.env)
    .from("service_requests")
    .update({
      provider_user_id: bid.provider_user_id,
      quote_amount: bid.amount,
      quote_status: "quoted",
    })
    .eq("id", requestId);

  if (error) return c.json({ message: error.message }, 400);

  return c.json({ message: "Lance selecionado. Aguardando pagamento do cliente." });
});

// ── US-012: Cálculo de saldo (compartilhado entre /balance e /withdrawal) ──────
// IMPORTANTE: /balance e /withdrawal DEVEM usar exatamente o mesmo cálculo,
// senão o app exibe um saldo (ex.: R$ 14.011) mas o saque rejeita com
// "Saldo insuficiente: R$ 0,00".
async function computeProviderBalance(
  adminDb: ReturnType<typeof db>,
  providerId: string,
): Promise<{ available: number; pending: number; blocked: number }> {
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

  // Saques que reservam saldo: solicitados (bloqueados) + em processamento +
  // concluídos. Reprovados/cancelados ficam de fora → o valor volta ao saldo.
  const { data: withdrawn } = await adminDb
    .from("provider_withdrawals")
    .select("amount, status")
    .eq("provider_user_id", providerId)
    .in("status", ["requested", "processing", "completed"]);

  const totalReserved = (withdrawn ?? []).reduce((s: number, r: any) => s + Number(r.amount), 0);
  // "Bloqueado" = saques ainda não concluídos (aguardando aprovação/processamento).
  const blocked = (withdrawn ?? [])
    .filter((r: any) => r.status === "requested" || r.status === "processing")
    .reduce((s: number, r: any) => s + Number(r.amount), 0);

  const totalEarned = totalFromSplits + totalFromOldPayments;
  const available = Math.max(0, totalEarned - totalReserved);

  return { available, pending: pendingFromSplits, blocked };
}

// ── US-012: Saldo disponível do prestador ─────────────────────────────────────
app.get("/v1/providers/:id/balance", async (c) => {
  const providerId = c.req.param("id");
  const userId = c.get("userId");
  if (userId !== providerId) return c.json({ message: "Não autorizado." }, 403);

  const { available, pending, blocked } = await computeProviderBalance(db(c.env), providerId);
  return c.json({ available, pending, blocked });
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

// ── Cancelar saque (prestador) ────────────────────────────────────────────────
// Só é possível cancelar enquanto o saque está "requested" (ainda não
// processado). Ao cancelar, o registro é removido e o valor volta ao saldo.
app.delete("/v1/providers/:id/withdrawal/:wid", async (c) => {
  const providerId = c.req.param("id");
  const wid = c.req.param("wid");
  const userId = c.get("userId");
  if (userId !== providerId) return c.json({ message: "Não autorizado." }, 403);

  const adminDb = db(c.env);
  const { data: w } = await adminDb
    .from("provider_withdrawals")
    .select("id, status")
    .eq("id", wid)
    .eq("provider_user_id", providerId)
    .maybeSingle();

  if (!w) return c.json({ message: "Saque não encontrado." }, 404);
  if (w.status !== "requested") {
    return c.json({ message: "Só é possível cancelar um saque ainda não processado." }, 400);
  }

  const { error } = await adminDb
    .from("provider_withdrawals")
    .delete()
    .eq("id", wid)
    .eq("provider_user_id", providerId)
    .eq("status", "requested");

  if (error) return c.json({ message: error.message }, 400);
  return c.json({ message: "Saque cancelado. O valor voltou ao seu saldo." });
});

// ── Aprovar/Reprovar saque (admin) ────────────────────────────────────────────
// approve → status "completed" (valor debitado do total).
// reject  → status "rejected" (valor volta ao saldo disponível).
app.patch("/v1/admin/withdrawals/:wid", async (c) => {
  if (!isAdmin(c)) return c.json({ message: "Não autorizado." }, 401);
  const wid = c.req.param("wid");
  const body = await c.req.json<{ action: "approve" | "reject" }>().catch(() => ({} as any));
  if (body.action !== "approve" && body.action !== "reject") {
    return c.json({ message: 'action inválida. Use "approve" ou "reject".' }, 400);
  }

  const adminDb = db(c.env);
  const { data: w } = await adminDb
    .from("provider_withdrawals")
    .select("id, status, amount, provider_user_id")
    .eq("id", wid)
    .maybeSingle();

  if (!w) return c.json({ message: "Saque não encontrado." }, 404);
  if (w.status !== "requested" && w.status !== "processing") {
    return c.json({ message: "Este saque já foi finalizado." }, 400);
  }

  const newStatus = body.action === "approve" ? "completed" : "rejected";
  const { data, error } = await adminDb
    .from("provider_withdrawals")
    .update({ status: newStatus, processed_at: new Date().toISOString() })
    .eq("id", wid)
    .select("id, amount, pix_key, status, created_at, processed_at")
    .single();

  if (error) return c.json({ message: error.message }, 400);

  const amountStr = `R$ ${Number(w.amount).toFixed(2).replace(".", ",")}`;
  if (body.action === "approve") {
    await sendPush(c.env, w.provider_user_id, "✅ Saque aprovado!", `Seu saque de ${amountStr} foi aprovado e o valor foi debitado do seu saldo.`);
  } else {
    await sendPush(c.env, w.provider_user_id, "❌ Saque reprovado", `Seu saque de ${amountStr} foi reprovado. O valor voltou ao seu saldo disponível.`);
  }

  return c.json({ withdrawal: data });
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

// Planos pagos descontinuados — todos os prestadores operam no plano básico.
app.post("/v1/providers/:id/subscription", async (c) => {
  return c.json({ message: "Planos pagos descontinuados. Todos os prestadores operam no plano básico (10% de comissão)." }, 410);
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

// ═══════════════════════════════════════════════════════════════════════════
// ── Propagandas — Banners externos (Fatia 2) ─────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

async function isFlagEnabled(kv: KVNamespace, key: string, defaultValue = false): Promise<boolean> {
  const stored = await kv.get(key, "json") as { enabled: boolean } | null;
  return stored != null ? stored.enabled : defaultValue;
}

app.get("/v1/ads/banners", async (c) => {
  const adsEnabled = await isFlagEnabled(c.env.FEATURE_FLAGS, "ads_enabled");
  if (!adsEnabled) return c.json({ data: [] });

  const placement = c.req.query("placement") ?? "home";
  const target = c.req.query("target") ?? "client";
  const now = new Date().toISOString();

  const { data, error } = await db(c.env)
    .from("ads")
    .select("id, title, advertiser_name, image_url, link_url, target, placement, priority")
    .eq("active", true)
    .in("target", [target, "both"])
    .eq("placement", placement)
    .or(`starts_at.is.null,starts_at.lte.${now}`)
    .or(`ends_at.is.null,ends_at.gte.${now}`)
    .order("priority", { ascending: false });

  if (error) return c.json({ message: error.message }, 500);
  return c.json({ data: data ?? [] });
});

app.get("/v1/ads/sponsored-providers", async (c) => {
  const adsEnabled = await isFlagEnabled(c.env.FEATURE_FLAGS, "ads_enabled");
  if (!adsEnabled) return c.json({ data: [] });

  const category = c.req.query("category");
  const city = c.req.query("city");
  const now = new Date().toISOString();

  let query = db(c.env)
    .from("sponsored_providers")
    .select("id, provider_id, categories, cities, priority")
    .eq("active", true)
    .or(`starts_at.is.null,starts_at.lte.${now}`)
    .or(`ends_at.is.null,ends_at.gte.${now}`)
    .order("priority", { ascending: false })
    .limit(2);

  if (category) query = query.contains("categories", [category]);
  if (city) query = query.contains("cities", [city]);

  const { data, error } = await query;
  if (error) return c.json({ message: error.message }, 500);
  return c.json({ data: data ?? [] });
});

// ── Propagandas — Admin CRUD Banners (Fatia 4) ───────────────────────────────

app.get("/v1/admin/crm/mkt/banners", async (c) => {
  if (!isAdmin(c)) return c.json({ message: "Não autorizado." }, 401);
  const { data, error } = await db(c.env)
    .from("ads")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return c.json({ message: error.message }, 500);
  return c.json({ items: data ?? [] });
});

app.post("/v1/admin/crm/mkt/banners", async (c) => {
  if (!isAdmin(c)) return c.json({ message: "Não autorizado." }, 401);
  const b = await c.req.json<{
    title: string; advertiser_name?: string; image_url: string; link_url?: string;
    target?: string; placement?: string; active?: boolean;
    starts_at?: string; ends_at?: string; priority?: number; cost_per_click?: number;
  }>();
  if (!b.title || !b.image_url) return c.json({ message: "title e image_url são obrigatórios." }, 400);
  if (!b.image_url.startsWith("https://")) return c.json({ message: "image_url deve começar com https://." }, 400);
  if (b.cost_per_click !== undefined && Number(b.cost_per_click) < 0) return c.json({ message: "cost_per_click não pode ser negativo." }, 400);
  const row = {
    title: b.title,
    advertiser_name: b.advertiser_name ?? "",
    image_url: b.image_url,
    link_url: b.link_url ?? null,
    target: b.target ?? "both",
    placement: b.placement ?? "home",
    active: b.active ?? false,
    starts_at: b.starts_at ?? null,
    ends_at: b.ends_at ?? null,
    priority: b.priority ?? 0,
    cost_per_click: b.cost_per_click ?? 0,
  };
  const { data, error } = await db(c.env).from("ads").insert(row).select("*").maybeSingle();
  if (error) return c.json({ message: error.message }, 500);
  return c.json({ item: data }, 201);
});

// IMPORTANTE: registrado antes de /:id para que "export-csv" não seja
// interpretado como um parâmetro de ID pelo roteador do Hono.
app.get("/v1/admin/crm/mkt/banners/export-csv", async (c) => {
  if (!isAdmin(c)) return c.json({ message: "Não autorizado." }, 401);

  const { data, error } = await db(c.env)
    .from("ads")
    .select("id, title, advertiser_name, placement, target, active, clicks_total, cost_per_click, starts_at, ends_at, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[banners/export-csv] erro ao buscar banners:", error.message);
    return c.json({ message: error.message }, 500);
  }

  // RFC 4180 — campos com vírgula, aspas ou quebra de linha são escapados
  const escape = (v: unknown): string => {
    const s = String(v ?? "");
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const header = "id,title,advertiser_name,placement,target,active,clicks_total,cost_per_click,total_cost,starts_at,ends_at,created_at";
  const rows = (data ?? []).map(b => [
    escape(b.id),
    escape(b.title),
    escape(b.advertiser_name),
    escape(b.placement),
    escape(b.target),
    escape(b.active),
    escape(b.clicks_total ?? 0),
    escape(b.cost_per_click ?? 0),
    escape(((b.clicks_total ?? 0) * (b.cost_per_click ?? 0)).toFixed(2)),
    escape(b.starts_at),
    escape(b.ends_at),
    escape(b.created_at),
  ].join(",")).join("\n");

  const csv = `${header}\n${rows}`;
  const date = new Date().toISOString().split("T")[0];

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="banners-export-${date}.csv"`,
    },
  });
});

app.get("/v1/admin/crm/mkt/banners/:id", async (c) => {
  if (!isAdmin(c)) return c.json({ message: "Não autorizado." }, 401);
  const { data, error } = await db(c.env).from("ads").select("*").eq("id", c.req.param("id")).maybeSingle();
  if (error) return c.json({ message: error.message }, 500);
  if (!data) return c.json({ message: "Não encontrado." }, 404);
  return c.json({ item: data });
});

async function handleBannerPatch(c: any) {
  if (!isAdmin(c)) return c.json({ message: "Não autorizado." }, 401);
  const b = await c.req.json() as Record<string, any>;
  const allowed = ["title", "advertiser_name", "image_url", "link_url", "target", "placement", "active", "starts_at", "ends_at", "priority", "cost_per_click"];
  const patch: Record<string, any> = {};
  for (const k of allowed) if (b[k] !== undefined) patch[k] = b[k];
  if (patch.image_url && !String(patch.image_url).startsWith("https://")) return c.json({ message: "image_url deve começar com https://." }, 400);
  if (patch.cost_per_click !== undefined && Number(patch.cost_per_click) < 0) {
    return c.json({ message: "cost_per_click não pode ser negativo." }, 400);
  }
  const { data, error } = await db(c.env).from("ads").update(patch).eq("id", c.req.param("id")).select("*").maybeSingle();
  if (error) return c.json({ message: error.message }, 500);
  if (!data) return c.json({ message: "Não encontrado." }, 404);
  return c.json({ item: data });
}
app.put("/v1/admin/crm/mkt/banners/:id", handleBannerPatch);
app.patch("/v1/admin/crm/mkt/banners/:id", handleBannerPatch);

app.delete("/v1/admin/crm/mkt/banners/:id", async (c) => {
  if (!isAdmin(c)) return c.json({ message: "Não autorizado." }, 401);
  const { error } = await db(c.env).from("ads").delete().eq("id", c.req.param("id"));
  if (error) return c.json({ message: error.message }, 500);
  return c.json({ ok: true });
});

// ── Propagandas — Admin CRUD Patrocinados (Fatia 4 cont.) ────────────────────

app.get("/v1/admin/crm/mkt/sponsored", async (c) => {
  if (!isAdmin(c)) return c.json({ message: "Não autorizado." }, 401);
  const { data, error } = await db(c.env)
    .from("sponsored_providers")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return c.json({ message: error.message }, 500);
  return c.json({ items: data ?? [] });
});

app.post("/v1/admin/crm/mkt/sponsored", async (c) => {
  if (!isAdmin(c)) return c.json({ message: "Não autorizado." }, 401);
  const b = await c.req.json<{
    provider_id: string; categories?: string[]; cities?: string[];
    active?: boolean; starts_at?: string; ends_at?: string; priority?: number; notes?: string;
  }>();
  if (!b.provider_id) return c.json({ message: "provider_id é obrigatório." }, 400);

  // Impede dois registros ativos para o mesmo prestador
  if (b.active) {
    const { data: existing } = await db(c.env)
      .from("sponsored_providers").select("id").eq("provider_id", b.provider_id).eq("active", true).maybeSingle();
    if (existing) return c.json({ message: "Este prestador já tem um patrocínio ativo." }, 409);
  }

  const row = {
    provider_id: b.provider_id,
    categories: b.categories ?? [],
    cities: b.cities ?? [],
    active: b.active ?? false,
    starts_at: b.starts_at ?? null,
    ends_at: b.ends_at ?? null,
    priority: b.priority ?? 0,
    notes: b.notes ?? "",
  };
  const { data, error } = await db(c.env).from("sponsored_providers").insert(row).select("*").maybeSingle();
  if (error) return c.json({ message: error.message }, 500);
  return c.json({ item: data }, 201);
});

app.get("/v1/admin/crm/mkt/sponsored/:id", async (c) => {
  if (!isAdmin(c)) return c.json({ message: "Não autorizado." }, 401);
  const { data, error } = await db(c.env).from("sponsored_providers").select("*").eq("id", c.req.param("id")).maybeSingle();
  if (error) return c.json({ message: error.message }, 500);
  if (!data) return c.json({ message: "Não encontrado." }, 404);
  return c.json({ item: data });
});

async function handleSponsoredPatch(c: any) {
  if (!isAdmin(c)) return c.json({ message: "Não autorizado." }, 401);
  const b = await c.req.json() as Record<string, any>;
  const allowed = ["categories", "cities", "active", "starts_at", "ends_at", "priority", "notes"];
  const patch: Record<string, any> = {};
  for (const k of allowed) if (b[k] !== undefined) patch[k] = b[k];

  if (patch.active === true && b.provider_id) {
    const { data: existing } = await db(c.env)
      .from("sponsored_providers").select("id").eq("provider_id", b.provider_id).eq("active", true)
      .neq("id", c.req.param("id")).maybeSingle();
    if (existing) return c.json({ message: "Este prestador já tem um patrocínio ativo." }, 409);
  }

  const { data, error } = await db(c.env).from("sponsored_providers").update(patch).eq("id", c.req.param("id")).select("*").maybeSingle();
  if (error) return c.json({ message: error.message }, 500);
  if (!data) return c.json({ message: "Não encontrado." }, 404);
  return c.json({ item: data });
}
app.put("/v1/admin/crm/mkt/sponsored/:id", handleSponsoredPatch);
app.patch("/v1/admin/crm/mkt/sponsored/:id", handleSponsoredPatch);

app.delete("/v1/admin/crm/mkt/sponsored/:id", async (c) => {
  if (!isAdmin(c)) return c.json({ message: "Não autorizado." }, 401);
  const { error } = await db(c.env).from("sponsored_providers").delete().eq("id", c.req.param("id"));
  if (error) return c.json({ message: error.message }, 500);
  return c.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════════════
// ── Telemedicina — App endpoints (Fatia 3) ────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

app.get("/v1/telemedicine/config", async (c) => {
  const telemedicineEnabled = await isFlagEnabled(c.env.FEATURE_FLAGS, "telemedicine");
  if (!telemedicineEnabled) return c.json({ message: "Feature não disponível." }, 503);

  const userId = c.get("userId");
  const adminDb = db(c.env);

  const { data: config } = await adminDb
    .from("telemedicine_config")
    .select("partner_name, partner_description, is_active, access_url")
    .limit(1)
    .maybeSingle();

  if (!config || !config.is_active) return c.json({ message: "Serviço indisponível." }, 503);

  const { data: user } = await adminDb
    .from("app_users")
    .select("verification_status")
    .eq("id", userId)
    .maybeSingle();

  const verified = user?.verification_status === "approved";

  return c.json({
    partner_name: config.partner_name,
    partner_description: config.partner_description,
    is_active: config.is_active,
    access_url: verified ? config.access_url : undefined,
    verified,
  });
});

app.post("/v1/telemedicine/access-log", async (c) => {
  const telemedicineEnabled = await isFlagEnabled(c.env.FEATURE_FLAGS, "telemedicine");
  if (!telemedicineEnabled) return c.json({ message: "Feature não disponível." }, 503);

  const userId = c.get("userId");
  const adminDb = db(c.env);

  const { data: user } = await adminDb
    .from("app_users")
    .select("verification_status")
    .eq("id", userId)
    .maybeSingle();

  if (user?.verification_status !== "approved") return c.json({ message: "Acesso restrito a usuários verificados." }, 403);

  const { user_role } = await c.req.json<{ user_role?: string }>();
  if (!user_role || !["client", "provider"].includes(user_role)) {
    return c.json({ message: "user_role deve ser 'client' ou 'provider'." }, 400);
  }

  const { error } = await adminDb.from("telemedicine_access_log").insert({
    user_id: userId,
    user_role,
    accessed_at: new Date().toISOString(),
  });

  if (error) return c.json({ message: error.message }, 500);
  return c.json({ ok: true });
});

// ── Telemedicina — Admin endpoints (Fatia 5) ─────────────────────────────────

app.get("/v1/admin/telemedicine/config", async (c) => {
  if (!isAdmin(c)) return c.json({ message: "Não autorizado." }, 401);
  const { data, error } = await db(c.env)
    .from("telemedicine_config")
    .select("*")
    .limit(1)
    .maybeSingle();
  if (error) return c.json({ message: error.message }, 500);
  return c.json({ item: data ?? null });
});

app.put("/v1/admin/telemedicine/config", async (c) => {
  if (!isAdmin(c)) return c.json({ message: "Não autorizado." }, 401);
  const b = await c.req.json<{
    partner_name?: string; partner_description?: string;
    access_url?: string; is_active?: boolean;
  }>();
  if (b.access_url && !b.access_url.startsWith("https://") && !b.access_url.startsWith("http://")) {
    return c.json({ message: "access_url deve ser uma URL válida." }, 400);
  }

  const adminDb = db(c.env);
  const { data: existing } = await adminDb.from("telemedicine_config").select("id").limit(1).maybeSingle();

  let data, error;
  if (existing) {
    const patch: Record<string, any> = {};
    if (b.partner_name !== undefined) patch.partner_name = b.partner_name;
    if (b.partner_description !== undefined) patch.partner_description = b.partner_description;
    if (b.access_url !== undefined) patch.access_url = b.access_url;
    if (b.is_active !== undefined) patch.is_active = b.is_active;
    patch.updated_at = new Date().toISOString();
    ({ data, error } = await adminDb.from("telemedicine_config").update(patch).eq("id", existing.id).select("*").maybeSingle());
  } else {
    const row = {
      partner_name: b.partner_name ?? "",
      partner_description: b.partner_description ?? "",
      access_url: b.access_url ?? "",
      is_active: b.is_active ?? false,
    };
    ({ data, error } = await adminDb.from("telemedicine_config").insert(row).select("*").maybeSingle());
  }

  if (error) return c.json({ message: error.message }, 500);
  return c.json({ item: data });
});

app.get("/v1/admin/telemedicine/report", async (c) => {
  if (!isAdmin(c)) return c.json({ message: "Não autorizado." }, 401);
  const { data, error } = await db(c.env)
    .from("telemedicine_access_log")
    .select("user_role, accessed_at")
    .order("accessed_at", { ascending: false })
    .limit(5000);
  if (error) return c.json({ message: error.message }, 500);

  // Agrupa por dia e role
  const map = new Map<string, { client: number; provider: number }>();
  for (const row of data ?? []) {
    const dia = row.accessed_at.slice(0, 10);
    const entry = map.get(dia) ?? { client: 0, provider: 0 };
    if (row.user_role === "client") entry.client++;
    else entry.provider++;
    map.set(dia, entry);
  }

  const report = [...map.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 90)
    .flatMap(([dia, counts]) => [
      { dia, user_role: "client" as const, count: counts.client },
      { dia, user_role: "provider" as const, count: counts.provider },
    ])
    .filter((r) => r.count > 0);

  const total = (data ?? []).length;
  const today = new Date().toISOString().slice(0, 10);
  const todayTotal = (data ?? []).filter((r) => r.accessed_at.startsWith(today)).length;

  return c.json({ report, total, today: todayTotal });
});

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
