import { useMemo, useState } from "react";
import {
  uid,
  brl,
  useLocalCollection,
  PageHeader,
  KpiGrid,
  Kpi,
  Toolbar,
  Button,
  Badge,
  DataTable,
  Modal,
  Field,
  TextInput,
  Select,
  Tabs,
  MiniBars,
  SectionCard,
  type Column,
} from "../kit";

// ════════════════════════════════════════════════════════════════════════════
// MARKETING — campanhas, investimento, leads gerados e desempenho por canal
// ════════════════════════════════════════════════════════════════════════════

type Canal = "Google Ads" | "Meta" | "Instagram" | "Email" | "Orgânico";
type StatusCampanha = "ativa" | "pausada" | "encerrada";

interface Campanha {
  id: string;
  nome: string;
  canal: Canal;
  orcamento: number;
  gasto: number;
  leads: number;
  status: StatusCampanha;
}

const CANAIS: Canal[] = ["Google Ads", "Meta", "Instagram", "Email", "Orgânico"];
const CANAL_OPTS = CANAIS.map((c) => ({ value: c, label: c }));

const STATUS_OPTS: { value: StatusCampanha; label: string }[] = [
  { value: "ativa", label: "Ativa" },
  { value: "pausada", label: "Pausada" },
  { value: "encerrada", label: "Encerrada" },
];

const STATUS_TONE: Record<StatusCampanha, "green" | "orange" | "gray"> = {
  ativa: "green",
  pausada: "orange",
  encerrada: "gray",
};

const STATUS_LABEL: Record<StatusCampanha, string> = {
  ativa: "Ativa",
  pausada: "Pausada",
  encerrada: "Encerrada",
};

const SEED: Campanha[] = [
  { id: uid(), nome: "Reformas Residenciais SP", canal: "Google Ads", orcamento: 12000, gasto: 8450, leads: 142, status: "ativa" },
  { id: uid(), nome: "Construtoras — Captação", canal: "Meta", orcamento: 9000, gasto: 9000, leads: 87, status: "encerrada" },
  { id: uid(), nome: "Antes & Depois (Obras)", canal: "Instagram", orcamento: 6000, gasto: 3120, leads: 64, status: "ativa" },
  { id: uid(), nome: "Newsletter Síndicos", canal: "Email", orcamento: 1500, gasto: 980, leads: 38, status: "pausada" },
  { id: uid(), nome: "Blog ConstruDicas (SEO)", canal: "Orgânico", orcamento: 4000, gasto: 2600, leads: 95, status: "ativa" },
];

function emptyForm(): Omit<Campanha, "id"> {
  return { nome: "", canal: "Google Ads", orcamento: 0, gasto: 0, leads: 0, status: "ativa" };
}

function numField(v: string): number {
  return Number(v.replace(/[^\d]/g, "")) || 0;
}

