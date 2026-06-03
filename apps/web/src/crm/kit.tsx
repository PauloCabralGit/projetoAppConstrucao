import { useState, useCallback, useEffect, type ReactNode } from "react";

// ════════════════════════════════════════════════════════════════════════════
// CRM Foundation — helpers, localStorage store e UI kit compartilhado
// Todos os módulos de negócio (Vendas, Financeiro, etc.) usam estas peças
// para manter consistência visual e persistência local no navegador.
// ════════════════════════════════════════════════════════════════════════════

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function brl(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "R$ 0,00";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function dateBR(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR");
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function monthKey(s: string): string {
  const d = new Date(s);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const PREFIX = "cc_crm_";

// Hook genérico de coleção persistida em localStorage
export function useLocalCollection<T extends { id: string }>(key: string, seed: T[]) {
  const storageKey = PREFIX + key;
  const [items, setItems] = useState<T[]>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) return JSON.parse(raw) as T[];
    } catch {}
    return seed;
  });

  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(items)); } catch {}
  }, [storageKey, items]);

  const add = useCallback((item: Omit<T, "id"> & { id?: string }) => {
    const full = { ...item, id: item.id ?? uid() } as T;
    setItems((prev) => [full, ...prev]);
    return full;
  }, []);

  const update = useCallback((id: string, patch: Partial<T>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }, []);

  const remove = useCallback((id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
  }, []);

  const setAll = useCallback((next: T[]) => setItems(next), []);

  return { items, add, update, remove, setAll };
}

// Hook com a MESMA API do useLocalCollection, mas persistido no backend real
// (endpoints admin /v1/admin/crm/*). Atualiza a UI de forma otimista.
export function useApiCollection<T extends { id: string }>(base: string, adminKey: string) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const headers = { "Content-Type": "application/json", "x-admin-key": adminKey };

  const reload = useCallback(async () => {
    try {
      const r = await fetch(base, { headers: { "x-admin-key": adminKey } });
      if (r.ok) {
        const d = await r.json();
        setItems((d.items ?? []) as T[]);
      }
    } catch {
      /* mantém o estado atual em caso de falha de rede */
    } finally {
      setLoading(false);
    }
  }, [base, adminKey]);

  useEffect(() => { reload(); }, [reload]);

  const add = useCallback((item: Omit<T, "id"> & { id?: string }) => {
    const tempId = item.id ?? uid();
    const optimistic = { ...item, id: tempId } as T;
    setItems((prev) => [optimistic, ...prev]);
    fetch(base, { method: "POST", headers, body: JSON.stringify(item) })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.item) setItems((prev) => prev.map((it) => (it.id === tempId ? d.item : it))); })
      .catch(() => {});
    return optimistic;
  }, [base, adminKey]);

  const update = useCallback((id: string, patch: Partial<T>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
    fetch(`${base}/${id}`, { method: "PATCH", headers, body: JSON.stringify(patch) }).catch(() => {});
  }, [base, adminKey]);

  const remove = useCallback((id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
    fetch(`${base}/${id}`, { method: "DELETE", headers: { "x-admin-key": adminKey } }).catch(() => {});
  }, [base, adminKey]);

  const setAll = useCallback((next: T[]) => setItems(next), []);

  return { items, add, update, remove, setAll, loading, reload };
}

export const CRM_API_BASE = "https://construconnect-api.orionsystem.workers.dev/v1/admin/crm";

// ── Componentes ───────────────────────────────────────────────────────────────

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="crm-pagehead">
      <div>
        <h2 className="page-title" style={{ marginBottom: subtitle ? 2 : 0 }}>{title}</h2>
        {subtitle && <p className="crm-subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="crm-pagehead-actions">{actions}</div>}
    </div>
  );
}

export function KpiGrid({ children }: { children: ReactNode }) {
  return <div className="crm-kpi-grid">{children}</div>;
}

type Tone = "blue" | "green" | "orange" | "red" | "purple" | "gray";

export function Kpi({ label, value, icon, tone = "blue", hint }: { label: string; value: ReactNode; icon?: string; tone?: Tone; hint?: string }) {
  return (
    <div className={`crm-kpi tone-${tone}`}>
      {icon && <span className="crm-kpi-icon">{icon}</span>}
      <div className="crm-kpi-body">
        <span className="crm-kpi-value">{value}</span>
        <span className="crm-kpi-label">{label}</span>
        {hint && <span className="crm-kpi-hint">{hint}</span>}
      </div>
    </div>
  );
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="crm-toolbar">{children}</div>;
}

