import { useMemo, useState } from "react";
import {
  uid, brl, dateBR, todayISO,
  useApiCollection, CRM_API_BASE,
  PageHeader, KpiGrid, Kpi,
  Toolbar, SearchInput, Select,
  Badge, DataTable, type Column,
  Button, Modal, Field, TextInput, Textarea,
  Tabs, Empty, ProgressBar, SectionCard,
} from "../kit";

// ════════════════════════════════════════════════════════════════════════════
// Módulo Jurídico — Contratos, Compliance/LGPD e Disputas
// ════════════════════════════════════════════════════════════════════════════

// ── Tipos ───────────────────────────────────────────────────────────────────

type ContratoTipo =
  | "Termos de Uso"
  | "Política de Privacidade"
  | "Contrato Prestador"
  | "Contrato Cliente"
  | "NDA"
  | "Fornecedor";

type ContratoStatus = "vigente" | "em revisão" | "expirado";

interface Contrato {
  id: string;
  tipo: ContratoTipo;
  contraparte: string;
  status: ContratoStatus;
  inicio: string; // ISO
  fim: string; // ISO
  valor: number; // 0 quando não houver
  obs: string;
}

type ComplianceStatus = "conforme" | "pendente" | "não aplicável";

interface ComplianceItem {
  id: string;
  titulo: string;
  descricao: string;
  status: ComplianceStatus;
}

type DisputaTipo = "trabalhista" | "cível" | "consumidor" | "contratual";
type DisputaStatus = "aberto" | "em andamento" | "acordo" | "encerrado";

interface Disputa {
  id: string;
  parte: string;
  tipo: DisputaTipo;
  status: DisputaStatus;
  valor: number;
  advogado: string;
  obs: string;
}

// ── Seeds ───────────────────────────────────────────────────────────────────

const CONTRATOS_SEED: Contrato[] = [
  { id: uid(), tipo: "Termos de Uso", contraparte: "ConstruConnect (plataforma)", status: "vigente", inicio: "2025-01-10", fim: "2027-01-10", valor: 0, obs: "Versão 3.1 publicada no app e site." },
  { id: uid(), tipo: "Política de Privacidade", contraparte: "ConstruConnect (plataforma)", status: "em revisão", inicio: "2025-01-10", fim: "2026-06-20", valor: 0, obs: "Atualização para adequação a alterações na ANPD." },
  { id: uid(), tipo: "Contrato Prestador", contraparte: "Marcos Pereira Reformas ME", status: "vigente", inicio: "2026-02-01", fim: "2027-02-01", valor: 0, obs: "Adesão padrão de prestador autônomo." },
  { id: uid(), tipo: "Contrato Cliente", contraparte: "Condomínio Vila das Palmeiras", status: "vigente", inicio: "2026-03-15", fim: "2026-09-15", valor: 48000, obs: "Pacote de manutenção predial recorrente." },
  { id: uid(), tipo: "Fornecedor", contraparte: "Cimento Brasil Distribuidora S/A", status: "vigente", inicio: "2025-11-01", fim: "2026-06-15", valor: 120000, obs: "Fornecimento de cimento e argamassa." },
  { id: uid(), tipo: "NDA", contraparte: "Pagsmile Tecnologia (gateway)", status: "vigente", inicio: "2025-08-01", fim: "2027-08-01", valor: 0, obs: "Sigilo sobre dados de integração de pagamentos." },
  { id: uid(), tipo: "Contrato Prestador", contraparte: "Eletro Souza Instalações", status: "expirado", inicio: "2024-04-01", fim: "2025-04-01", valor: 0, obs: "Pendente de renovação de adesão." },
];

const COMPLIANCE_SEED: ComplianceItem[] = [
  { id: uid(), titulo: "Consentimento LGPD", descricao: "Coleta de consentimento explícito do titular no cadastro de clientes e prestadores.", status: "conforme" },
  { id: uid(), titulo: "Política de Privacidade publicada", descricao: "Documento acessível no app e no site, com base legal de cada tratamento.", status: "conforme" },
  { id: uid(), titulo: "Registro de tratamento de dados (ROPA)", descricao: "Mapeamento das operações de tratamento e finalidades.", status: "pendente" },
  { id: uid(), titulo: "Canal do titular (DPO)", descricao: "Canal de atendimento ao titular e encarregado (DPO) designado.", status: "pendente" },
  { id: uid(), titulo: "Retenção e anonimização", descricao: "Política de prazos de retenção e anonimização de dados de obras concluídas.", status: "conforme" },
  { id: uid(), titulo: "Termos de uso aceitos no cadastro", descricao: "Aceite registrado com data/hora no fluxo de onboarding.", status: "conforme" },
  { id: uid(), titulo: "Contrato com MercadoPago", descricao: "Contrato de processamento de pagamentos e repasse a prestadores.", status: "conforme" },
  { id: uid(), titulo: "NF emitida", descricao: "Emissão de nota fiscal de serviço sobre as comissões da plataforma.", status: "pendente" },
];