export function MarketingModule() {
  const { items, add, update, remove } = useLocalCollection<Campanha>("mkt_campanhas", SEED);
  const [tab, setTab] = useState<"campanhas" | "canais">("campanhas");

  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<Omit<Campanha, "id">>(emptyForm);

  // KPIs
  const investimento = items.reduce((s, c) => s + (c.gasto || 0), 0);
  const totalLeads = items.reduce((s, c) => s + (c.leads || 0), 0);
  const cac = totalLeads > 0 ? investimento / totalLeads : 0;
  const ativas = items.filter((c) => c.status === "ativa").length;

  // Desempenho por canal
  const porCanal = useMemo(() => {
    return CANAIS.map((canal) => {
      const grupo = items.filter((c) => c.canal === canal);
      const gasto = grupo.reduce((s, c) => s + (c.gasto || 0), 0);
      const leads = grupo.reduce((s, c) => s + (c.leads || 0), 0);
      return {
        id: canal,
        canal,
        gasto,
        leads,
        cac: leads > 0 ? gasto / leads : 0,
      };
    }).filter((r) => r.gasto > 0 || r.leads > 0);
  }, [items]);

  const barsData = porCanal.map((r) => ({ label: r.canal.split(" ")[0], value: r.leads }));

  function abrirNovo() {
    setForm(emptyForm());
    setEditId(null);
    setOpen(true);
  }

  function abrirEdicao(c: Campanha) {
    const { id, ...rest } = c;
    setForm(rest);
    setEditId(id);
    setOpen(true);
  }

  function salvar() {
    if (!form.nome.trim()) return;
    if (editId) {
      update(editId, form);
    } else {
      add(form);
    }
    setOpen(false);
  }

  function excluir() {
    if (editId) remove(editId);
    setOpen(false);
  }

  const colsCampanhas: Column<Campanha>[] = [
    { key: "nome", label: "Campanha", render: (r) => <strong>{r.nome}</strong> },
    { key: "canal", label: "Canal", render: (r) => <Badge tone="info">{r.canal}</Badge> },
    { key: "orcamento", label: "Orçamento", align: "right", render: (r) => brl(r.orcamento) },
    { key: "gasto", label: "Gasto", align: "right", render: (r) => brl(r.gasto) },
    { key: "leads", label: "Leads", align: "right", render: (r) => r.leads },
    {
      key: "cac",
      label: "CAC",
      align: "right",
      render: (r) => (r.leads > 0 ? brl(r.gasto / r.leads) : "—"),
    },
    {
      key: "status",
      label: "Status",
      render: (r) => <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>,
    },
    {
      key: "acoes",
      label: "",
      align: "right",
      render: (r) => (
        <Button tone="ghost" size="sm" onClick={() => abrirEdicao(r)}>Editar</Button>
      ),
    },
  ];

  const colsCanais: Column<{ id: string; canal: string; gasto: number; leads: number; cac: number }>[] = [
    { key: "canal", label: "Canal", render: (r) => <strong>{r.canal}</strong> },
    { key: "gasto", label: "Investimento", align: "right", render: (r) => brl(r.gasto) },
    { key: "leads", label: "Leads", align: "right", render: (r) => r.leads },
    { key: "cac", label: "CAC", align: "right", render: (r) => (r.leads > 0 ? brl(r.cac) : "—") },
  ];

  return (
    <div>
      <PageHeader
        title="Marketing"
        subtitle="Campanhas, investimento e geração de leads"
        actions={<Button tone="green" onClick={abrirNovo}>+ Nova campanha</Button>}
      />

      <KpiGrid>
        <Kpi label="Investimento total" value={brl(investimento)} icon="💸" tone="purple" hint="Gasto acumulado" />
        <Kpi label="Leads gerados" value={totalLeads} icon="🎯" tone="blue" />
        <Kpi label="CAC médio" value={brl(cac)} icon="🧮" tone="orange" hint="Custo por lead" />
        <Kpi label="Campanhas ativas" value={ativas} icon="🚀" tone="green" hint={`${items.length} no total`} />
      </KpiGrid>

      <Tabs
        tabs={[
          { key: "campanhas", label: "Campanhas" },
          { key: "canais", label: "Canais" },
        ]}
        active={tab}
        onChange={(k) => setTab(k as "campanhas" | "canais")}
      />

      {tab === "campanhas" && (
        <SectionCard>
          <DataTable
            columns={colsCampanhas}
            rows={items}
            empty="Nenhuma campanha cadastrada. Clique em “Nova campanha” para começar."
          />
        </SectionCard>
      )}

      {tab === "canais" && (
        <div className="crm-grid-2">
          <SectionCard title="Leads por canal">
            {barsData.length > 0 ? (
              <MiniBars data={barsData} />
            ) : (
              <div className="crm-empty-inline">Sem dados de leads ainda.</div>
            )}
          </SectionCard>
          <SectionCard title="Desempenho por canal">
            <DataTable columns={colsCanais} rows={porCanal} empty="Sem dados por canal." />
          </SectionCard>
        </div>
      )}

      {/* Modal CRUD */}
      <Modal
        open={open}
        title={editId ? "Editar campanha" : "Nova campanha"}
        onClose={() => setOpen(false)}
        wide
        footer={
          <>
            {editId && <Button tone="danger" onClick={excluir}>Excluir</Button>}
            <span style={{ flex: 1 }} />
            <Button tone="muted" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button tone="green" onClick={salvar} disabled={!form.nome.trim()}>Salvar</Button>
          </>
        }
      >
        <Field label="Nome da campanha">
          <TextInput value={form.nome} onChange={(v) => setForm({ ...form, nome: v })} placeholder="Ex.: Reformas Residenciais SP" />
        </Field>
        <div className="crm-grid-2">
          <Field label="Canal">
            <Select value={form.canal} onChange={(v) => setForm({ ...form, canal: v as Canal })} options={CANAL_OPTS} />
          </Field>
          <Field label="Status">
            <Select value={form.status} onChange={(v) => setForm({ ...form, status: v as StatusCampanha })} options={STATUS_OPTS} />
          </Field>
          <Field label="Orçamento" hint="Em reais">
            <TextInput value={form.orcamento ? String(form.orcamento) : ""} onChange={(v) => setForm({ ...form, orcamento: numField(v) })} type="number" placeholder="0" />
          </Field>
          <Field label="Gasto" hint="Em reais">
            <TextInput value={form.gasto ? String(form.gasto) : ""} onChange={(v) => setForm({ ...form, gasto: numField(v) })} type="number" placeholder="0" />
          </Field>
          <Field label="Leads gerados">
            <TextInput value={form.leads ? String(form.leads) : ""} onChange={(v) => setForm({ ...form, leads: numField(v) })} type="number" placeholder="0" />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
