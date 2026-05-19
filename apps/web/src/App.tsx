import { useState, useEffect, useCallback } from "react";

const API = import.meta.env.VITE_API_URL ?? "https://construconnect-api.orionsystem.workers.dev";

type Page = "dashboard" | "requests" | "providers" | "users" | "payments" | "complaints";

interface Overview {
  totalUsers: number;
  totalProviders: number;
  activeRequests: number;
  completedJobs: number;
  totalRevenue: number;
  pendingRevenue: number;
  blockedProviders: number;
  newUsers: number;
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
}

interface Complaints {
  lowRated: AdminRequest[];
  cancelled: AdminRequest[];
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
function DashboardPage({ adminKey }: { adminKey: string }) {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    apiFetch("/v1/admin/overview", adminKey)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => { setError("Erro ao carregar dados."); setLoading(false); });
  }, [adminKey]);

  if (loading) return <div className="loading">Carregando...</div>;
  if (error) return <div className="error-msg">{error}</div>;
  if (!data) return null;

  const cards = [
    { label: "Usuários", value: data.totalUsers, icon: "👥", color: "blue" },
    { label: "Prestadores", value: data.totalProviders, icon: "👷", color: "green" },
    { label: "Chamados ativos", value: data.activeRequests, icon: "📋", color: "orange" },
    { label: "Serviços concluídos", value: data.completedJobs, icon: "✅", color: "green" },
    { label: "Receita total", value: fmt(data.totalRevenue, true), icon: "💰", color: "green" },
    { label: "Receita pendente", value: fmt(data.pendingRevenue, true), icon: "⏳", color: "orange" },
    { label: "Prestadores bloqueados", value: data.blockedProviders, icon: "🚫", color: "red" },
    { label: "Novos usuários (7d)", value: data.newUsers, icon: "🆕", color: "blue" },
  ];

  return (
    <div>
      <h2 className="page-title">Dashboard</h2>
      <div className="stats-grid">
        {cards.map((c) => (
          <div className={`stat-card stat-${c.color}`} key={c.label}>
            <span className="stat-icon">{c.icon}</span>
            <div>
              <p className="stat-label">{c.label}</p>
              <strong className="stat-value">{c.value}</strong>
            </div>
          </div>
        ))}
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
    await apiFetch(`/v1/admin/providers/${id}/verify`, adminKey, { method: "PATCH" });
    setActionMsg("Prestador verificado com sucesso!");
    load();
  }

  async function block(id: string) {
    if (!blockDate) return;
    await apiFetch(`/v1/admin/providers/${id}/block`, adminKey, {
      method: "PATCH",
      body: JSON.stringify({ until: blockDate }),
    });
    setBlockTarget(null);
    setBlockDate("");
    setActionMsg("Prestador bloqueado.");
    load();
  }

  async function unblock(id: string) {
    await apiFetch(`/v1/admin/providers/${id}/unblock`, adminKey, { method: "PATCH" });
    setActionMsg("Prestador desbloqueado.");
    load();
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
                return (
                  <tr key={p.user_id}>
                    <td>
                      <strong>{u.name}</strong>
                      <span className="muted-sm block">{u.phone}</span>
                    </td>
                    <td className="muted-sm">{u.email}</td>
                    <td>{u.city}</td>
                    <td>
                      <span className={`badge ${PROV_STATUS_COLOR[p.status] ?? "badge-muted"}`}>
                        {PROV_STATUS_LABEL[p.status] ?? p.status}
                      </span>
                    </td>
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
                        {!isBlocked ? (
                          <button className="btn-sm btn-danger" onClick={() => setBlockTarget(p.user_id)}>
                            Bloquear
                          </button>
                        ) : (
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
                <tr><td colSpan={9} className="empty-row">Nenhum prestador encontrado.</td></tr>
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

  useEffect(() => {
    setLoading(true);
    apiFetch("/v1/admin/users", adminKey)
      .then((r) => r.json())
      .then((d) => { setRows(d.data ?? []); setLoading(false); })
      .catch(() => { setError("Erro ao carregar usuários."); setLoading(false); });
  }, [adminKey]);

  const filtered = rows.filter((u) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return u.full_name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q);
  });

  return (
    <div>
      <h2 className="page-title">Usuários</h2>
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
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
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
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="empty-row">Nenhum usuário encontrado.</td></tr>
              )}
            </tbody>
          </table>
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

  useEffect(() => {
    setLoading(true);
    apiFetch("/v1/admin/payments", adminKey)
      .then((r) => r.json())
      .then((d) => { setRows(d.data ?? []); setLoading(false); })
      .catch(() => { setError("Erro ao carregar pagamentos."); setLoading(false); });
  }, [adminKey]);

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
function ComplaintsPage({ adminKey }: { adminKey: string }) {
  const [data, setData] = useState<Complaints | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    apiFetch("/v1/admin/complaints", adminKey)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => { setError("Erro ao carregar reclamações."); setLoading(false); });
  }, [adminKey]);

  if (loading) return <div className="loading">Carregando...</div>;
  if (error) return <div className="error-msg">{error}</div>;
  if (!data) return null;

  function ReqTable({ rows, label }: { rows: AdminRequest[]; label: string }) {
    return (
      <section className="complaint-section">
        <h3>
          {label}
          <span className="count-badge">{rows.length}</span>
        </h3>
        {rows.length === 0 ? (
          <p className="empty-msg">Nenhum registro encontrado.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Categoria</th>
                  <th>Cliente</th>
                  <th>Prestador</th>
                  <th>Cidade</th>
                  <th>Nota</th>
                  <th>Status</th>
                  <th>Data</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.category}</strong>
                      <span className="muted-sm block">
                        {r.description?.slice(0, 55)}{r.description?.length > 55 ? "…" : ""}
                      </span>
                    </td>
                    <td>{r.app_users?.full_name ?? "—"}</td>
                    <td>{getProviderName(r.provider_profiles)}</td>
                    <td>{r.city}</td>
                    <td>{stars(r.client_rating)}</td>
                    <td>
                      <span className={`badge ${STATUS_COLOR[r.status] ?? "badge-muted"}`}>
                        {STATUS_LABEL[r.status] ?? r.status}
                      </span>
                    </td>
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
      <ReqTable rows={data.lowRated} label="⭐ Avaliações baixas (≤ 2 estrelas)" />
      <ReqTable rows={data.cancelled} label="❌ Chamados cancelados" />
    </div>
  );
}

// ── Nav config ────────────────────────────────────────────────────────────────
const NAV: { key: Page; label: string; icon: string }[] = [
  { key: "dashboard", label: "Dashboard", icon: "🏠" },
  { key: "requests", label: "Pedidos", icon: "📋" },
  { key: "providers", label: "Prestadores", icon: "👷" },
  { key: "users", label: "Usuários", icon: "👥" },
  { key: "payments", label: "Pagamentos", icon: "💰" },
  { key: "complaints", label: "Reclamações", icon: "⚠️" },
];

// ── Root ──────────────────────────────────────────────────────────────────────
export function App() {
  const [adminKey, setAdminKey] = useState(() => sessionStorage.getItem("admin_key") ?? "");
  const [keyInput, setKeyInput] = useState("");
  const [loginError, setLoginError] = useState("");
  const [logging, setLogging] = useState(false);
  const [page, setPage] = useState<Page>("dashboard");

  const loggedIn = adminKey.length > 0;

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginError("");
    setLogging(true);
    try {
      const res = await apiFetch("/v1/admin/overview", keyInput).catch(() => null);
      if (!res || !res.ok) {
        setLoginError("Chave de administrador inválida.");
        return;
      }
      sessionStorage.setItem("admin_key", keyInput);
      setAdminKey(keyInput);
    } finally {
      setLogging(false);
    }
  }

  function handleLogout() {
    sessionStorage.removeItem("admin_key");
    setAdminKey("");
    setKeyInput("");
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
          <form onSubmit={handleLogin} className="login-form">
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
            <p>Admin</p>
          </div>
        </div>
        <nav className="sidebar-nav">
          {NAV.map((n) => (
            <button
              key={n.key}
              className={`nav-item${page === n.key ? " active" : ""}`}
              onClick={() => setPage(n.key)}
            >
              <span className="nav-icon">{n.icon}</span>
              {n.label}
            </button>
          ))}
        </nav>
        <button className="logout-btn" onClick={handleLogout}>
          🚪 Sair
        </button>
      </aside>

      <main className="admin-main">
        <div className="admin-content">
          {page === "dashboard" && <DashboardPage adminKey={adminKey} />}
          {page === "requests" && <RequestsPage adminKey={adminKey} />}
          {page === "providers" && <ProvidersPage adminKey={adminKey} />}
          {page === "users" && <UsersPage adminKey={adminKey} />}
          {page === "payments" && <PaymentsPage adminKey={adminKey} />}
          {page === "complaints" && <ComplaintsPage adminKey={adminKey} />}
        </div>
      </main>
    </div>
  );
}
