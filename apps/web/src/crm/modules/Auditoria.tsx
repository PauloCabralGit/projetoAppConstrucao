import { useCallback, useEffect, useState } from "react";
import {
  PageHeader, KpiGrid, Kpi, Toolbar, Select, Button,
  Badge, DataTable, type Column, Empty,
} from "../kit";
import { AREAS } from "./Acesso";

// ════════════════════════════════════════════════════════════════════════════
// Auditoria — registro de quem fez cada alteração no CRM (somente master)
// ════════════════════════════════════════════════════════════════════════════

const AUDIT_URL = "https://construconnect-api.orionsystem.workers.dev/v1/admin/audit";

const AREA_LABEL: Record<string, string> = {
  ...Object.fromEntries(AREAS.map((a) => [a.key, a.label])),
  acesso: "Controle de Acesso",
};

interface Entrada {
  id: string;
  actor_tipo: string;
  actor_nome: string;
  actor_email: string;
  acao: string;
  area: string;
  recurso: string;
  registro_id: string | null;
  status: number;
  ip: string;
  created_at: string;
}

const ACAO_TONE: Record<string, "green" | "blue" | "red" | "orange" | "gray"> = {
  criou: "green",
  atualizou: "blue",
  excluiu: "red",
  "acesso negado": "orange",
};

function dataHora(s: string): string {
  const d = new Date(s);
  return isNaN(d.getTime()) ? "—" : d.toLocaleString("pt-BR");
}

export function AuditoriaModule({ adminKey }: { adminKey: string }) {
  const [items, setItems] = useState<Entrada[]>([]);
  const [loading, setLoading] = useState(true);
  const [area, setArea] = useState("todas");

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const url = `${AUDIT_URL}?limit=300${area !== "todas" ? `&area=${encodeURIComponent(area)}` : ""}`;
      const res = await fetch(url, { headers: { "x-admin-key": adminKey } });
      if (res.ok) {
        const d = await res.json();
        setItems((d.items ?? []) as Entrada[]);
      }
    } catch {
      /* mantém estado */
    } finally {
      setLoading(false);
    }
  }, [adminKey, area]);

  useEffect(() => { carregar(); }, [carregar]);

  const hoje = new Date().toDateString();
  const acoesHoje = items.filter((e) => new Date(e.created_at).toDateString() === hoje).length;
  const negados = items.filter((e) => e.acao === "acesso negado").length;
  const operadores = new Set(items.map((e) => e.actor_email || e.actor_nome)).size;

  const columns: Column<Entrada>[] = [
    { key: "created_at", label: "Data/hora", render: (e) => dataHora(e.created_at) },
    {
      key: "actor", label: "Quem", render: (e) => (
        <span>
          {e.actor_nome || "—"}{" "}
          <Badge tone={e.actor_tipo === "master" ? "purple" : "gray"}>{e.actor_tipo}</Badge>
          {e.actor_email && <div style={{ fontSize: 11, color: "var(--muted)" }}>{e.actor_email}</div>}
        </span>
      ),
    },
    { key: "acao", label: "Ação", render: (e) => <Badge tone={ACAO_TONE[e.acao] ?? "gray"}>{e.acao}</Badge> },
    { key: "area", label: "Área", render: (e) => AREA_LABEL[e.area] ?? e.area },
    { key: "recurso", label: "Recurso", render: (e) => (
        <span style={{ fontFamily: "monospace", fontSize: 12 }}>
          {e.recurso}{e.registro_id ? "" : ""}
        </span>
      ) },
    { key: "ip", label: "IP", render: (e) => e.ip || "—" },
  ];

  return (
    <div>
      <PageHeader
        title="Auditoria"
        subtitle="Histórico de alterações — quem fez o quê, quando e de onde"
        actions={<Button tone="muted" onClick={carregar}>↻ Atualizar</Button>}
      />

      <KpiGrid>
        <Kpi label="Registros (recentes)" value={items.length} icon="📜" tone="blue" />
        <Kpi label="Ações hoje" value={acoesHoje} icon="📅" tone="green" />
        <Kpi label="Acessos negados" value={negados} icon="🚫" tone="red" />
        <Kpi label="Usuários distintos" value={operadores} icon="👤" tone="purple" />
      </KpiGrid>

      <Toolbar>
        <Select
          value={area}
          onChange={setArea}
          options={[
            { value: "todas", label: "Todas as áreas" },
            ...AREAS.map((a) => ({ value: a.key, label: a.label })),
            { value: "acesso", label: "Controle de Acesso" },
          ]}
        />
      </Toolbar>

      <div className="crm-card">
        {loading
          ? <div className="crm-empty-inline">Carregando...</div>
          : items.length === 0
            ? <Empty icon="📜" title="Sem registros" hint="As alterações feitas no CRM aparecerão aqui." />
            : <DataTable columns={columns} rows={items} />}
      </div>
    </div>
  );
}
