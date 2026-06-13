import { useState, useEffect, useCallback } from "react";
import {
  PageHeader,
  KpiGrid,
  Kpi,
  Button,
  SectionCard,
  DataTable,
  Field,
  TextInput,
  Select,
  type Column,
} from "../kit";

const API = import.meta.env.VITE_API_URL ?? "https://construconnect-api.orionsystem.workers.dev";

interface TelemedicineConfig {
  id?: string;
  partner_name: string;
  partner_description: string;
  access_url: string;
  is_active: boolean;
  updated_at?: string;
}

interface ReportEntry {
  dia: string;
  user_role: "client" | "provider";
  count: number;
}

const emptyConfig = (): TelemedicineConfig => ({
  partner_name: "",
  partner_description: "",
  access_url: "",
  is_active: false,
});

export function TeleMedicinaModule({ adminKey }: { adminKey: string }) {
  const headers = { "Content-Type": "application/json", "x-admin-key": adminKey };

  const [config, setConfig] = useState<TelemedicineConfig>(emptyConfig());
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [report, setReport] = useState<ReportEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [todayCount, setTodayCount] = useState(0);
  const [loadingReport, setLoadingReport] = useState(true);

  const loadConfig = useCallback(async () => {
    try {
      const r = await fetch(`${API}/v1/admin/telemedicine/config`, { headers: { "x-admin-key": adminKey } });
      if (r.ok) {
        const d = await r.json();
        if (d.item) setConfig(d.item);
      }
    } catch {}
  }, [adminKey]);

  const loadReport = useCallback(async () => {
    setLoadingReport(true);
    try {
      const r = await fetch(`${API}/v1/admin/telemedicine/report`, { headers: { "x-admin-key": adminKey } });
      if (r.ok) {
        const d = await r.json();
        setReport(d.report ?? []);
        setTotal(d.total ?? 0);
        setTodayCount(d.today ?? 0);
      }
    } catch {} finally {
      setLoadingReport(false);
    }
  }, [adminKey]);

  useEffect(() => {
    loadConfig();
    loadReport();
  }, [loadConfig, loadReport]);

  async function handleSave() {
    setSaving(true);
    try {
      const r = await fetch(`${API}/v1/admin/telemedicine/config`, {
        method: "PUT",
        headers,
        body: JSON.stringify(config),
      });
      if (r.ok) {
        const d = await r.json();
        if (d.item) setConfig(d.item);
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
        loadReport();
      }
    } catch {} finally {
      setSaving(false);
    }
  }

  const reportCols: Column<ReportEntry>[] = [
    { key: "dia", label: "Data", render: (r) => r.dia },
    { key: "user_role", label: "Perfil", render: (r) => r.user_role === "client" ? "Cliente" : "Prestador" },
    { key: "count", label: "Acessos", align: "right", render: (r) => r.count },
  ];

  const clientTotal = report.filter(r => r.user_role === "client").reduce((s, r) => s + r.count, 0);
  const providerTotal = report.filter(r => r.user_role === "provider").reduce((s, r) => s + r.count, 0);

  return (
    <div>
      <PageHeader
        title="Telemedicina"
        subtitle="Parceria de saúde para clientes e prestadores verificados"
      />

      <KpiGrid>
        <Kpi label="Total de acessos" value={total} icon="🩺" tone="blue" />
        <Kpi label="Hoje" value={todayCount} icon="📅" tone="green" />
        <Kpi label="Acessos clientes" value={clientTotal} icon="👤" tone="purple" />
        <Kpi label="Acessos prestadores" value={providerTotal} icon="👷" tone="orange" />
      </KpiGrid>

      <SectionCard title="Configuração do parceiro">
        <div className="crm-grid-2">
          <Field label="Nome do parceiro">
            <TextInput
              value={config.partner_name}
              onChange={(v) => setConfig({ ...config, partner_name: v })}
              placeholder="Ex.: MedOnline"
            />
          </Field>
          <Field label="Status">
            <Select
              value={config.is_active ? "true" : "false"}
              onChange={(v) => setConfig({ ...config, is_active: v === "true" })}
              options={[{ value: "false", label: "Inativo" }, { value: "true", label: "Ativo" }]}
            />
          </Field>
        </div>
        <Field label="Descrição">
          <TextInput
            value={config.partner_description}
            onChange={(v) => setConfig({ ...config, partner_description: v })}
            placeholder="Breve descrição exibida no app"
          />
        </Field>
        <Field label="URL de acesso" hint="Link ou deeplink do parceiro">
          <TextInput
            value={config.access_url}
            onChange={(v) => setConfig({ ...config, access_url: v })}
            placeholder="https://parceiro.com/acesso-construconnect"
          />
        </Field>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 16 }}>
          {saved && <span style={{ color: "#16a34a", fontSize: 14, alignSelf: "center" }}>✓ Salvo!</span>}
          <Button tone="green" onClick={handleSave} disabled={saving || !config.partner_name.trim() || !config.access_url.trim()}>
            {saving ? "Salvando…" : "Salvar configuração"}
          </Button>
        </div>
      </SectionCard>

      <SectionCard title="Relatório de acessos (últimos 90 dias)">
        {loadingReport ? (
          <div className="crm-empty-inline">Carregando relatório…</div>
        ) : (
          <DataTable
            columns={reportCols}
            rows={report.map((r, i) => ({ ...r, id: `${r.dia}-${r.user_role}-${i}` }))}
            empty="Nenhum acesso registrado ainda."
          />
        )}
      </SectionCard>
    </div>
  );
}