const DISPUTAS_SEED: Disputa[] = [
  { id: uid(), parte: "José da Silva (ex-prestador)", tipo: "trabalhista", status: "em andamento", valor: 32000, advogado: "Dra. Helena Martins", obs: "Pedido de vínculo empregatício — defesa de não-subordinação." },
  { id: uid(), parte: "Cliente Ana Ribeiro", tipo: "consumidor", status: "acordo", valor: 4500, advogado: "Dr. Rodrigo Alves", obs: "Reclamação por atraso na entrega de reforma; acordo homologado." },
  { id: uid(), parte: "Aço Forte Ltda (fornecedor)", tipo: "contratual", status: "aberto", valor: 18700, advogado: "Dra. Helena Martins", obs: "Divergência de entrega e cobrança de multa contratual." },
  { id: uid(), parte: "Construtora Andrade", tipo: "cível", status: "encerrado", valor: 0, advogado: "Dr. Rodrigo Alves", obs: "Ação de cobrança encerrada por pagamento integral." },
];

// ── Opções ──────────────────────────────────────────────────────────────────

const CONTRATO_TIPOS: ContratoTipo[] = ["Termos de Uso", "Política de Privacidade", "Contrato Prestador", "Contrato Cliente", "NDA", "Fornecedor"];
const CONTRATO_STATUS: ContratoStatus[] = ["vigente", "em revisão", "expirado"];
const COMPLIANCE_STATUS: ComplianceStatus[] = ["conforme", "pendente", "não aplicável"];
const DISPUTA_TIPOS: DisputaTipo[] = ["trabalhista", "cível", "consumidor", "contratual"];
const DISPUTA_STATUS: DisputaStatus[] = ["aberto", "em andamento", "acordo", "encerrado"];

const opts = (arr: string[]) => arr.map((v) => ({ value: v, label: v.charAt(0).toUpperCase() + v.slice(1) }));

function contratoTone(s: ContratoStatus): "green" | "orange" | "red" {
  return s === "vigente" ? "green" : s === "em revisão" ? "orange" : "red";
}
function complianceTone(s: ComplianceStatus): "green" | "orange" | "gray" {
  return s === "conforme" ? "green" : s === "pendente" ? "orange" : "gray";
}
function disputaTone(s: DisputaStatus): "blue" | "orange" | "green" | "gray" {
  return s === "aberto" ? "blue" : s === "em andamento" ? "orange" : s === "acordo" ? "green" : "gray";
}

function daysUntil(iso: string): number {
  const d = new Date(iso).getTime();
  return Math.ceil((d - Date.now()) / (1000 * 60 * 60 * 24));
}

// ════════════════════════════════════════════════════════════════════════════

export function JuridicoModule({ adminKey }: { adminKey: string }) {
  const [tab, setTab] = useState("contratos");

  return (
    <div>
      <PageHeader title="Jurídico" subtitle="Contratos, conformidade LGPD e gestão de disputas" />
      <Tabs
        tabs={[
          { key: "contratos", label: "Contratos" },
          { key: "compliance", label: "Compliance/LGPD" },
          { key: "disputas", label: "Disputas" },
        ]}
        active={tab}
        onChange={setTab}
      />
      <div style={{ marginTop: 16 }}>
        {tab === "contratos" && <ContratosTab adminKey={adminKey} />}
        {tab === "compliance" && <ComplianceTab adminKey={adminKey} />}
        {tab === "disputas" && <DisputasTab adminKey={adminKey} />}
      </div>
    </div>
  );
}

// ── Aba Contratos ─────────────────────────────────────────────────────────────

const emptyContrato = (): Omit<Contrato, "id"> => ({
  tipo: "Contrato Prestador", contraparte: "", status: "vigente",
  inicio: todayISO(), fim: todayISO(), valor: 0, obs: "",
});

