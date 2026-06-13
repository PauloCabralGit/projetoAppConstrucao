import { useMemo, useState } from "react";
import {
  uid,
  brl,
  useApiCollection,
  CRM_API_BASE,
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

// ═══════════════════════════════════════════════════════════════════════════
// BANNERS externos
// ═══════════════════════════════════════════════════════════════════════════

type AdPlacement = "home" | "jobs";
type AdTarget = "client" | "provider" | "both";

interface AdBanner {
  id: string;
  title: string;
  advertiser_name: string;
  image_url: string;
  link_url: string | null;
  target: AdTarget;
  placement: AdPlacement;
  active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  priority: number;
}

function emptyBannerForm(): Omit<AdBanner, "id"> {
  return { title: "", advertiser_name: "", image_url: "", link_url: null, target: "both", placement: "home", active: false, starts_at: null, ends_at: null, priority: 0 };
}

// ═══════════════════════════════════════════════════════════════════════════
// PRESTADORES PATROCINADOS
// ═══════════════════════════════════════════════════════════════════════════

interface SponsoredProvider {
  id: string;
  provider_id: string;
  categories: string[];
  cities: string[];
  active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  priority: number;
  notes: string;
}

function emptySponsoredForm(): Omit<SponsoredProvider, "id"> {
  return { provider_id: "", categories: [], cities: [], active: false, starts_at: null, ends_at: null, priority: 0, notes: "" };
}

export function MarketingModule({ adminKey }: { adminKey: string }) {
  const { items, add, update, remove } = useApiCollection<Campanha>(`${CRM_API_BASE}/mkt/campanhas`, adminKey);
  void SEED;
  const [tab, setTab] = useState<"campanhas" | "canais" | "banners" | "patrocinados">("campanhas");

  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<Omit<Campanha, "id">>(emptyForm);

  // Banners state
  const { items: banners, add: addBanner, update: updateBanner, remove: removeBanner } =
    useApiCollection<AdBanner>(`${CRM_API_BASE}/mkt/banners`, adminKey);
  const [bannerOpen, setBannerOpen] = useState(false);
  const [bannerEditId, setBannerEditId] = useState<string | null>(null);
  const [bannerForm, setBannerForm] = useState<Omit<AdBanner, "id">>(emptyBannerForm());

  // Patrocinados state
  const { items: sponsored, add: addSponsored, update: updateSponsored, remove: removeSponsored } =
    useApiCollection<SponsoredProvider>(`${CRM_API_BASE}/mkt/sponsored`, adminKey);
  const [sponsoredOpen, setSponsoredOpen] = useState(false);
  const [sponsoredEditId, setSponsoredEditId] = useState<string | null>(null);
  const [sponsoredForm, setSponsoredForm] = useState<Omit<SponsoredProvider, "id">>(emptySponsoredForm());

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
          { key: "banners", label: "Banners" },
          { key: "patrocinados", label: "Patrocinados" },
        ]}
        active={tab}
        onChange={(k) => setTab(k as "campanhas" | "canais" | "banners" | "patrocinados")}
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

      {tab === "banners" && (
        <SectionCard title="Banners externos" actions={<Button tone="green" onClick={() => { setBannerForm(emptyBannerForm()); setBannerEditId(null); setBannerOpen(true); }}>+ Novo banner</Button>}>
          <DataTable
            columns={[
              { key: "title", label: "Título", render: (r: AdBanner) => <strong>{r.title}</strong> },
              { key: "advertiser_name", label: "Anunciante", render: (r: AdBanner) => r.advertiser_name },
              { key: "placement", label: "Posição", render: (r: AdBanner) => <Badge tone="info">{r.placement}</Badge> },
              { key: "target", label: "Público", render: (r: AdBanner) => <Badge tone="purple">{r.target}</Badge> },
              { key: "active", label: "Status", render: (r: AdBanner) => <Badge tone={r.active ? "green" : "gray"}>{r.active ? "Ativo" : "Inativo"}</Badge> },
              { key: "priority", label: "Prioridade", align: "right" as const, render: (r: AdBanner) => r.priority },
              { key: "acoes", label: "", align: "right" as const, render: (r: AdBanner) => <Button tone="ghost" size="sm" onClick={() => { const { id, ...rest } = r; setBannerForm(rest); setBannerEditId(id); setBannerOpen(true); }}>Editar</Button> },
            ]}
            rows={banners}
            empty="Nenhum banner cadastrado."
          />
        </SectionCard>
      )}

      {tab === "patrocinados" && (
        <SectionCard title="Prestadores patrocinados" actions={<Button tone="green" onClick={() => { setSponsoredForm(emptySponsoredForm()); setSponsoredEditId(null); setSponsoredOpen(true); }}>+ Novo patrocínio</Button>}>
          <DataTable
            columns={[
              { key: "provider_id", label: "Provider ID", render: (r: SponsoredProvider) => <code style={{ fontSize: 11 }}>{r.provider_id.slice(0, 8)}…</code> },
              { key: "categories", label: "Categorias", render: (r: SponsoredProvider) => r.categories.join(", ") || "—" },
              { key: "cities", label: "Cidades", render: (r: SponsoredProvider) => r.cities.join(", ") || "—" },
              { key: "active", label: "Status", render: (r: SponsoredProvider) => <Badge tone={r.active ? "green" : "gray"}>{r.active ? "Ativo" : "Inativo"}</Badge> },
              { key: "priority", label: "Prioridade", align: "right" as const, render: (r: SponsoredProvider) => r.priority },
              { key: "acoes", label: "", align: "right" as const, render: (r: SponsoredProvider) => <Button tone="ghost" size="sm" onClick={() => { const { id, ...rest } = r; setSponsoredForm(rest); setSponsoredEditId(id); setSponsoredOpen(true); }}>Editar</Button> },
            ]}
            rows={sponsored}
            empty="Nenhum prestador patrocinado."
          />
        </SectionCard>
      )}

      {/* Modal Banner */}
      <Modal
        open={bannerOpen}
        title={bannerEditId ? "Editar banner" : "Novo banner"}
        onClose={() => setBannerOpen(false)}
        wide
        footer={
          <>
            {bannerEditId && <Button tone="danger" onClick={() => { if (bannerEditId) removeBanner(bannerEditId); setBannerOpen(false); }}>Excluir</Button>}
            <span style={{ flex: 1 }} />
            <Button tone="muted" onClick={() => setBannerOpen(false)}>Cancelar</Button>
            <Button tone="green" onClick={() => { if (!bannerForm.title.trim() || !bannerForm.image_url.trim()) return; bannerEditId ? updateBanner(bannerEditId, bannerForm) : addBanner(bannerForm); setBannerOpen(false); }} disabled={!bannerForm.title.trim() || !bannerForm.image_url.trim()}>Salvar</Button>
          </>
        }
      >
        <Field label="Título">
          <TextInput value={bannerForm.title} onChange={(v) => setBannerForm({ ...bannerForm, title: v })} placeholder="Ex.: Promoção Tintas Suvinil" />
        </Field>
        <Field label="Anunciante">
          <TextInput value={bannerForm.advertiser_name} onChange={(v) => setBannerForm({ ...bannerForm, advertiser_name: v })} placeholder="Nome do anunciante" />
        </Field>
        <Field label="URL da imagem" hint="Deve começar com https://">
          <TextInput value={bannerForm.image_url} onChange={(v) => setBannerForm({ ...bannerForm, image_url: v })} placeholder="https://cdn.anunciante.com/banner.jpg" />
        </Field>
        <Field label="URL de destino (opcional)">
          <TextInput value={bannerForm.link_url ?? ""} onChange={(v) => setBannerForm({ ...bannerForm, link_url: v || null })} placeholder="https://anunciante.com/oferta" />
        </Field>
        <div className="crm-grid-2">
          <Field label="Posição">
            <Select value={bannerForm.placement} onChange={(v) => setBannerForm({ ...bannerForm, placement: v as AdPlacement })} options={[{ value: "home", label: "Home (cliente)" }, { value: "jobs", label: "Chamados (prestador)" }]} />
          </Field>
          <Field label="Público">
            <Select value={bannerForm.target} onChange={(v) => setBannerForm({ ...bannerForm, target: v as AdTarget })} options={[{ value: "client", label: "Cliente" }, { value: "provider", label: "Prestador" }, { value: "both", label: "Ambos" }]} />
          </Field>
          <Field label="Prioridade" hint="Maior = aparece primeiro">
            <TextInput value={String(bannerForm.priority)} onChange={(v) => setBannerForm({ ...bannerForm, priority: Number(v) || 0 })} type="number" placeholder="0" />
          </Field>
          <Field label="Status">
            <Select value={bannerForm.active ? "true" : "false"} onChange={(v) => setBannerForm({ ...bannerForm, active: v === "true" })} options={[{ value: "false", label: "Inativo" }, { value: "true", label: "Ativo" }]} />
          </Field>
          <Field label="Início (opcional)">
            <TextInput value={bannerForm.starts_at ?? ""} onChange={(v) => setBannerForm({ ...bannerForm, starts_at: v || null })} type="datetime-local" />
          </Field>
          <Field label="Fim (opcional)">
            <TextInput value={bannerForm.ends_at ?? ""} onChange={(v) => setBannerForm({ ...bannerForm, ends_at: v || null })} type="datetime-local" />
          </Field>
        </div>
      </Modal>

      {/* Modal Patrocinado */}
      <Modal
        open={sponsoredOpen}
        title={sponsoredEditId ? "Editar patrocínio" : "Novo patrocínio"}
        onClose={() => setSponsoredOpen(false)}
        wide
        footer={
          <>
            {sponsoredEditId && <Button tone="danger" onClick={() => { if (sponsoredEditId) removeSponsored(sponsoredEditId); setSponsoredOpen(false); }}>Excluir</Button>}
            <span style={{ flex: 1 }} />
            <Button tone="muted" onClick={() => setSponsoredOpen(false)}>Cancelar</Button>
            <Button tone="green" onClick={() => { if (!sponsoredForm.provider_id.trim()) return; sponsoredEditId ? updateSponsored(sponsoredEditId, sponsoredForm) : addSponsored(sponsoredForm); setSponsoredOpen(false); }} disabled={!sponsoredForm.provider_id.trim()}>Salvar</Button>
          </>
        }
      >
        <Field label="Provider ID (UUID)" hint="Copie da aba Prestadores">
          <TextInput value={sponsoredForm.provider_id} onChange={(v) => setSponsoredForm({ ...sponsoredForm, provider_id: v })} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
        </Field>
        <div className="crm-grid-2">
          <Field label="Categorias" hint="Separadas por vírgula">
            <TextInput value={sponsoredForm.categories.join(", ")} onChange={(v) => setSponsoredForm({ ...sponsoredForm, categories: v.split(",").map(s => s.trim()).filter(Boolean) })} placeholder="hidraulica, eletrica" />
          </Field>
          <Field label="Cidades" hint="Separadas por vírgula">
            <TextInput value={sponsoredForm.cities.join(", ")} onChange={(v) => setSponsoredForm({ ...sponsoredForm, cities: v.split(",").map(s => s.trim()).filter(Boolean) })} placeholder="São Paulo, Campinas" />
          </Field>
          <Field label="Prioridade">
            <TextInput value={String(sponsoredForm.priority)} onChange={(v) => setSponsoredForm({ ...sponsoredForm, priority: Number(v) || 0 })} type="number" placeholder="0" />
          </Field>
          <Field label="Status">
            <Select value={sponsoredForm.active ? "true" : "false"} onChange={(v) => setSponsoredForm({ ...sponsoredForm, active: v === "true" })} options={[{ value: "false", label: "Inativo" }, { value: "true", label: "Ativo" }]} />
          </Field>
          <Field label="Início (opcional)">
            <TextInput value={sponsoredForm.starts_at ?? ""} onChange={(v) => setSponsoredForm({ ...sponsoredForm, starts_at: v || null })} type="datetime-local" />
          </Field>
          <Field label="Fim (opcional)">
            <TextInput value={sponsoredForm.ends_at ?? ""} onChange={(v) => setSponsoredForm({ ...sponsoredForm, ends_at: v || null })} type="datetime-local" />
          </Field>
        </div>
        <Field label="Notas internas">
          <TextInput value={sponsoredForm.notes} onChange={(v) => setSponsoredForm({ ...sponsoredForm, notes: v })} placeholder="Ex.: Contrato #123, renova em Jan/27" />
        </Field>
      </Modal>

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
