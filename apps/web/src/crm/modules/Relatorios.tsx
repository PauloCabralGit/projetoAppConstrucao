import { useEffect, useMemo, useState } from "react";
import {
  brl, monthKey,
  PageHeader, KpiGrid, Kpi,
  Button, Badge,
  MiniBars, SectionCard, ProgressBar, Empty,
} from "../kit";

// ════════════════════════════════════════════════════════════════════════════
// Módulo Relatórios (BI) — ConstruConnect CRM
// Consolida métricas da plataforma (overview), do Financeiro e de Vendas lendo
// diretamente o localStorage onde cada módulo persiste. Exporta CSV.
// ════════════════════════════════════════════════════════════════════════════

interface AdminOverview {
  totalRevenue?: number;
  pendingRevenue?: number;
  totalUsers?: number;
  totalProviders?: number;
  completedJobs?: number;
  // campos alternativos tolerados ao fazer parse do overview
  users?: number;
  providers?: number;
}

// Espelha o tipo persistido pelo módulo Financeiro
interface LancamentoLite {
  data: string;
  tipo: "receita" | "despesa";
  valor: number;
}

// Espelha o tipo persistido pelo módulo Vendas (leitura tolerante)
interface LeadLite {
  estagio?: string;
  stage?: string;
  valor?: number;
}

const PREFIX = "cc_crm_";

const NOMES_MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function rotuloMes(key: string): string {
  const [y, m] = key.split("-");
  return `${NOMES_MES[Number(m) - 1]}/${y.slice(2)}`;
}

// Lê e faz parse tolerante de uma coleção persistida pelo CRM.
function lerColecao<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

// Seed local caso o Financeiro ainda não tenha sido aberto (sem dados no storage).
const SEED_RECEITA_MENSAL: { label: string; value: number }[] = [
  { label: "jan/26", value: 19800 },
  { label: "fev/26", value: 21400 },
  { label: "mar/26", value: 23900 },
  { label: "abr/26", value: 20650 },
  { label: "mai/26", value: 33650 },
  { label: "jun/26", value: 26050 },
];

const SEED_LEADS_ESTAGIO: { label: string; value: number }[] = [
  { label: "Novo", value: 14 },
  { label: "Contato", value: 9 },
  { label: "Proposta", value: 6 },
  { label: "Ganho", value: 4 },
  { label: "Perdido", value: 3 },
];

const ESTAGIO_LABELS: Record<string, string> = {
  novo: "Novo", new: "Novo",
  contato: "Contato", contacted: "Contato",
  proposta: "Proposta", proposal: "Proposta",
  negociacao: "Negociação", negotiation: "Negociação",
  ganho: "Ganho", won: "Ganho",
  perdido: "Perdido", lost: "Perdido",
};

function normalizaEstagio(s: string): string {
  const key = s.trim().toLowerCase();
  return ESTAGIO_LABELS[key] ?? (s ? s.charAt(0).toUpperCase() + s.slice(1) : "—");
}