function ContratosTab({ adminKey }: { adminKey: string }) {
  const { items, add, update, remove } = useApiCollection<Contrato>(`${CRM_API_BASE}/jur/contratos`, adminKey);
  void CONTRATOS_SEED;
  const [busca, setBusca] = useState("");
  const [filtroStatus, setFiltroStatus] = useState("todos");
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<Omit<Contrato, "id">>(emptyContrato());

  const kpis = useMemo(() => {
    const vigentes = items.filter((c) => c.status === "vigente").length;
    const revisao = items.filter((c) => c.status === "em revisão").length;
    const expirando = items.filter((c) => {
      if (c.status === "expirado") return false;
      const d = daysUntil(c.fim);
      return d >= 0 && d <= 30;
    }).length;
    return { vigentes, revisao, expirando };
  }, [items]);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return items.filter((c) => {
      if (filtroStatus !== "todos" && c.status !== filtroStatus) return false;
      if (!q) return true;
      return c.contraparte.toLowerCase().includes(q) || c.tipo.toLowerCase().includes(q);
    });
  }, [items, busca, filtroStatus]);

  function novo() { setEditId(null); setForm(emptyContrato()); setOpen(true); }
  function editar(c: Contrato) {
    setEditId(c.id);
    const { id, ...rest } = c;
    setForm(rest);
    setOpen(true);
  }
  function salvar() {
    if (!form.contraparte.trim()) return;
    if (editId) update(editId, form);
    else add(form);
    setOpen(false);
  }

  const columns: Column<Contrato>[] = [
    { key: "tipo", label: "Tipo", render: (r) => <strong>{r.tipo}</strong> },
    { key: "contraparte", label: "Contraparte" },
    { key: "status", label: "Status", render: (r) => <Badge tone={contratoTone(r.status)}>{r.status}</Badge> },
    { key: "vigencia", label: "Vigência", render: (r) => `${dateBR(r.inicio)} → ${dateBR(r.fim)}` },
    { key: "valor", label: "Valor", align: "right", render: (r) => (r.valor > 0 ? brl(r.valor) : "—") },
    {
      key: "acoes", label: "Ações", align: "right", render: (r) => (
        <span style={{ display: "inline-flex", gap: 6 }}>
          <Button size="sm" tone="muted" onClick={() => editar(r)}>Editar</Button>
          <Button size="sm" tone="danger" onClick={() => remove(r.id)}>Excluir</Button>
        </span>
      ),
    },
  ];

  return (
    <div>
      <KpiGrid>
        <Kpi label="Contratos vigentes" value={kpis.vigentes} icon="📄" tone="green" />
        <Kpi label="Em revisão" value={kpis.revisao} icon="✏️" tone="orange" />
        <Kpi label="Expirando em 30 dias" value={kpis.expirando} icon="⏳" tone="red" hint="Vigência terminando" />
      </KpiGrid>

      <SectionCard
        title="Contratos"
        actions={<Button tone="green" onClick={novo}>+ Novo contrato</Button>}
      >
        <Toolbar>
          <SearchInput value={busca} onChange={setBusca} placeholder="Buscar por contraparte ou tipo..." />
          <Select
            value={filtroStatus}
            onChange={setFiltroStatus}
            options={[{ value: "todos", label: "Todos os status" }, ...opts(CONTRATO_STATUS)]}
          />
        </Toolbar>
        <DataTable columns={columns} rows={filtrados} empty="Nenhum contrato cadastrado." />
      </SectionCard>

      <Modal
        open={open}
        title={editId ? "Editar contrato" : "Novo contrato"}
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button tone="muted" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button tone="green" onClick={salvar}>Salvar</Button>
          </>
        }
      >
        <div className="crm-grid-2">
          <Field label="Tipo">
            <Select value={form.tipo} onChange={(v) => setForm({ ...form, tipo: v as ContratoTipo })} options={opts(CONTRATO_TIPOS)} />
          </Field>
          <Field label="Status">
            <Select value={form.status} onChange={(v) => setForm({ ...form, status: v as ContratoStatus })} options={opts(CONTRATO_STATUS)} />
          </Field>
        </div>
        <Field label="Contraparte">
          <TextInput value={form.contraparte} onChange={(v) => setForm({ ...form, contraparte: v })} placeholder="Nome da contraparte" />
        </Field>
        <div className="crm-grid-2">
          <Field label="Início da vigência">
            <TextInput type="date" value={form.inicio} onChange={(v) => setForm({ ...form, inicio: v })} />
          </Field>
          <Field label="Fim da vigência">
            <TextInput type="date" value={form.fim} onChange={(v) => setForm({ ...form, fim: v })} />
          </Field>
        </div>
        <Field label="Valor (R$)" hint="Deixe 0 quando não houver valor associado.">
          <TextInput type="number" value={String(form.valor)} onChange={(v) => setForm({ ...form, valor: Number(v) || 0 })} />
        </Field>
        <Field label="Observações">
          <Textarea value={form.obs} onChange={(v) => setForm({ ...form, obs: v })} placeholder="Detalhes do contrato" />
        </Field>
      </Modal>
    </div>
  );
}