export function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      className="crm-input crm-search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder ?? "Buscar..."}
    />
  );
}

export function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <select className="crm-input crm-select" value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function Badge({ tone = "gray", children }: { tone?: Tone | "success" | "warning" | "danger" | "info"; children: ReactNode }) {
  const map: Record<string, string> = {
    green: "badge-success", success: "badge-success",
    orange: "badge-warning", warning: "badge-warning",
    red: "badge-danger", danger: "badge-danger",
    blue: "badge-info", info: "badge-info", purple: "badge-info",
    gray: "badge-muted",
  };
  return <span className={`badge ${map[tone] ?? "badge-muted"}`}>{children}</span>;
}

export interface Column<T> {
  key: string;
  label: string;
  render?: (row: T) => ReactNode;
  width?: number | string;
  align?: "left" | "right" | "center";
}

export function DataTable<T extends { id: string }>({ columns, rows, empty }: { columns: Column<T>[]; rows: T[]; empty?: ReactNode }) {
  if (rows.length === 0) {
    return <div className="crm-empty-inline">{empty ?? "Nenhum registro encontrado."}</div>;
  }
  return (
    <div className="table-wrap">
      <table className="crm-table">
        <thead>
          <tr>{columns.map((c) => <th key={c.key} style={{ width: c.width, textAlign: c.align ?? "left" }}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              {columns.map((c) => (
                <td key={c.key} style={{ textAlign: c.align ?? "left" }}>
                  {c.render ? c.render(row) : (row as any)[c.key] ?? "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Button({ tone = "blue", size = "md", onClick, children, type = "button", disabled }: {
  tone?: "blue" | "green" | "danger" | "muted" | "ghost";
  size?: "sm" | "md";
  onClick?: () => void;
  children: ReactNode;
  type?: "button" | "submit";
  disabled?: boolean;
}) {
  const cls = size === "sm" ? `btn-sm btn-${tone}` : `crm-btn crm-btn-${tone}`;
  return <button type={type} className={cls} onClick={onClick} disabled={disabled}>{children}</button>;
}

export function Modal({ open, title, onClose, children, footer, wide }: {
  open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="crm-modal-overlay" onClick={onClose}>
      <div className={`crm-modal${wide ? " wide" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="crm-modal-head">
          <h3>{title}</h3>
          <button className="crm-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="crm-modal-body">{children}</div>
        {footer && <div className="crm-modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="crm-field">
      <span className="crm-field-label">{label}</span>
      {children}
      {hint && <span className="crm-field-hint">{hint}</span>}
    </label>
  );
}

export function TextInput({ value, onChange, placeholder, type = "text" }: { value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return <input className="crm-input" type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />;
}

export function Textarea({ value, onChange, placeholder, rows = 3 }: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
  return <textarea className="crm-input" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={rows} />;
}

export function Tabs({ tabs, active, onChange }: { tabs: { key: string; label: string }[]; active: string; onChange: (k: string) => void }) {
  return (
    <div className="crm-tabs">
      {tabs.map((t) => (
        <button key={t.key} className={`crm-tab${active === t.key ? " active" : ""}`} onClick={() => onChange(t.key)}>{t.label}</button>
      ))}
    </div>
  );
}

export function Empty({ icon, title, hint }: { icon?: string; title: string; hint?: string }) {
  return (
    <div className="crm-empty">
      <div className="crm-empty-icon">{icon ?? "📭"}</div>
      <strong>{title}</strong>
      {hint && <p>{hint}</p>}
    </div>
  );
}

export function ProgressBar({ value, max, tone = "blue" }: { value: number; max: number; tone?: Tone }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="crm-progress">
      <div className={`crm-progress-fill tone-${tone}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

// Mini gráfico de barras (para relatórios) — puro CSS/SVG, sem dependências
export function MiniBars({ data, height = 140 }: { data: { label: string; value: number }[]; height?: number }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="crm-bars" style={{ height }}>
      {data.map((d, i) => (
        <div key={i} className="crm-bar-col">
          <span className="crm-bar-value">{d.value > 0 ? (d.value >= 1000 ? `${(d.value / 1000).toFixed(1)}k` : d.value) : ""}</span>
          <div className="crm-bar-track">
            <div className="crm-bar-fill" style={{ height: `${(d.value / max) * 100}%` }} />
          </div>
          <span className="crm-bar-label">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

export function SectionCard({ title, actions, children }: { title?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="crm-card">
      {(title || actions) && (
        <div className="crm-card-head">
          {title && <h3>{title}</h3>}
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}
