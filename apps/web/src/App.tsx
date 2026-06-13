import { useState, useEffect, useCallback, useRef } from "react";
import { VendasModule } from "./crm/modules/Vendas";
import { MarketingModule } from "./crm/modules/Marketing";
import { TeleMedicinaModule } from "./crm/modules/Telemedicina";
import { FinanceiroModule } from "./crm/modules/Financeiro";
import { RelatoriosModule } from "./crm/modules/Relatorios";
import { JuridicoModule } from "./crm/modules/Juridico";
import { FornecedoresModule } from "./crm/modules/Fornecedores";
import { RHModule } from "./crm/modules/RH";
import { SuporteModule } from "./crm/modules/Suporte";
import { AgendaModule } from "./crm/modules/Agenda";
import { AcessoModule } from "./crm/modules/Acesso";
import { AuditoriaModule } from "./crm/modules/Auditoria";

const API = import.meta.env.VITE_API_URL ?? "https://construconnect-api.orionsystem.workers.dev";

type Page =
  | "dashboard" | "requests" | "providers" | "users" | "payments" | "complaints" | "flags" | "verifications"
  | "vendas" | "marketing" | "financeiro" | "relatorios"
  | "juridico" | "rh" | "fornecedores" | "suporte" | "agenda"
  | "acesso" | "auditoria"
  | "telemedicina";

// Mapeia cada página para a "área" de permissão correspondente.
const PAGE_AREA: Record<Page, string> = {
  dashboard: "operacao", requests: "operacao", providers: "operacao", users: "operacao",
  payments: "operacao", complaints: "operacao", flags: "operacao", verifications: "operacao",
  vendas: "vendas", marketing: "marketing", financeiro: "financeiro", relatorios: "relatorios", telemedicina: "marketing",
  juridico: "juridico", rh: "rh", fornecedores: "fornecedores", suporte: "suporte", agenda: "agenda",
  acesso: "__master__",
  auditoria: "__master__",
};

interface Overview {
  totalUsers: number;
  totalProviders: number;
  activeRequests: number;
  completedJobs: number;
  totalRevenue: number;
  pendingRevenue: number;
  blockedProviders: number;
  newUsers: number;
  openComplaints: number;
  onlineProviders: number;
  onlineClients: number;
  sla: { onTime: number; warning: number; critical: number };
  complaintsByStatus?: { open: number; investigating: number; resolved: number; dismissed: number };
}

interface AdminRequest {
  id: string;
  category: string;
  description: string;
  status: string;
  city: string;
  quote_amount: number | null;
  payment_status: string | null;
  payment_method: string | null;
  client_rating: number | null;
  created_at: string;
  app_users?: { full_name: string; phone: string } | null;
  provider_profiles?: any;
}

interface AdminProvider {
  user_id: string;
  verified: boolean;
  blocked_until: string | null;
  status: string;
  last_seen_at: string | null;
  average_rating: number | null;
  completed_jobs: number;
  app_users?: any;
}

interface AdminUser {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  city: string;
  role: string;
  created_at: string;
  blocked_until: string | null;
}

interface AdminPayment {
  id: string;
  category: string;
  quote_amount: number | null;
  payment_status: string;
  payment_method: string | null;
  created_at: string;
  app_users?: { full_name: string } | null;
  provider_profiles?: any;
  payments?: Array<{ mp_payment_id: string | null; created_at: string }> | null;
}

interface FormalComplaint {
  id: string;
  reason: string;
  description: string;
  status: string;
  admin_note?: string | null;
  created_at: string;
  request_id: string;
  client_user_id: string;
  provider_user_id: string | null;
  client: { full_name: string; phone: string; email: string; city: string } | null;
  provider: { full_name: string; phone: string; email: string; city: string } | null;
  request: {
    id: string;
    category: string;
    description: string;
    city: string;
    quote_amount: number | null;
    scheduled_date: string | null;
    status: string;
    payment_status: string | null;
  } | null;
}

interface Complaints {
  formal: FormalComplaint[];
  lowRated: AdminRequest[];
  cancelled: AdminRequest[];
}

function browserNotify(title: string, body: string) {
  if (!("Notification" in window)) return;
  if (Notification.permission === "granted") {
    new Notification(title, { body, icon: "/favicon.ico" });
  }
}

function useAdminNotifications(adminKey: string, onBadge: (page: Page, count: number) => void) {
  const prev = useRef({ openComplaints: 0, pendingPayments: 0, activeRequests: 0 });
  const initialized = useRef(false);

  useEffect(() => {
    if (!adminKey) return;

    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }

    async function poll() {
      try {
        const r = await apiFetch("/v1/admin/overview", adminKey);
        if (!r.ok) return;
        const data = await r.json() as Overview;

        const newComplaints = (data.openComplaints ?? 0) - prev.current.openComplaints;
        const newPayments = data.activeRequests - prev.current.activeRequests;

        if (initialized.current) {
          if (newComplaints > 0) {
            browserNotify(
              "⚠️ Nova reclamação",
              `${newComplaints} nova(s) reclamação(ões) aberta(s) aguardando análise.`
            );
            onBadge("complaints", data.openComplaints ?? 0);
          }
          if (newPayments > 0) {
            browserNotify(
              "📋 Novos chamados",
              `${newPayments} novo(s) chamado(s) ativo(s) na plataforma.`
            );
            onBadge("requests", data.activeRequests);
          }
        }

        prev.current = {
          openComplaints: data.openComplaints ?? 0,
          pendingPayments: data.pendingRevenue ?? 0,
          activeRequests: data.activeRequests ?? 0,
        };
        initialized.current = true;
      } catch {}
    }

    poll();
    const id = setInterval(poll, 30000);
    return () => clearInterval(id);
  }, [adminKey]);
}