// ── Aba Compliance/LGPD ────────────────────────────────────────────────────────

const emptyCompliance = (): Omit<ComplianceItem, "id"> => ({ titulo: "", descricao: "", status: "pendente" });

function ComplianceTab({ adminKey }: { adminKey: string }) {
  const { items, add, update, remove } = useApiCollection<ComplianceItem>(`${CRM_API_BASE}/jur/compliance`, adminKey);
  void COMPLIANCE_SEED;
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<Omit<ComplianceItem, "id">>(emptyCompliance());

  const aplicaveis = items.filter((i) => i.status !== "não aplicável");
  const conformes = items.filter((i) => i.status === "conforme").length;
  const pct = aplicaveis.length > 0 ? Math.round((conformes / aplicaveis.length) * 100) : 0;

  function ciclaStatus(i: ComplianceItem) {
    const ordem: ComplianceStatus[] = ["conforme", "pendente", "não aplicável"];
    const prox = ordem[(ordem.indexOf(i.status) + 1) % ordem.length];
    update(i.id, { status: prox });
  }

  function novo() { setEditId(null); setForm(emptyCompliance()); setOpen(true); }
  function editar(i: ComplianceItem) {
    setEditId(i.id);
    const { id, ...rest } = i;
    setForm(rest);
    setOpen(true);
  }
  function salvar() {
    if (!form.titulo.trim()) return;
    if (editId) update(editId, form);
    else add(form);
    setOpen(false);
  }

  return (
    <div>
      <KpiGrid>
        <Kpi label="Itens conformes" value={conformes} icon="✅" tone="green" />
        <Kpi label="Pendentes" value={items.filter((i) => i.status === "pendente").length} icon="⚠️" tone="orange" />
        <Kpi label="% de conformidade" value={`${pct}%`} icon="📊" tone="blue" hint={`${conformes}/${aplicaveis.length} aplicáveis`} />
      </KpiGrid>

      <SectionCard
        title="Checklist de conformidade (LGPD)"
        actions={<Button tone="green" onClick={novo}>+ Novo item</Button>}
      >
        <div style={{ marginBottom: 12 }}>
          <ProgressBar value={conformes} max={aplicaveis.length} tone={pct >= 80 ? "green" : pct >= 50 ? "orange" : "red"} />
        </div>
        {items.length === 0 ? (
          <Empty icon="📋" title="Nenhum item de conformidade" hint="Adicione itens ao checklist." />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {items.map((i) => (
              <div key={i.id} className="crm-card" style={{ display: "flex", gap: 12, alignItems: "flex-start", justifyContent: "space-between" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <strong>{i.titulo}</strong>
                    <Badge tone={complianceTone(i.status)}>{i.status}</Badge>
                  </div>
                  <p className="crm-subtitle" style={{ margin: 0 }}>{i.descricao}</p>
                </div>
                <span style={{ display: "inline-flex", gap: 6, flexShrink: 0 }}>
                  <Button size="sm" tone="muted" onClick={() => ciclaStatus(i)}>Alternar status</Button>
                  <Button size="sm" tone="muted" onClick={() => editar(i)}>Editar</Button>
                  <Button size="sm" tone="danger" onClick={() => remove(i.id)}>Excluir</Button>
                </span>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <Modal
        open={open}
        title={editId ? "Editar item" : "Novo item de conformidade"}
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button tone="muted" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button tone="green" onClick={salvar}>Salvar</Button>
          </>
        }
      >
        <Field label="Título">
          <TextInput value={form.titulo} onChange={(v) => setForm({ ...form, titulo: v })} placeholder="Ex.: Registro de tratamento de dados" />
        </Field>
        <Field label="Descrição">
          <Textarea value={form.descricao} onChange={(v) => setForm({ ...form, descricao: v })} />
        </Field>
        <Field label="Status">
          <Select value={form.status} onChange={(v) => setForm({ ...form, status: v as ComplianceStatus })} options={opts(COMPLIANCE_STATUS)} />
        </Field>
      </Modal>
    </div>
  );
}

// ── Aba Disputas ──────────────────────────────────────────────────────────────

const emptyDisputa = (): Omit<Disputa, "id"> => ({
  parte: "", tipo: "cível", status: "aberto", valor: 0, advogado: "", obs: "",
});

function DisputasTab({ adminKey }: { adminKey: string }) {
  const { items, add, update, remove } = useApiCollection<Disputa>(`${CRM_API_BASE}/jur/disputas`, adminKey);
  void DISPUTAS_SEED;
  const [busca, setBusca] = useState("");
  const [filtroStatus, setFiltroStatus] = useState("todos");
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<Omit<Disputa, "id">>(emptyDisputa());

  const kpis = useMemo(() => {
    const abertas = items.filter((d) => d.status === "aberto" || d.status === "em andamento").length;
    const total = items.reduce((s, d) => s + (d.valor || 0), 0);
    const acordos = items.filter((d) => d.status === "acordo").length;
    return { abertas, total, acordos };
  }, [items]);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return items.filter((d) => {
      if (filtroStatus !== "todos" && d.status !== filtroStatus) return false;
      if (!q) return true;
      return d.parte.toLowerCase().includes(q) || d.advogado.toLowerCase().includes(q) || d.tipo.toLowerCase().includes(q);
    });
  }, [items, busca, filtroStatus]);

  function novo() { setEditId(null); setForm(emptyDisputa()); setOpen(true); }
  function editar(d: Disputa) {
    setEditId(d.id);
    const { id, ...rest } = d;
    setForm(rest);
    setOpen(true);
  }
  function salvar() {
    if (!form.parte.trim()) return;
    if (editId) update(editId, form);
    else add(form);
    setOpen(false);
  }

  const columns: Column<Disputa>[] = [
    { key: "parte", label: "Parte", render: (r) => <strong>{r.parte}</strong> },
    { key: "tipo", label: "Tipo", render: (r) => <Badge tone="purple">{r.tipo}</Badge> },
    { key: "status", label: "Status", render: (r) => <Badge tone={disputaTone(r.status)}>{r.status}</Badge> },
    { key: "valor", label: "Valor envolvido", align: "right", render: (r) => (r.valor > 0 ? brl(r.valor) : "—") },
    { key: "advogado", label: "Advogado(a)" },
    {
      key: "acoes", label: "Ações", align: "right", render: (r) => (
        <span style={{ display: "inline-flex", gap: 6 }}>
          <Button size="sm" tone="muted" onClick={() => editar(r)}>Editar</Button>
          <Button size="sm" tone="danger" onClick={() => remove(r.id)}>Excluir</Button>
        </span>
      ),
    },
  ];

  return (
    <div>
      <KpiGrid>
        <Kpi label="Processos em aberto" value={kpis.abertas} icon="⚖️" tone="red" />
        <Kpi label="Acordos" value={kpis.acordos} icon="🤝" tone="green" />
        <Kpi label="Valor total envolvido" value={brl(kpis.total)} icon="💰" tone="orange" />
      </KpiGrid>

      <SectionCard
        title="Processos e disputas"
        actions={<Button tone="green" onClick={novo}>+ Nova disputa</Button>}
      >
        <Toolbar>
          <SearchInput value={busca} onChange={setBusca} placeholder="Buscar por parte, advogado ou tipo..." />
          <Select
            value={filtroStatus}
            onChange={setFiltroStatus}
            options={[{ value: "todos", label: "Todos os status" }, ...opts(DISPUTA_STATUS)]}
          />
        </Toolbar>
        <DataTable columns={columns} rows={filtrados} empty="Nenhuma disputa registrada." />
      </SectionCard>

      <Modal
        open={open}
        title={editId ? "Editar disputa" : "Nova disputa"}
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button tone="muted" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button tone="green" onClick={salvar}>Salvar</Button>
          </>
        }
      >
        <Field label="Parte">
          <TextInput value={form.parte} onChange={(v) => setForm({ ...form, parte: v })} placeholder="Nome da parte envolvida" />
        </Field>
        <div className="crm-grid-2">
          <Field label="Tipo">
            <Select value={form.tipo} onChange={(v) => setForm({ ...form, tipo: v as DisputaTipo })} options={opts(DISPUTA_TIPOS)} />
          </Field>
          <Field label="Status">
            <Select value={form.status} onChange={(v) => setForm({ ...form, status: v as DisputaStatus })} options={opts(DISPUTA_STATUS)} />
          </Field>
        </div>
        <div className="crm-grid-2">
          <Field label="Valor envolvido (R$)">
            <TextInput type="number" value={String(form.valor)} onChange={(v) => setForm({ ...form, valor: Number(v) || 0 })} />
          </Field>
          <Field label="Advogado(a)">
            <TextInput value={form.advogado} onChange={(v) => setForm({ ...form, advogado: v })} placeholder="Responsável" />
          </Field>
        </div>
        <Field label="Observações">
          <Textarea value={form.obs} onChange={(v) => setForm({ ...form, obs: v })} />
        </Field>
      </Modal>
    </div>
  );
}