export function RelatoriosModule({ adminKey }: { adminKey: string }) {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [lancamentos, setLancamentos] = useState<LancamentoLite[]>([]);
  const [leads, setLeads] = useState<LeadLite[]>([]);

  useEffect(() => {
    let alive = true;
    const API = "https://construconnect-api.orionsystem.workers.dev/v1/admin";
    const h = { "x-admin-key": adminKey };
    (async () => {
      try {
        const [ov, lc, ld] = await Promise.all([
          fetch(`${API}/overview`, { headers: h }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
          fetch(`${API}/crm/lancamentos`, { headers: h }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
          fetch(`${API}/crm/leads`, { headers: h }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        ]);
        if (!alive) return;
        if (ov) setOverview(ov as AdminOverview);
        if (lc?.items) setLancamentos(lc.items as LancamentoLite[]);
        if (ld?.items) setLeads(ld.items as LeadLite[]);
      } catch {
        // degrada graciosamente
      }
    })();
    return () => { alive = false; };
  }, [adminKey]);

  // ── Receita por mês (lida do Financeiro) ──────────────────────────────────
  const receitaPorMes = useMemo(() => {
    const lanc = lancamentos;
    if (lanc.length === 0) return { data: SEED_RECEITA_MENSAL, fonte: "exemplo" as const };
    const acc: Record<string, number> = {};
    for (const l of lanc) {
      if (l.tipo !== "receita" || !l.data) continue;
      const k = monthKey(l.data);
      acc[k] = (acc[k] ?? 0) + (Number(l.valor) || 0);
    }
    const keys = Object.keys(acc).sort();
    const data = keys.map((k) => ({ label: rotuloMes(k), value: Math.round(acc[k]) }));
    return { data: data.length ? data : SEED_RECEITA_MENSAL, fonte: "financeiro" as const };
  }, [lancamentos]);

  // ── Leads por estágio (lido de Vendas) ────────────────────────────────────
  const leadsPorEstagio = useMemo(() => {
    if (leads.length === 0) return { data: SEED_LEADS_ESTAGIO, fonte: "exemplo" as const };
    const acc: Record<string, number> = {};
    for (const l of leads) {
      const est = normalizaEstagio(l.estagio ?? l.stage ?? "—");
      acc[est] = (acc[est] ?? 0) + 1;
    }
    const data = Object.entries(acc).map(([label, value]) => ({ label, value }));
    return { data: data.length ? data : SEED_LEADS_ESTAGIO, fonte: "vendas" as const };
  }, [leads]);

  // ── KPIs consolidados ─────────────────────────────────────────────────────
  const receitaTotal = overview?.totalRevenue;
  const usuarios = overview?.totalUsers ?? overview?.users;
  const prestadores = overview?.totalProviders ?? overview?.providers;
  const servicosConcluidos = overview?.completedJobs;

  const receitaAcumulada = useMemo(
    () => receitaPorMes.data.reduce((s, d) => s + d.value, 0),
    [receitaPorMes],
  );

  const totalLeads = useMemo(
    () => leadsPorEstagio.data.reduce((s, d) => s + d.value, 0),
    [leadsPorEstagio],
  );

  const ganhos = leadsPorEstagio.data.find((d) => d.label === "Ganho")?.value ?? 0;
  const taxaConversao = totalLeads > 0 ? Math.round((ganhos / totalLeads) * 100) : 0;

  function exportarCSV() {
    const linhas: string[][] = [];
    linhas.push(["Métrica", "Valor"]);
    linhas.push(["Receita total da plataforma", receitaTotal != null ? brl(receitaTotal) : "—"]);
    linhas.push(["Receita pendente (app)", overview?.pendingRevenue != null ? brl(overview.pendingRevenue) : "—"]);
    linhas.push(["Usuários", usuarios != null ? String(usuarios) : "—"]);
    linhas.push(["Prestadores", prestadores != null ? String(prestadores) : "—"]);
    linhas.push(["Serviços concluídos", servicosConcluidos != null ? String(servicosConcluidos) : "—"]);
    linhas.push(["Receita acumulada (financeiro)", brl(receitaAcumulada)]);
    linhas.push(["Total de leads", String(totalLeads)]);
    linhas.push(["Leads ganhos", String(ganhos)]);
    linhas.push(["Taxa de conversão", `${taxaConversao}%`]);
    linhas.push([]);
    linhas.push(["Receita por mês", ""]);
    receitaPorMes.data.forEach((d) => linhas.push([d.label, brl(d.value)]));
    linhas.push([]);
    linhas.push(["Leads por estágio", ""]);
    leadsPorEstagio.data.forEach((d) => linhas.push([d.label, String(d.value)]));

    const escapar = (c: string) => {
      const s = c ?? "";
      return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = linhas.map((row) => row.map(escapar).join(";")).join("\n");

    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `relatorio-construconnect-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const maxLead = Math.max(...leadsPorEstagio.data.map((d) => d.value), 1);

  return (
    <div className="crm-module">
      <PageHeader
        title="Relatórios"
        subtitle="Business Intelligence — visão consolidada da plataforma"
        actions={<Button tone="green" onClick={exportarCSV}>⬇ Exportar CSV</Button>}
      />

      <KpiGrid>
        <Kpi
          label="Receita total da plataforma"
          value={receitaTotal != null ? brl(receitaTotal) : "—"}
          icon="💰"
          tone="green"
          hint={overview?.pendingRevenue != null ? `Pendente: ${brl(overview.pendingRevenue)}` : "Dados do app"}
        />
        <Kpi label="Usuários" value={usuarios != null ? usuarios.toLocaleString("pt-BR") : "—"} icon="👥" tone="blue" />
        <Kpi label="Prestadores" value={prestadores != null ? prestadores.toLocaleString("pt-BR") : "—"} icon="🛠️" tone="purple" />
        <Kpi label="Serviços concluídos" value={servicosConcluidos != null ? servicosConcluidos.toLocaleString("pt-BR") : "—"} icon="✅" tone="orange" />
      </KpiGrid>

      <div className="crm-grid-2">
        <SectionCard
          title="Receita por mês"
          actions={<Badge tone={receitaPorMes.fonte === "financeiro" ? "green" : "gray"}>
            {receitaPorMes.fonte === "financeiro" ? "Financeiro" : "Exemplo"}
          </Badge>}
        >
          <MiniBars data={receitaPorMes.data} />
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--cc-border, #e5e7eb)" }}>
            <span className="crm-kpi-label">Receita acumulada no período</span>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{brl(receitaAcumulada)}</div>
          </div>
        </SectionCard>

        <SectionCard
          title="Leads por estágio"
          actions={<Badge tone={leadsPorEstagio.fonte === "vendas" ? "green" : "gray"}>
            {leadsPorEstagio.fonte === "vendas" ? "Vendas" : "Exemplo"}
          </Badge>}
        >
          {leadsPorEstagio.data.length === 0 ? (
            <Empty icon="📊" title="Sem leads" hint="Cadastre leads no módulo de Vendas." />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {leadsPorEstagio.data.map((d) => (
                <div key={d.label}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                    <span>{d.label}</span>
                    <strong>{d.value}</strong>
                  </div>
                  <ProgressBar value={d.value} max={maxLead} tone="blue" />
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      <div className="crm-grid-2">
        <SectionCard title="Funil de conversão">
          <KpiGrid>
            <Kpi label="Total de leads" value={totalLeads.toLocaleString("pt-BR")} icon="🎯" tone="blue" />
            <Kpi label="Leads ganhos" value={ganhos.toLocaleString("pt-BR")} icon="🏆" tone="green" />
            <Kpi label="Taxa de conversão" value={`${taxaConversao}%`} icon="📈" tone="purple" />
          </KpiGrid>
          <div style={{ marginTop: 12 }}>
            <ProgressBar value={taxaConversao} max={100} tone="green" />
          </div>
        </SectionCard>

        <SectionCard title="Saúde da plataforma">
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                <span>Receita confirmada vs. pendente</span>
                <strong>
                  {receitaTotal != null && overview?.pendingRevenue != null
                    ? `${Math.round((receitaTotal / (receitaTotal + overview.pendingRevenue || 1)) * 100)}%`
                    : "—"}
                </strong>
              </div>
              <ProgressBar
                value={receitaTotal ?? 0}
                max={(receitaTotal ?? 0) + (overview?.pendingRevenue ?? 0) || 1}
                tone="green"
              />
            </div>
            <div style={{ fontSize: 13, color: "var(--cc-muted, #6b7280)" }}>
              {overview
                ? "Dados em tempo real do painel administrativo."
                : "API indisponível — exibindo dados locais e de exemplo."}
            </div>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