function apiFetch(path: string, key: string, init?: RequestInit) {
  return fetch(`${API}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-admin-key": key,
      ...((init?.headers as Record<string, string>) ?? {}),
    },
  });
}

function slaInfo(createdAt: string, status: string): { text: string; color: string } {
  if (status === "resolved" || status === "dismissed") return { text: "—", color: "var(--text-secondary)" };
  const ageMs = Date.now() - new Date(createdAt).getTime();
  const H24 = 24 * 60 * 60 * 1000;
  const H72 = 72 * 60 * 60 * 1000;
  const hours = Math.floor(ageMs / (60 * 60 * 1000));
  if (ageMs < H24) return { text: `${hours}h`, color: "#27ae60" };
  if (ageMs < H72) return { text: `${hours}h`, color: "#f59e0b" };
  const days = Math.floor(ageMs / (24 * 60 * 60 * 1000));
  return { text: `${days}d`, color: "#e74c3c" };
}

function fmt(n: number | null | undefined, currency = false): string {
  if (n == null) return "—";
  return currency ? `R$ ${n.toFixed(2).replace(".", ",")}` : String(n);
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("pt-BR");
}

function getProviderName(providerProfiles: any): string {
  if (!providerProfiles) return "—";
  const pp = Array.isArray(providerProfiles) ? providerProfiles[0] : providerProfiles;
  if (!pp) return "—";
  const u = Array.isArray(pp.app_users) ? pp.app_users[0] : pp.app_users;
  return u?.full_name ?? "—";
}

function getUserInfo(raw: any): { name: string; email: string; city: string; phone: string; created_at: string } {
  const u = Array.isArray(raw?.app_users) ? raw.app_users[0] : raw?.app_users;
  return {
    name: u?.full_name ?? "—",
    email: u?.email ?? "—",
    city: u?.city ?? "—",
    phone: u?.phone ?? "—",
    created_at: u?.created_at ?? "",
  };
}

function stars(n: number | null): string {
  if (!n) return "—";
  return "⭐".repeat(Math.min(n, 5));
}

const STATUS_LABEL: Record<string, string> = {
  requested: "Aguardando",
  accepted: "Aceito",
  in_progress: "Em andamento",
  completed: "Concluído",
  cancelled: "Cancelado",
  draft: "Rascunho",
};
const STATUS_COLOR: Record<string, string> = {
  requested: "badge-warning",
  accepted: "badge-info",
  in_progress: "badge-info",
  completed: "badge-success",
  cancelled: "badge-danger",
  draft: "badge-muted",
};
const PAY_LABEL: Record<string, string> = {
  client_paid: "Aguard. confirmação",
  confirmed: "Confirmado",
};
const PAY_COLOR: Record<string, string> = {
  client_paid: "badge-warning",
  confirmed: "badge-success",
};
const METHOD_LABEL: Record<string, string> = {
  pix: "Pix",
  cash: "Dinheiro",
  card: "Cartão",
};
const ROLE_LABEL: Record<string, string> = {
  client: "Cliente",
  builder: "Pedreiro",
  contractor: "Empreiteiro",
};
const PROV_STATUS_LABEL: Record<string, string> = {
  available: "Disponível",
  busy: "Ocupado",
  offline: "Offline",
};
const PROV_STATUS_COLOR: Record<string, string> = {
  available: "badge-success",
  busy: "badge-warning",
  offline: "badge-muted",
};

// ── Dashboard ─────────────────────────────────────────────────────────────────
function DashboardPage({ adminKey, onNavigate }: { adminKey: string; onNavigate: (p: Page) => void }) {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    apiFetch("/v1/admin/overview", adminKey)
      .then((r) => r.json())
      .then((d: Overview) => { setData(d); setLoading(false); })
      .catch(() => { if (!silent) { setError("Erro ao carregar dados."); setLoading(false); } });
  }, [adminKey]);

  useEffect(() => {
    refresh();
    const poll = setInterval(() => refresh(true), 30000);
    return () => clearInterval(poll);
  }, [refresh]);

  if (loading) return <div className="loading">Carregando...</div>;
  if (error) return <div className="error-msg">{error}</div>;
  if (!data) return null;

  const cards: { label: string; value: string | number; icon: string; color: string; page?: Page }[] = [
    { label: "Clientes online", value: data.onlineClients ?? 0, icon: "🟢", color: "green", page: "users" },
    { label: "Prestadores online", value: data.onlineProviders ?? 0, icon: "🟢", color: "green", page: "providers" },
    { label: "Usuários", value: data.totalUsers, icon: "👥", color: "blue", page: "users" },
    { label: "Prestadores", value: data.totalProviders, icon: "👷", color: "blue", page: "providers" },
    { label: "Chamados ativos", value: data.activeRequests, icon: "📋", color: "orange", page: "requests" },
    { label: "Serviços concluídos", value: data.completedJobs, icon: "✅", color: "green", page: "requests" },
    { label: "Receita total", value: fmt(data.totalRevenue, true), icon: "💰", color: "green", page: "payments" },
    { label: "Receita pendente", value: fmt(data.pendingRevenue, true), icon: "⏳", color: "orange", page: "payments" },
    { label: "Prestadores bloqueados", value: data.blockedProviders, icon: "🚫", color: "red", page: "providers" },
    { label: "Novos usuários (7d)", value: data.newUsers, icon: "🆕", color: "blue", page: "users" },
    { label: "Reclamações abertas", value: data.openComplaints ?? 0, icon: "⚠️", color: "red", page: "complaints" },
  ];

  const sla = data.sla ?? { onTime: 0, warning: 0, critical: 0 };
  const slaTotal = sla.onTime + sla.warning + sla.critical;
  const slaBorderColor = sla.critical > 0 ? "#e74c3c" : sla.warning > 0 ? "#f59e0b" : "#27ae60";
  const slaRows = [
    { label: "No prazo (< 24h)", count: sla.onTime, color: "#27ae60" },
    { label: "Atenção (24–72h)", count: sla.warning, color: "#f59e0b" },
    { label: "Crítico (> 72h)", count: sla.critical, color: "#e74c3c" },
  ];

  const cbs = data.complaintsByStatus ?? { open: 0, investigating: 0, resolved: 0, dismissed: 0 };
  const cbsTotal = cbs.open + cbs.investigating + cbs.resolved + cbs.dismissed;
  const cbsRows = [
    { label: "Abertas",     count: cbs.open,         color: "#e74c3c" },
    { label: "Em análise",  count: cbs.investigating, color: "#f59e0b" },
    { label: "Resolvidas",  count: cbs.resolved,      color: "#27ae60" },
    { label: "Arquivadas",  count: cbs.dismissed,     color: "#94a3b8" },
  ];

  return (
    <div>
      <h2 className="page-title">Dashboard</h2>
      <div className="stats-grid">
        {cards.map((c) => (
          <div
            className={`stat-card stat-${c.color}`}
            key={c.label}
            style={c.page ? { cursor: "pointer" } : undefined}
            onClick={c.page ? () => onNavigate(c.page!) : undefined}
          >
            <span className="stat-icon">{c.icon}</span>
            <div>
              <p className="stat-label">{c.label}</p>
              <strong className="stat-value">{c.value}</strong>
            </div>
          </div>
        ))}
      </div>

      {/* SLA Widget */}
      <div style={{
        marginTop: 24,
        border: `2px solid ${slaBorderColor}`,
        borderRadius: 12,
        padding: "20px 24px",
        background: "var(--card)",
      }}>
        <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 700, color: "var(--text)" }}>
          ⏱ SLA — Tempo de Resolução de Reclamações
        </h3>
        {slaTotal === 0 ? (
          <p style={{ color: "var(--text-secondary)", fontSize: 13, margin: 0 }}>
            Nenhuma reclamação aberta ou em análise.
          </p>
        ) : (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {slaRows.map((row) => (
                <div key={row.label} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ width: 10, height: 10, borderRadius: "50%", background: row.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 13, color: "var(--text)", minWidth: 160 }}>{row.label}</span>
                  <span style={{ fontSize: 18, fontWeight: 700, color: row.color, minWidth: 30, textAlign: "right" }}>
                    {row.count}
                  </span>
                  <div style={{ flex: 1, height: 8, background: "var(--border)", borderRadius: 4, overflow: "hidden" }}>
                    <div style={{
                      width: `${(row.count / slaTotal) * 100}%`,
                      height: "100%",
                      background: row.color,
                      borderRadius: 4,
                      transition: "width 0.4s ease",
                    }} />
                  </div>
                  <span style={{ fontSize: 12, color: "var(--text-secondary)", minWidth: 36, textAlign: "right" }}>
                    {slaTotal > 0 ? Math.round((row.count / slaTotal) * 100) : 0}%
                  </span>
                </div>
              ))}
            </div>
            <p style={{ marginTop: 12, fontSize: 12, color: "var(--text-secondary)", margin: "12px 0 0" }}>
              Total em aberto/análise: <strong style={{ color: "var(--text)" }}>{slaTotal}</strong>
              {sla.critical > 0 && (
                <span style={{ marginLeft: 12, color: "#e74c3c", fontWeight: 600 }}>
                  ⚠ {sla.critical} em estado crítico — ação necessária
                </span>
              )}
            </p>
          </>
        )}
      </div>

      {/* Reclamações por status */}
      <div style={{
        marginTop: 16,
        border: "1.5px solid var(--border)",
        borderRadius: 12,
        padding: "20px 24px",
        background: "var(--card)",
      }}>
        <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 700, color: "var(--text)", display: "flex", alignItems: "center", gap: 8 }}>
          📊 Reclamações por Status
          <span style={{ marginLeft: "auto", fontSize: 13, fontWeight: 400, color: "var(--text-secondary)" }}>
            Total: <strong style={{ color: "var(--text)" }}>{cbsTotal}</strong>
          </span>
        </h3>
        {cbsTotal === 0 ? (
          <p style={{ color: "var(--text-secondary)", fontSize: 13, margin: 0 }}>Nenhuma reclamação registrada.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {cbsRows.map((row) => (
              <div key={row.label} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 10, height: 10, borderRadius: "50%", background: row.color, flexShrink: 0 }} />
                <span style={{ fontSize: 13, color: "var(--text)", minWidth: 100 }}>{row.label}</span>
                <span style={{ fontSize: 18, fontWeight: 700, color: row.color, minWidth: 30, textAlign: "right" }}>
                  {row.count}
                </span>
                <div style={{ flex: 1, height: 8, background: "var(--border)", borderRadius: 4, overflow: "hidden" }}>
                  <div style={{
                    width: cbsTotal > 0 ? `${(row.count / cbsTotal) * 100}%` : "0%",
                    height: "100%",
                    background: row.color,
                    borderRadius: 4,
                    transition: "width 0.4s ease",
                  }} />
                </div>
                <span style={{ fontSize: 12, color: "var(--text-secondary)", minWidth: 36, textAlign: "right" }}>
                  {cbsTotal > 0 ? Math.round((row.count / cbsTotal) * 100) : 0}%
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Requests ──────────────────────────────────────────────────────────────────
function RequestsPage({ adminKey }: { adminKey: string }) {
  const [rows, setRows] = useState<AdminRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    const qs = filter !== "all" ? `?status=${filter}` : "";
    apiFetch(`/v1/admin/requests${qs}`, adminKey)
      .then((r) => r.json())
      .then((d) => { setRows(d.data ?? []); setLoading(false); })
      .catch(() => { setError("Erro ao carregar pedidos."); setLoading(false); });
  }, [adminKey, filter]);

  const filters = [
    { key: "all", label: "Todos" },
    { key: "requested", label: "Aguardando" },
    { key: "accepted", label: "Aceitos" },
    { key: "in_progress", label: "Em andamento" },
    { key: "completed", label: "Concluídos" },
    { key: "cancelled", label: "Cancelados" },
  ];

  return (
    <div>
      <h2 className="page-title">Pedidos</h2>
      <div className="filter-bar">
        {filters.map((f) => (
          <button
            key={f.key}
            className={`filter-btn${filter === f.key ? " active" : ""}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>
      {loading ? (
        <div className="loading">Carregando...</div>
      ) : error ? (
        <div className="error-msg">{error}</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Categoria</th>
                <th>Cliente</th>
                <th>Prestador</th>
                <th>Cidade</th>
                <th>Status</th>
                <th>Pagamento</th>
                <th>Valor</th>
                <th>Nota</th>
                <th>Data</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <strong>{r.category}</strong>
                    <span className="muted-sm block">
                      {r.description?.slice(0, 45)}{r.description?.length > 45 ? "…" : ""}
                    </span>
                  </td>
                  <td>{r.app_users?.full_name ?? "—"}</td>
                  <td>{getProviderName(r.provider_profiles)}</td>
                  <td>{r.city}</td>
                  <td>
                    <span className={`badge ${STATUS_COLOR[r.status] ?? "badge-muted"}`}>
                      {STATUS_LABEL[r.status] ?? r.status}
                    </span>
                  </td>
                  <td>
                    {r.payment_status ? (
                      <span className={`badge ${PAY_COLOR[r.payment_status] ?? "badge-muted"}`}>
                        {PAY_LABEL[r.payment_status] ?? r.payment_status}
                      </span>
                    ) : "—"}
                    {r.payment_method && (
                      <span className="muted-sm block">
                        {METHOD_LABEL[r.payment_method] ?? r.payment_method}
                      </span>
                    )}
                  </td>
                  <td>{fmt(r.quote_amount, true)}</td>
                  <td>{stars(r.client_rating)}</td>
                  <td>{fmtDate(r.created_at)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={9} className="empty-row">Nenhum pedido encontrado.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Providers ─────────────────────────────────────────────────────────────────
function ProvidersPage({ adminKey }: { adminKey: string }) {
  const [rows, setRows] = useState<AdminProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [blockTarget, setBlockTarget] = useState<string | null>(null);
  const [blockDate, setBlockDate] = useState("");
  const [actionMsg, setActionMsg] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    apiFetch("/v1/admin/providers", adminKey)
      .then((r) => r.json())
      .then((d) => { setRows(d.data ?? []); setLoading(false); })
      .catch(() => { setError("Erro ao carregar prestadores."); setLoading(false); });
  }, [adminKey]);

  useEffect(() => { load(); }, [load]);

  async function verify(id: string) {
    try {
      const r = await apiFetch(`/v1/admin/providers/${id}/verify`, adminKey, { method: "PATCH" });
      if (!r.ok) { const j = await r.json() as any; throw new Error(j?.message ?? "Erro"); }
      setActionMsg("Prestador verificado com sucesso!");
      load();
    } catch (e: any) { setActionMsg(`Erro: ${e.message}`); }
  }

  async function block(id: string) {
    if (!blockDate) return;
    try {
      const r = await apiFetch(`/v1/admin/providers/${id}/block`, adminKey, {
        method: "PATCH",
        body: JSON.stringify({ until: blockDate }),
      });
      const json = await r.json() as any;
      if (!r.ok) throw new Error(json?.message ?? "Erro ao bloquear.");
      setBlockTarget(null);
      setBlockDate("");
      setActionMsg("Prestador bloqueado com sucesso.");
      load();
    } catch (e: any) { setActionMsg(`Erro: ${e.message}`); }
  }

  async function unblock(id: string) {
    try {
      const r = await apiFetch(`/v1/admin/providers/${id}/unblock`, adminKey, { method: "PATCH" });
      const json = await r.json() as any;
      if (!r.ok) throw new Error(json?.message ?? "Erro ao desbloquear.");
      setActionMsg("Prestador desbloqueado com sucesso.");
      load();
    } catch (e: any) { setActionMsg(`Erro: ${e.message}`); }
  }

  const todayStr = new Date().toISOString().split("T")[0];

  return (
    <div>
      <h2 className="page-title">Prestadores</h2>
      {actionMsg && (
        <div className="toast" onClick={() => setActionMsg("")}>
          {actionMsg} <span style={{ marginLeft: 8, opacity: 0.6 }}>✕</span>
        </div>
      )}
      {loading ? (
        <div className="loading">Carregando...</div>
      ) : error ? (
        <div className="error-msg">{error}</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nome</th>
                <th>Email</th>
                <th>Cidade</th>
                <th>Status</th>
                <th>Último acesso</th>
                <th>Avaliação</th>
                <th>Serviços</th>
                <th>Verificado</th>
                <th>Bloqueado até</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const u = getUserInfo(p);
                const isBlocked = p.blocked_until != null && new Date(p.blocked_until) > new Date();
                const lastSeenLabel = (() => {
                  if (!p.last_seen_at) return "—";
                  const d = new Date(p.last_seen_at);
                  const diffMin = Math.floor((Date.now() - d.getTime()) / 60000);
                  if (diffMin < 3) return "Agora";
                  if (diffMin < 60) return `Há ${diffMin} min`;
                  const today = new Date();
                  const isToday = d.toDateString() === today.toDateString();
                  const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
                  return isToday ? `Hoje ${time}` : `${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} ${time}`;
                })();
                const isReallyOnline = p.last_seen_at != null && (Date.now() - new Date(p.last_seen_at).getTime()) < 3 * 60 * 1000;
                return (
                  <tr key={p.user_id}>
                    <td>
                      <strong>{u.name}</strong>
                      <span className="muted-sm block">{u.phone}</span>
                    </td>
                    <td className="muted-sm">{u.email}</td>
                    <td>{u.city}</td>
                    <td>
                      <span className={`badge ${isReallyOnline ? "badge-success" : "badge-muted"}`}>
                        {isReallyOnline ? "Online" : (PROV_STATUS_LABEL[p.status] ?? p.status)}
                      </span>
                    </td>
                    <td className="muted-sm">{lastSeenLabel}</td>
                    <td>⭐ {p.average_rating != null ? Number(p.average_rating).toFixed(1) : "—"}</td>
                    <td>{p.completed_jobs}</td>
                    <td>
                      {p.verified
                        ? <span className="badge badge-success">Sim</span>
                        : <span className="badge badge-muted">Não</span>
                      }
                    </td>
                    <td>{isBlocked ? fmtDate(p.blocked_until!) : "—"}</td>
                    <td>
                      <div className="action-row">
                        {!p.verified && (
                          <button className="btn-sm btn-blue" onClick={() => verify(p.user_id)}>
                            Verificar
                          </button>
                        )}
                        <button className="btn-sm btn-danger" onClick={() => setBlockTarget(p.user_id)}>
                          Bloquear
                        </button>
                        {isBlocked && (
                          <button className="btn-sm btn-green" onClick={() => unblock(p.user_id)}>
                            Desbloquear
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={10} className="empty-row">Nenhum prestador encontrado.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {blockTarget && (
        <div className="modal-overlay" onClick={() => setBlockTarget(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Bloquear prestador</h3>
            <p>Selecione até quando o prestador ficará bloqueado:</p>
            <input
              type="date"
              value={blockDate}
              min={todayStr}
              onChange={(e) => setBlockDate(e.target.value)}
            />
            <div className="modal-actions">
              <button className="btn-sm btn-muted" onClick={() => setBlockTarget(null)}>
                Cancelar
              </button>
              <button className="btn-sm btn-danger" onClick={() => block(blockTarget)}>
                Confirmar bloqueio
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Users ─────────────────────────────────────────────────────────────────────
function UsersPage({ adminKey }: { adminKey: string }) {
  const [rows, setRows] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [blockTarget, setBlockTarget] = useState<string | null>(null);
  const [blockDate, setBlockDate] = useState("");
  const [actionMsg, setActionMsg] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    apiFetch("/v1/admin/users", adminKey)
      .then((r) => r.json())
      .then((d) => { setRows(d.data ?? []); setLoading(false); })
      .catch(() => { setError("Erro ao carregar usuários."); setLoading(false); });
  }, [adminKey]);

  useEffect(() => { load(); }, [load]);

  async function block(id: string) {
    if (!blockDate) return;
    try {
      const r = await apiFetch(`/v1/admin/users/${id}/block`, adminKey, {
        method: "PATCH",
        body: JSON.stringify({ until: blockDate }),
      });
      const json = await r.json() as any;
      if (!r.ok) throw new Error(json?.message ?? "Erro ao bloquear.");
      setBlockTarget(null);
      setBlockDate("");
      setActionMsg("Usuário bloqueado com sucesso.");
      load();
    } catch (e: any) { setActionMsg(`Erro: ${e.message}`); }
  }

  async function unblock(id: string) {
    try {
      const r = await apiFetch(`/v1/admin/users/${id}/unblock`, adminKey, { method: "PATCH" });
      const json = await r.json() as any;
      if (!r.ok) throw new Error(json?.message ?? "Erro ao desbloquear.");
      setActionMsg("Usuário desbloqueado com sucesso.");
      load();
    } catch (e: any) { setActionMsg(`Erro: ${e.message}`); }
  }

  const todayStr = new Date().toISOString().split("T")[0];

  const filtered = rows.filter((u) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return u.full_name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q);
  });

  return (
    <div>
      <h2 className="page-title">Usuários</h2>
      {actionMsg && (
        <div className="toast" onClick={() => setActionMsg("")}>
          {actionMsg} <span style={{ marginLeft: 8, opacity: 0.6 }}>✕</span>
        </div>
      )}
      <div className="filter-bar">
        <input
          className="search-input"
          placeholder="Buscar por nome ou email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      {loading ? (
        <div className="loading">Carregando...</div>
      ) : error ? (
        <div className="error-msg">{error}</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nome</th>
                <th>Email</th>
                <th>Telefone</th>
                <th>Cidade</th>
                <th>Perfil</th>
                <th>Cadastrado em</th>
                <th>Bloqueado até</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => {
                const isBlocked = u.blocked_until != null && new Date(u.blocked_until) > new Date();
                return (
                  <tr key={u.id}>
                    <td><strong>{u.full_name}</strong></td>
                    <td className="muted-sm">{u.email}</td>
                    <td>{u.phone}</td>
                    <td>{u.city}</td>
                    <td>
                      <span className={`badge ${u.role === "client" ? "badge-info" : "badge-warning"}`}>
                        {ROLE_LABEL[u.role] ?? u.role}
                      </span>
                    </td>
                    <td>{fmtDate(u.created_at)}</td>
                    <td>
                      {isBlocked
                        ? <span className="badge badge-danger">{fmtDate(u.blocked_until!)}</span>
                        : <span className="muted-sm">—</span>}
                    </td>
                    <td>
                      <div className="action-row">
                        <button className="btn-sm btn-danger" onClick={() => setBlockTarget(u.id)}>
                          Bloquear
                        </button>
                        {isBlocked && (
                          <button className="btn-sm btn-green" onClick={() => unblock(u.id)}>
                            Desbloquear
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={8} className="empty-row">Nenhum usuário encontrado.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {blockTarget && (
        <div className="modal-overlay" onClick={() => setBlockTarget(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Bloquear usuário</h3>
            <p>Selecione até quando o usuário ficará bloqueado:</p>
            <input
              type="date"
              value={blockDate}
              min={todayStr}
              onChange={(e) => setBlockDate(e.target.value)}
            />
            <div className="modal-actions">
              <button className="btn-sm btn-muted" onClick={() => setBlockTarget(null)}>
                Cancelar
              </button>
              <button className="btn-sm btn-danger" onClick={() => block(blockTarget)}>
                Confirmar bloqueio
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Payments ──────────────────────────────────────────────────────────────────
function PaymentsPage({ adminKey }: { adminKey: string }) {
  const [rows, setRows] = useState<AdminPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refunding, setRefunding] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    apiFetch("/v1/admin/payments", adminKey)
      .then((r) => r.json())
      .then((d) => { setRows(d.data ?? []); setLoading(false); })
      .catch(() => { setError("Erro ao carregar pagamentos."); setLoading(false); });
  }, [adminKey]);

  async function handleRefund(requestId: string) {
    if (!confirm("Confirma o estorno deste pagamento? O valor será devolvido ao cliente em até 10 dias úteis.")) return;
    setRefunding(requestId);
    try {
      const res = await apiFetch(`/v1/admin/payments/${requestId}/refund`, adminKey, { method: "POST" });
      if (res.ok) {
        setRows((prev) => prev.map((r) => r.id === requestId ? { ...r, payment_status: "refunded" } : r));
        alert("Estorno realizado com sucesso.");
      } else {
        const d = await res.json() as { message?: string };
        alert(d.message ?? "Erro ao estornar.");
      }
    } catch {
      alert("Erro de rede ao estornar.");
    } finally {
      setRefunding(null);
    }
  }

  const totalConfirmed = rows
    .filter((r) => r.payment_status === "confirmed")
    .reduce((s, r) => s + (r.quote_amount ?? 0), 0);

  const totalPending = rows
    .filter((r) => r.payment_status === "client_paid")
    .reduce((s, r) => s + (r.quote_amount ?? 0), 0);

  return (
    <div>
      <h2 className="page-title">Pagamentos</h2>
      {!loading && !error && (
        <div className="summary-row">
          <div className="summary-card success">
            <span>Receita confirmada</span>
            <strong>{fmt(totalConfirmed, true)}</strong>
          </div>
          <div className="summary-card warning">
            <span>Aguardando confirmação</span>
            <strong>{fmt(totalPending, true)}</strong>
          </div>
          <div className="summary-card info">
            <span>Total de transações</span>
            <strong>{rows.length}</strong>
          </div>
        </div>
      )}
      {loading ? (
        <div className="loading">Carregando...</div>
      ) : error ? (
        <div className="error-msg">{error}</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Data</th>
                <th>Categoria</th>
                <th>Cliente</th>
                <th>Prestador</th>
                <th>Valor</th>
                <th>Método</th>
                <th>Status</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{fmtDate(r.created_at)}</td>
                  <td>{r.category}</td>
                  <td>{r.app_users?.full_name ?? "—"}</td>
                  <td>{getProviderName(r.provider_profiles)}</td>
                  <td><strong>{fmt(r.quote_amount, true)}</strong></td>
                  <td>{METHOD_LABEL[r.payment_method ?? ""] ?? "—"}</td>
                  <td>
                    <span className={`badge ${PAY_COLOR[r.payment_status] ?? "badge-muted"}`}>
                      {PAY_LABEL[r.payment_status] ?? r.payment_status}
                    </span>
                  </td>
                  <td>
                    {r.payment_status === "confirmed" && (() => {
                      const payAt = r.payments?.[0]?.created_at ?? r.created_at;
                      const within3Days = Date.now() - new Date(payAt).getTime() < 72 * 60 * 60 * 1000;
                      return within3Days ? (
                        <button
                          className="btn-sm btn-danger"
                          disabled={refunding === r.id}
                          onClick={() => handleRefund(r.id)}
                        >
                          {refunding === r.id ? "Estornando..." : "Estornar"}
                        </button>
                      ) : <span className="text-muted" style={{ fontSize: 12 }}>Prazo expirado</span>;
                    })()}
                    {r.payment_status === "refunded" && (
                      <span className="badge badge-muted">Estornado</span>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={7} className="empty-row">Nenhum pagamento encontrado.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Complaints ────────────────────────────────────────────────────────────────
const COMPLAINT_STATUS_LABEL: Record<string, string> = {
  open: "Aberta",
  investigating: "Em análise",
  resolved: "Resolvida",
  dismissed: "Arquivada",
};
const COMPLAINT_STATUS_COLOR: Record<string, string> = {
  open: "badge-red",
  investigating: "badge-amber",
  resolved: "badge-green",
  dismissed: "badge-muted",
};

function whatsappLink(phone: string) {
  const digits = phone.replace(/\D/g, "");
  const number = digits.startsWith("55") ? digits : `55${digits}`;
  return `https://wa.me/${number}`;
}

function ComplaintsPage({ adminKey }: { adminKey: string }) {
  const [data, setData] = useState<Complaints | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<FormalComplaint | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [adminNote, setAdminNote] = useState("");
  const [actionMsg, setActionMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [actioning, setActioning] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    apiFetch("/v1/admin/complaints", adminKey)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => { setError("Erro ao carregar reclamações."); setLoading(false); });
  }, [adminKey]);

  useEffect(() => { load(); }, [load]);

  function showMsg(text: string, ok: boolean) {
    setActionMsg({ text, ok });
    setTimeout(() => setActionMsg(null), 3500);
  }

  async function blockClient(userId: string) {
    setActioning(true);
    try {
      const r = await apiFetch(`/v1/admin/users/${userId}/block`, adminKey, { method: "PATCH" });
      const json = await r.json() as any;
      if (!r.ok) throw new Error(json?.message ?? "Erro ao bloquear.");
      showMsg("Cliente bloqueado com sucesso.", true);
    } catch (e: any) {
      showMsg(e.message ?? "Erro ao bloquear cliente.", false);
    } finally {
      setActioning(false);
    }
  }

  async function unblockClient(userId: string) {
    setActioning(true);
    try {
      const r = await apiFetch(`/v1/admin/users/${userId}/unblock`, adminKey, { method: "PATCH" });
      const json = await r.json() as any;
      if (!r.ok) throw new Error(json?.message ?? "Erro ao desbloquear.");
      showMsg("Cliente desbloqueado com sucesso.", true);
    } catch (e: any) {
      showMsg(e.message ?? "Erro ao desbloquear cliente.", false);
    } finally {
      setActioning(false);
    }
  }

  async function blockProvider(providerId: string) {
    setActioning(true);
    try {
      const r = await apiFetch(`/v1/admin/providers/${providerId}/block`, adminKey, {
        method: "PATCH",
        body: JSON.stringify({ days: 30 }),
      });
      const json = await r.json() as any;
      if (!r.ok) throw new Error(json?.message ?? "Erro ao bloquear.");
      showMsg("Prestador bloqueado por 30 dias.", true);
    } catch (e: any) {
      showMsg(e.message ?? "Erro ao bloquear prestador.", false);
    } finally {
      setActioning(false);
    }
  }

  async function unblockProvider(providerId: string) {
    setActioning(true);
    try {
      const r = await apiFetch(`/v1/admin/providers/${providerId}/unblock`, adminKey, { method: "PATCH" });
      const json = await r.json() as any;
      if (!r.ok) throw new Error(json?.message ?? "Erro ao desbloquear.");
      showMsg("Prestador desbloqueado com sucesso.", true);
    } catch (e: any) {
      showMsg(e.message ?? "Erro ao desbloquear prestador.", false);
    } finally {
      setActioning(false);
    }
  }

  async function updateStatus(id: string, status: string) {
    setUpdatingId(id);
    try {
      const body: Record<string, string> = { status };
      if (adminNote.trim()) body.admin_note = adminNote.trim();
      const r = await apiFetch(`/v1/admin/complaints/${id}/status`, adminKey, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      const json = await r.json() as any;
      if (!r.ok) throw new Error(json?.message ?? "Erro ao atualizar.");
      if (selected?.id === id) setSelected((s) => s ? { ...s, status } : s);
      setAdminNote("");
      showMsg("Status atualizado. Solicitante notificado por push.", true);
      load();
    } catch (e: any) {
      showMsg(e.message ?? "Erro ao atualizar status.", false);
    } finally {
      setUpdatingId(null);
    }
  }

  if (loading) return <div className="loading">Carregando...</div>;
  if (error) return <div className="error-msg">{error}</div>;
  if (!data) return null;

  function ReqTable({ rows, label }: { rows: AdminRequest[]; label: string }) {
    return (
      <section className="complaint-section">
        <h3>{label}<span className="count-badge">{rows.length}</span></h3>
        {rows.length === 0 ? <p className="empty-msg">Nenhum registro.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr>
                <th>Categoria</th><th>Cliente</th><th>Prestador</th>
                <th>Cidade</th><th>Nota</th><th>Status</th><th>Data</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td><strong>{r.category}</strong><span className="muted-sm block">{r.description?.slice(0, 50)}{(r.description?.length ?? 0) > 50 ? "…" : ""}</span></td>
                    <td>{r.app_users?.full_name ?? "—"}</td>
                    <td>{getProviderName(r.provider_profiles)}</td>
                    <td>{r.city}</td>
                    <td>{stars(r.client_rating)}</td>
                    <td><span className={`badge ${STATUS_COLOR[r.status] ?? "badge-muted"}`}>{STATUS_LABEL[r.status] ?? r.status}</span></td>
                    <td>{fmtDate(r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    );
  }

  return (
    <div>
      <h2 className="page-title">Reclamações</h2>

      {/* Formal complaints */}
      <section className="complaint-section">
        <h3>📋 Reclamações formais<span className="count-badge">{data.formal.length}</span></h3>
        {data.formal.length === 0 ? <p className="empty-msg">Nenhuma reclamação formal.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr>
                <th>Motivo</th><th>Cliente</th><th>Prestador</th>
                <th>Cidade</th><th>Valor</th><th>Status</th><th>Tempo</th><th>Data</th><th></th>
              </tr></thead>
              <tbody>
                {data.formal.map((f) => {
                  const sla = slaInfo(f.created_at, f.status);
                  return (
                  <tr key={f.id}>
                    <td><strong>{f.reason}</strong><span className="muted-sm block">{f.description.slice(0, 45)}{f.description.length > 45 ? "…" : ""}</span></td>
                    <td>{f.client?.full_name ?? "—"}</td>
                    <td>{f.provider?.full_name ?? "—"}</td>
                    <td>{f.request?.city ?? "—"}</td>
                    <td>{f.request?.quote_amount ? `R$ ${Number(f.request.quote_amount).toFixed(2)}` : "—"}</td>
                    <td><span className={`badge ${COMPLAINT_STATUS_COLOR[f.status] ?? "badge-muted"}`}>{COMPLAINT_STATUS_LABEL[f.status] ?? f.status}</span></td>
                    <td>
                      <span style={{ fontWeight: 700, fontSize: 13, color: sla.color }}>{sla.text}</span>
                    </td>
                    <td>{fmtDate(f.created_at)}</td>
                    <td><button className="action-btn" onClick={() => setSelected(f)}>Ver detalhes</button></td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <ReqTable rows={data.lowRated} label="⭐ Avaliações baixas (≤ 2 estrelas)" />
      <ReqTable rows={data.cancelled} label="❌ Chamados cancelados" />

      {/* Detail modal */}
      {selected && (
        <div className="modal-overlay" onClick={() => { setSelected(null); setAdminNote(""); }}>
          <div className="modal-box complaint-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Reclamação — {selected.reason}</h3>
              <button className="modal-close" onClick={() => { setSelected(null); setAdminNote(""); }}>✕</button>
            </div>

            {actionMsg && (
              <div style={{
                margin: "0 0 12px",
                padding: "10px 14px",
                borderRadius: 8,
                background: actionMsg.ok ? "#d4edda" : "#f8d7da",
                color: actionMsg.ok ? "#155724" : "#721c24",
                fontSize: 14,
              }}>
                {actionMsg.text}
              </div>
            )}

            <div className="complaint-detail-grid">
              {/* Status */}
              <div className="detail-card full-width">
                <div className="detail-card-title">Status da reclamação</div>
                <div className="complaint-status-row">
                  <span className={`badge ${COMPLAINT_STATUS_COLOR[selected.status] ?? "badge-muted"}`}>
                    {COMPLAINT_STATUS_LABEL[selected.status] ?? selected.status}
                  </span>
                  <div className="status-actions">
                    {["open","investigating","resolved","dismissed"].map((s) => (
                      <button
                        key={s}
                        className={`status-btn ${selected.status === s ? "active" : ""}`}
                        disabled={selected.status === s || updatingId === selected.id || selected.status === "resolved"}
                        onClick={() => updateStatus(selected.id, s)}
                        title={selected.status === "resolved" ? "Reclamações resolvidas não podem ser reabertas" : undefined}
                      >
                        {updatingId === selected.id && selected.status !== s ? "..." : COMPLAINT_STATUS_LABEL[s]}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{ marginTop: 12 }}>
                  <label style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)", display: "block", marginBottom: 6 }}>
                    Observação para o solicitante (opcional)
                  </label>
                  <textarea
                    rows={2}
                    placeholder="Ex: Entramos em contato com o prestador. Aguarde retorno em até 48h."
                    value={adminNote}
                    onChange={(e) => setAdminNote(e.target.value)}
                    style={{
                      width: "100%", padding: "8px 10px", borderRadius: 8,
                      border: "1px solid var(--border)", fontSize: 13,
                      resize: "vertical", fontFamily: "inherit",
                      background: "var(--bg)", color: "var(--text)",
                      boxSizing: "border-box",
                    }}
                  />
                  <p style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 4 }}>
                    A observação será incluída na notificação enviada ao solicitante.
                  </p>
                </div>
                {selected.admin_note && (
                  <p className="detail-text" style={{ marginTop: 8, background: "#fffbeb", borderRadius: 6, padding: "8px 10px", borderLeft: "3px solid #f59e0b" }}>
                    <strong>Observação registrada:</strong> {selected.admin_note}
                  </p>
                )}
                <p className="detail-text" style={{ marginTop: 8 }}><strong>Descrição:</strong> {selected.description}</p>
                <p className="detail-meta">Aberta em: {new Date(selected.created_at).toLocaleString("pt-BR")}</p>
              </div>

              {/* Client */}
              <div className="detail-card">
                <div className="detail-card-title">👤 Cliente</div>
                <p className="detail-name">{selected.client?.full_name ?? "—"}</p>
                <p className="detail-text">{selected.client?.email ?? "—"}</p>
                <p className="detail-text">{selected.client?.phone ?? "—"}</p>
                <p className="detail-text">{selected.client?.city ?? "—"}</p>
                {selected.client?.phone && (
                  <a className="whatsapp-btn" href={whatsappLink(selected.client.phone)} target="_blank" rel="noreferrer">
                    💬 WhatsApp cliente
                  </a>
                )}
                <div className="status-actions" style={{ marginTop: 10 }}>
                  <button
                    className="status-btn"
                    style={{ background: "#e74c3c", color: "#fff" }}
                    disabled={actioning}
                    onClick={() => blockClient(selected.client_user_id)}
                  >
                    🚫 Bloquear
                  </button>
                  <button
                    className="status-btn"
                    style={{ background: "#27ae60", color: "#fff" }}
                    disabled={actioning}
                    onClick={() => unblockClient(selected.client_user_id)}
                  >
                    ✅ Desbloquear
                  </button>
                </div>
              </div>

              {/* Provider */}
              <div className="detail-card">
                <div className="detail-card-title">👷 Prestador</div>
                {selected.provider ? (
                  <>
                    <p className="detail-name">{selected.provider.full_name}</p>
                    <p className="detail-text">{selected.provider.email}</p>
                    <p className="detail-text">{selected.provider.phone}</p>
                    <p className="detail-text">{selected.provider.city}</p>
                    {selected.provider.phone && (
                      <a className="whatsapp-btn" href={whatsappLink(selected.provider.phone)} target="_blank" rel="noreferrer">
                        💬 WhatsApp prestador
                      </a>
                    )}
                    {selected.provider_user_id && (
                      <div className="status-actions" style={{ marginTop: 10 }}>
                        <button
                          className="status-btn"
                          style={{ background: "#e74c3c", color: "#fff" }}
                          disabled={actioning}
                          onClick={() => blockProvider(selected.provider_user_id!)}
                        >
                          🚫 Bloquear
                        </button>
                        <button
                          className="status-btn"
                          style={{ background: "#27ae60", color: "#fff" }}
                          disabled={actioning}
                          onClick={() => unblockProvider(selected.provider_user_id!)}
                        >
                          ✅ Desbloquear
                        </button>
                      </div>
                    )}
                  </>
                ) : <p className="detail-text muted">Não vinculado</p>}
              </div>

              {/* Service */}
              <div className="detail-card full-width">
                <div className="detail-card-title">🔨 Serviço</div>
                {selected.request ? (
                  <div className="service-detail-grid">
                    <div><strong>Categoria:</strong> {selected.request.category}</div>
                    <div><strong>Cidade:</strong> {selected.request.city}</div>
                    <div><strong>Valor:</strong> {selected.request.quote_amount ? `R$ ${Number(selected.request.quote_amount).toFixed(2)}` : "Não definido"}</div>
                    <div><strong>Status:</strong> {STATUS_LABEL[selected.request.status] ?? selected.request.status}</div>
                    <div><strong>Pagamento:</strong> {selected.request.payment_status ?? "—"}</div>
                    <div><strong>Agendado:</strong> {selected.request.scheduled_date ? new Date(selected.request.scheduled_date).toLocaleString("pt-BR") : "—"}</div>
                    <div className="full-width"><strong>Descrição:</strong> {selected.request.description}</div>
                  </div>
                ) : <p className="detail-text muted">Serviço não encontrado</p>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Feature Flags ─────────────────────────────────────────────────────────────
interface FeatureFlag {
  key: string;
  label: string;
  description: string;
  category: string;
  enabled: boolean;
  updated_at: string;
}

const FLAG_CATEGORY_ICON: Record<string, string> = {
  "Acesso": "🔑",
  "Chamados": "📋",
  "Pagamentos": "💳",
  "Comunicação": "💬",
  "Qualidade": "⭐",
  "Localização": "📍",
};

function FeatureFlagsPage({ adminKey }: { adminKey: string }) {
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toggling, setToggling] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    apiFetch("/v1/admin/feature-flags", adminKey)
      .then((r) => r.json())
      .then((d: any) => { setFlags(d.data ?? []); setLoading(false); })
      .catch(() => { setError("Erro ao carregar feature flags."); setLoading(false); });
  }, [adminKey]);

  useEffect(() => { load(); }, [load]);

  function showMsg(text: string, ok: boolean) {
    setActionMsg({ text, ok });
    setTimeout(() => setActionMsg(null), 3000);
  }

  async function toggle(flag: FeatureFlag) {
    setToggling(flag.key);
    try {
      const r = await apiFetch(`/v1/admin/feature-flags/${flag.key}`, adminKey, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !flag.enabled }),
      });
      if (!r.ok) throw new Error("Erro ao atualizar flag.");
      setFlags((prev) =>
        prev.map((f) => f.key === flag.key ? { ...f, enabled: !f.enabled, updated_at: new Date().toISOString() } : f)
      );
      showMsg(`"${flag.label}" ${!flag.enabled ? "ativada" : "desativada"} com sucesso.`, true);
    } catch (e: any) {
      showMsg(e.message ?? "Erro ao atualizar.", false);
    } finally {
      setToggling(null);
    }
  }

  const grouped = flags.reduce<Record<string, FeatureFlag[]>>((acc, f) => {
    (acc[f.category] = acc[f.category] ?? []).push(f);
    return acc;
  }, {});

  const totalEnabled = flags.filter((f) => f.enabled).length;
  const hasMaintenanceOn = flags.find((f) => f.key === "maintenance_mode")?.enabled;

  return (
    <div>
      <h2 className="page-title">Feature Flags</h2>
      <p style={{ color: "var(--text-secondary)", fontSize: 14, marginBottom: 20, marginTop: -8 }}>
        Ative ou desative funcionalidades da plataforma em tempo real, sem necessidade de novo deploy.
      </p>

      {hasMaintenanceOn && (
        <div style={{
          marginBottom: 20, padding: "12px 16px", borderRadius: 10,
          background: "#fff3cd", border: "1px solid #ffc107", color: "#856404",
          fontWeight: 600, fontSize: 14,
        }}>
          ⚠️ Modo de manutenção ativo — o app está bloqueado para clientes e prestadores.
        </div>
      )}

      {actionMsg && (
        <div style={{
          marginBottom: 16, padding: "10px 14px", borderRadius: 8, fontSize: 14,
          background: actionMsg.ok ? "#d4edda" : "#f8d7da",
          color: actionMsg.ok ? "#155724" : "#721c24",
        }}>
          {actionMsg.text}
        </div>
      )}

      {loading ? (
        <div className="loading">Carregando...</div>
      ) : error ? (
        <div className="error-msg">{error}</div>
      ) : (
        <>
          <div style={{ marginBottom: 20, display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div style={{ padding: "10px 18px", borderRadius: 10, background: "var(--card)", border: "1px solid var(--border)", fontSize: 13 }}>
              <strong style={{ color: "#27ae60", fontSize: 20 }}>{totalEnabled}</strong>
              <span style={{ color: "var(--text-secondary)", marginLeft: 6 }}>flags ativas</span>
            </div>
            <div style={{ padding: "10px 18px", borderRadius: 10, background: "var(--card)", border: "1px solid var(--border)", fontSize: 13 }}>
              <strong style={{ color: "#e74c3c", fontSize: 20 }}>{flags.length - totalEnabled}</strong>
              <span style={{ color: "var(--text-secondary)", marginLeft: 6 }}>flags inativas</span>
            </div>
          </div>

          {Object.entries(grouped).map(([category, items]) => (
            <div key={category} style={{ marginBottom: 28 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--text-secondary)", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                {FLAG_CATEGORY_ICON[category] ?? "🔧"} {category}
              </h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {items.map((flag) => {
                  const isLoading = toggling === flag.key;
                  return (
                    <div
                      key={flag.key}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "14px 18px",
                        background: "var(--card)",
                        border: `1px solid ${flag.enabled ? "var(--border)" : "var(--border)"}`,
                        borderLeft: `4px solid ${flag.enabled ? "#27ae60" : "#ccc"}`,
                        borderRadius: 10,
                        opacity: isLoading ? 0.6 : 1,
                        transition: "all 0.2s",
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 2 }}>
                          <span style={{ fontWeight: 700, fontSize: 14, color: "var(--text)" }}>
                            {flag.label}
                          </span>
                          <span style={{
                            fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 6,
                            background: flag.enabled ? "#d4edda" : "#f1f1f1",
                            color: flag.enabled ? "#155724" : "#666",
                          }}>
                            {flag.enabled ? "ATIVO" : "INATIVO"}
                          </span>
                        </div>
                        <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: 0 }}>
                          {flag.description}
                        </p>
                        <p style={{ fontSize: 11, color: "var(--text-secondary)", margin: "4px 0 0", opacity: 0.7 }}>
                          Atualizado em: {flag.updated_at ? new Date(flag.updated_at).toLocaleString("pt-BR") : "—"}
                        </p>
                      </div>
                      <button
                        onClick={() => toggle(flag)}
                        disabled={isLoading}
                        style={{
                          marginLeft: 20,
                          width: 52,
                          height: 28,
                          borderRadius: 14,
                          border: "none",
                          cursor: isLoading ? "not-allowed" : "pointer",
                          background: flag.enabled ? "#27ae60" : "#ccc",
                          position: "relative",
                          transition: "background 0.25s",
                          flexShrink: 0,
                        }}
                        title={flag.enabled ? "Desativar" : "Ativar"}
                      >
                        <span style={{
                          display: "block",
                          width: 22,
                          height: 22,
                          borderRadius: "50%",
                          background: "#fff",
                          position: "absolute",
                          top: 3,
                          left: flag.enabled ? 27 : 3,
                          transition: "left 0.25s",
                          boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                        }} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {flags.length === 0 && (
            <div style={{ textAlign: "center", padding: 40, color: "var(--text-secondary)" }}>
              <p style={{ fontSize: 16 }}>Nenhuma feature flag cadastrada.</p>
              <p style={{ fontSize: 13 }}>Execute o SQL de criação da tabela no Supabase para começar.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Verificações de identidade (selfie + documento, revisão manual) ─────────────
interface VerifRow {
  id: string; user_id: string; role: string; doc_type: string; status: string;
  admin_note: string | null; created_at: string; reviewed_at: string | null;
  full_name: string; email: string; phone: string;
  selfie_url: string | null; document_url: string | null;
}

function VerificationsPage({ adminKey }: { adminKey: string }) {
  const [rows, setRows] = useState<VerifRow[]>([]);
  const [tab, setTab] = useState<"pending" | "approved" | "rejected">("pending");
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [zoom, setZoom] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    apiFetch(`/v1/admin/verifications?status=${tab}`, adminKey)
      .then((r) => r.json())
      .then((d: any) => { setRows(d.verifications ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [adminKey, tab]);

  useEffect(() => { load(); }, [load]);

  async function review(id: string, action: "approve" | "reject") {
    let note: string | undefined;
    if (action === "reject") {
      note = window.prompt("Motivo da reprovação (opcional):") ?? undefined;
    }
    try {
      const r = await apiFetch(`/v1/admin/verifications/${id}`, adminKey, {
        method: "PATCH",
        body: JSON.stringify({ action, note }),
      });
      const j = await r.json() as any;
      if (!r.ok) throw new Error(j?.message ?? "Erro");
      setMsg(action === "approve" ? "Verificação aprovada." : "Verificação reprovada.");
      load();
    } catch (e: any) { setMsg(`Erro: ${e.message}`); }
  }

  const TABS: { key: typeof tab; label: string }[] = [
    { key: "pending", label: "Pendentes" },
    { key: "approved", label: "Aprovadas" },
    { key: "rejected", label: "Reprovadas" },
  ];

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>🪪 Verificações de identidade</h1>
      <p style={{ color: "#64748b", marginBottom: 16 }}>Revise a selfie e o documento (RG/CNH) e aprove ou reprove o cadastro.</p>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: "8px 16px", borderRadius: 8, border: "1px solid #e2e8f0", cursor: "pointer",
              background: tab === t.key ? "#FF6B35" : "#fff", color: tab === t.key ? "#fff" : "#334155", fontWeight: 600,
            }}
          >{t.label}</button>
        ))}
      </div>

      {msg && <div style={{ marginBottom: 12, padding: 10, background: "#ecfdf5", borderRadius: 8, color: "#065f46" }}>{msg}</div>}

      {loading ? (
        <p>Carregando…</p>
      ) : rows.length === 0 ? (
        <p style={{ color: "#94a3b8" }}>Nenhuma verificação {tab === "pending" ? "pendente" : tab === "approved" ? "aprovada" : "reprovada"}.</p>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          {rows.map((v) => (
            <div key={v.id} style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 16, background: "#fff" }}>
              <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                <div>
                  <strong style={{ fontSize: 16 }}>{v.full_name || "(sem nome)"}</strong>
                  <div style={{ color: "#64748b", fontSize: 13 }}>{v.email} · {v.phone || "sem telefone"}</div>
                  <div style={{ color: "#64748b", fontSize: 13 }}>
                    Perfil: {v.role === "provider" ? "Prestador" : "Cliente"} · Documento: {v.doc_type?.toUpperCase()} ·
                    {" "}Enviado: {fmtDate(v.created_at)}
                  </div>
                  {v.admin_note && <div style={{ color: "#b45309", fontSize: 13 }}>Nota: {v.admin_note}</div>}
                </div>
                {v.status === "pending" && (
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <button onClick={() => review(v.id, "approve")} style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: "#16a34a", color: "#fff", fontWeight: 700, cursor: "pointer" }}>Aprovar</button>
                    <button onClick={() => review(v.id, "reject")} style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: "#dc2626", color: "#fff", fontWeight: 700, cursor: "pointer" }}>Reprovar</button>
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: 16, marginTop: 12, flexWrap: "wrap" }}>
                {[{ label: "Selfie", url: v.selfie_url }, { label: `Documento (${v.doc_type?.toUpperCase()})`, url: v.document_url }].map((img) => (
                  <div key={img.label}>
                    <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>{img.label}</div>
                    {img.url ? (
                      <img
                        src={img.url} alt={img.label}
                        onClick={() => setZoom(img.url)}
                        style={{ width: 180, height: 180, objectFit: "cover", borderRadius: 8, border: "1px solid #e2e8f0", cursor: "zoom-in" }}
                      />
                    ) : <div style={{ width: 180, height: 180, borderRadius: 8, background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8" }}>sem imagem</div>}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {zoom && (
        <div onClick={() => setZoom(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, cursor: "zoom-out" }}>
          <img src={zoom} alt="zoom" style={{ maxWidth: "90%", maxHeight: "90%", borderRadius: 8 }} />
        </div>
      )}
    </div>
  );
}

// ── Nav config (agrupada — CRM) ────────────────────────────────────────────────
const NAV_GROUPS: { label: string; items: { key: Page; label: string; icon: string }[] }[] = [
  {
    label: "Operação do App",
    items: [
      { key: "dashboard", label: "Dashboard", icon: "🏠" },
      { key: "requests", label: "Pedidos", icon: "📋" },
      { key: "providers", label: "Prestadores", icon: "👷" },
      { key: "users", label: "Usuários", icon: "👥" },
      { key: "payments", label: "Pagamentos", icon: "💰" },
      { key: "complaints", label: "Reclamações", icon: "⚠️" },
      { key: "verifications", label: "Verificações", icon: "🪪" },
      { key: "flags", label: "Feature Flags", icon: "🚩" },
    ],
  },
  {
    label: "Comercial",
    items: [
      { key: "vendas", label: "Vendas (CRM)", icon: "📈" },
      { key: "marketing", label: "Marketing", icon: "📣" },
      { key: "telemedicina", label: "Telemedicina", icon: "🩺" },
    ],
  },
  {
    label: "Financeiro",
    items: [
      { key: "financeiro", label: "Financeiro", icon: "🏦" },
      { key: "relatorios", label: "Relatórios & BI", icon: "📊" },
    ],
  },
  {
    label: "Administrativo",
    items: [
      { key: "juridico", label: "Jurídico", icon: "⚖️" },
      { key: "rh", label: "RH", icon: "🧑‍💼" },
      { key: "fornecedores", label: "Fornecedores", icon: "🚚" },
    ],
  },
  {
    label: "Atendimento",
    items: [
      { key: "suporte", label: "Suporte", icon: "🎧" },
      { key: "agenda", label: "Agenda & Tarefas", icon: "🗓️" },
    ],
  },
  {
    label: "Configurações",
    items: [
      { key: "acesso", label: "Controle de Acesso", icon: "🔒" },
      { key: "auditoria", label: "Auditoria", icon: "📜" },
    ],
  },
];

// ── Auth (master ou operador com áreas) ─────────────────────────────────────────
interface AuthState { cred: string; areas: string[]; isMaster: boolean; nome: string }

function loadAuth(): AuthState {
  try {
    const raw = sessionStorage.getItem("crm_auth");
    if (raw) return JSON.parse(raw) as AuthState;
  } catch {}
  const legacy = sessionStorage.getItem("admin_key");
  if (legacy) return { cred: legacy, areas: ["*"], isMaster: true, nome: "Administrador" };
  return { cred: "", areas: [], isMaster: false, nome: "" };
}
function saveAuth(a: AuthState) {
  sessionStorage.setItem("crm_auth", JSON.stringify(a));
  sessionStorage.removeItem("admin_key");
}

// ── Root ──────────────────────────────────────────────────────────────────────
export function App() {
  const [adminKey, setAdminKey] = useState(() => loadAuth().cred);
  const [areas, setAreas] = useState<string[]>(() => loadAuth().areas);
  const [isMaster, setIsMaster] = useState(() => loadAuth().isMaster);
  const [nome, setNome] = useState(() => loadAuth().nome);
  const [loginMode, setLoginMode] = useState<"operador" | "master">("operador");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [keyInput, setKeyInput] = useState("");
  const [loginError, setLoginError] = useState("");
  const [logging, setLogging] = useState(false);
  const [page, setPage] = useState<Page>("dashboard");
  const [badges, setBadges] = useState<Partial<Record<Page, number>>>({});

  const canAccess = (area: string) => {
    if (area === "__master__") return isMaster;
    return isMaster || areas.includes("*") || areas.includes(area);
  };
  const visibleGroups = NAV_GROUPS
    .map((g) => ({ ...g, items: g.items.filter((it) => canAccess(PAGE_AREA[it.key])) }))
    .filter((g) => g.items.length > 0);

  function handleBadge(p: Page, count: number) {
    setBadges((prev) => ({ ...prev, [p]: count }));
  }

  useAdminNotifications(adminKey, handleBadge);

  function navigate(p: Page) {
    setPage(p);
    setBadges((prev) => ({ ...prev, [p]: 0 }));
  }

  const loggedIn = adminKey.length > 0;

  // Redireciona para a primeira área permitida se a atual não for acessível.
  useEffect(() => {
    if (!loggedIn) return;
    if (!canAccess(PAGE_AREA[page])) {
      const first = visibleGroups[0]?.items[0]?.key;
      if (first) setPage(first);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminKey, isMaster, areas]);

  function applyAuth(a: AuthState) {
    saveAuth(a);
    setAdminKey(a.cred);
    setAreas(a.areas);
    setIsMaster(a.isMaster);
    setNome(a.nome);
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginError("");
    setLogging(true);
    try {
      if (loginMode === "master") {
        const res = await apiFetch("/v1/admin/overview", keyInput).catch(() => null);
        if (!res || !res.ok) { setLoginError("Chave de administrador inválida."); return; }
        applyAuth({ cred: keyInput, areas: ["*"], isMaster: true, nome: "Administrador" });
      } else {
        const res = await fetch(`${API}/v1/crm/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, senha }),
        }).catch(() => null);
        const data = res ? await res.json().catch(() => null) : null;
        if (!res || !res.ok || !data?.token) {
          setLoginError(data?.message ?? "E-mail ou senha inválidos.");
          return;
        }
        applyAuth({ cred: data.token, areas: data.areas ?? [], isMaster: false, nome: data.nome ?? "Operador" });
      }
    } finally {
      setLogging(false);
    }
  }

  function handleLogout() {
    sessionStorage.removeItem("crm_auth");
    sessionStorage.removeItem("admin_key");
    setAdminKey("");
    setAreas([]);
    setIsMaster(false);
    setNome("");
    setKeyInput("");
    setEmail("");
    setSenha("");
  }

  if (!loggedIn) {
    return (
      <div className="login-shell">
        <div className="login-card">
          <div className="login-logo">
            <span className="logo-mark">CC</span>
            <div>
              <strong>ConstruConnect</strong>
              <p>Painel Administrativo</p>
            </div>
          </div>
          <div className="login-tabs">
            <button
              type="button"
              className={`login-tab${loginMode === "operador" ? " active" : ""}`}
              onClick={() => { setLoginMode("operador"); setLoginError(""); }}
            >Operador</button>
            <button
              type="button"
              className={`login-tab${loginMode === "master" ? " active" : ""}`}
              onClick={() => { setLoginMode("master"); setLoginError(""); }}
            >Dono (chave master)</button>
          </div>

          <form onSubmit={handleLogin} className="login-form">
            {loginMode === "operador" ? (
              <>
                <label>
                  E-mail
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="seu@email.com"
                    required
                    autoFocus
                  />
                </label>
                <label>
                  Senha
                  <input
                    type="password"
                    value={senha}
                    onChange={(e) => setSenha(e.target.value)}
                    placeholder="Sua senha"
                    required
                  />
                </label>
              </>
            ) : (
              <label>
                Chave de acesso
                <input
                  type="password"
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  placeholder="Digite a chave de administrador"
                  required
                  autoFocus
                />
              </label>
            )}
            {loginError && <p className="login-error">{loginError}</p>}
            <button className="login-btn" type="submit" disabled={logging}>
              {logging ? "Verificando..." : "Entrar"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-shell">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <span className="logo-mark sm">CC</span>
          <div>
            <strong>ConstruConnect</strong>
            <p>{isMaster ? "Administrador" : (nome || "Operador")}</p>
          </div>
        </div>
        <nav className="sidebar-nav">
          {visibleGroups.map((group) => (
            <div key={group.label}>
              <div className="sidebar-group-label">{group.label}</div>
              {group.items.map((n) => (
                <button
                  key={n.key}
                  className={`nav-item${page === n.key ? " active" : ""}`}
                  onClick={() => navigate(n.key)}
                >
                  <span className="nav-icon">{n.icon}</span>
                  {n.label}
                  {(badges[n.key] ?? 0) > 0 && (
                    <span style={{
                      marginLeft: "auto",
                      background: "#e74c3c",
                      color: "#fff",
                      borderRadius: "10px",
                      padding: "1px 7px",
                      fontSize: 11,
                      fontWeight: 700,
                      minWidth: 18,
                      textAlign: "center",
                    }}>
                      {badges[n.key]}
                    </span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <button className="logout-btn" onClick={handleLogout}>
          🚪 Sair
        </button>
      </aside>

      <main className="admin-main">
        <div className="admin-content">
          {page === "dashboard" && <DashboardPage adminKey={adminKey} onNavigate={navigate} />}
          {page === "requests" && <RequestsPage adminKey={adminKey} />}
          {page === "providers" && <ProvidersPage adminKey={adminKey} />}
          {page === "users" && <UsersPage adminKey={adminKey} />}
          {page === "payments" && <PaymentsPage adminKey={adminKey} />}
          {page === "complaints" && <ComplaintsPage adminKey={adminKey} />}
          {page === "verifications" && <VerificationsPage adminKey={adminKey} />}
          {page === "flags" && <FeatureFlagsPage adminKey={adminKey} />}
          {page === "vendas" && <VendasModule adminKey={adminKey} />}
          {page === "marketing" && <MarketingModule adminKey={adminKey} />}
          {page === "telemedicina" && <TeleMedicinaModule adminKey={adminKey} />}
          {page === "financeiro" && <FinanceiroModule adminKey={adminKey} />}
          {page === "relatorios" && <RelatoriosModule adminKey={adminKey} />}
          {page === "juridico" && <JuridicoModule adminKey={adminKey} />}
          {page === "rh" && <RHModule adminKey={adminKey} />}
          {page === "fornecedores" && <FornecedoresModule adminKey={adminKey} />}
          {page === "suporte" && <SuporteModule adminKey={adminKey} />}
          {page === "agenda" && <AgendaModule adminKey={adminKey} />}
          {page === "acesso" && isMaster && <AcessoModule adminKey={adminKey} />}
          {page === "auditoria" && isMaster && <AuditoriaModule adminKey={adminKey} />}
        </div>
      </main>
    </div>
  );
}
