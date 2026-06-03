import { useMemo, useState } from "react";
import {
  uid, brl, dateBR, todayISO,
  useApiCollection, CRM_API_BASE,
  PageHeader, KpiGrid, Kpi,
  Toolbar, SearchInput, Select,
  Badge, DataTable, type Column,
  Button, Modal, Field, TextInput, Textarea,
  Tabs, SectionCard,
} from "../kit";

// ════════════════════════════════════════════════════════════════════════════
// Módulo Fornecedores & Estoque — Fornecedores, Estoque/Insumos e Cotações
// ════════════════════════════════════════════════════════════════════════════

// ── Tipos ───────────────────────────────────────────────────────────────────

type Categoria = "cimento" | "aço" | "elétrica" | "hidráulica" | "ferramentas" | "EPI" | "madeira";

interface Fornecedor {
  id: string;
  nome: string;
  cnpj: string;
  categoria: Categoria;
  contato: string;
  telefone: string;
  cidade: string;
  avaliacao: number; // 1-5
}

interface Insumo {
  id: string;
  item: string;
  categoria: Categoria;
  quantidade: number;
  unidade: string;
  minimo: number;
  custo: number; // custo unitário
}

type CotacaoStatus = "solicitada" | "recebida" | "aprovada" | "recusada";

interface Cotacao {
  id: string;
  item: string;
  fornecedor: string;
  valor: number;
  prazo: string; // ISO data prevista de entrega
  status: CotacaoStatus;
}

// ── Seeds ───────────────────────────────────────────────────────────────────

const FORNECEDORES_SEED: Fornecedor[] = [
  { id: uid(), nome: "Cimento Brasil Distribuidora S/A", cnpj: "12.345.678/0001-90", categoria: "cimento", contato: "Roberto Lima", telefone: "(11) 3344-5566", cidade: "São Paulo/SP", avaliacao: 5 },
  { id: uid(), nome: "Aço Forte Ltda", cnpj: "98.765.432/0001-21", categoria: "aço", contato: "Marina Costa", telefone: "(11) 2233-4455", cidade: "Guarulhos/SP", avaliacao: 4 },
  { id: uid(), nome: "Elétrica Total Materiais", cnpj: "45.678.123/0001-55", categoria: "elétrica", contato: "Carlos Souza", telefone: "(21) 3211-8899", cidade: "Rio de Janeiro/RJ", avaliacao: 4 },
  { id: uid(), nome: "HidroMax Hidráulica", cnpj: "33.222.111/0001-44", categoria: "hidráulica", contato: "Fernanda Reis", telefone: "(31) 3055-7788", cidade: "Belo Horizonte/MG", avaliacao: 3 },
  { id: uid(), nome: "FerraTools Equipamentos", cnpj: "77.888.999/0001-10", categoria: "ferramentas", contato: "Pedro Almeida", telefone: "(41) 3399-2211", cidade: "Curitiba/PR", avaliacao: 5 },
  { id: uid(), nome: "Segura EPI Distribuidora", cnpj: "22.333.444/0001-66", categoria: "EPI", contato: "Juliana Mota", telefone: "(11) 4002-8922", cidade: "Osasco/SP", avaliacao: 4 },
  { id: uid(), nome: "Madeireira Pinho Verde", cnpj: "55.666.777/0001-33", categoria: "madeira", contato: "Antônio Ferraz", telefone: "(47) 3644-1100", cidade: "Joinville/SC", avaliacao: 3 },
];

const ESTOQUE_SEED: Insumo[] = [
  { id: uid(), item: "Saco de cimento CP-II 50kg", categoria: "cimento", quantidade: 120, unidade: "sc", minimo: 50, custo: 34.9 },
  { id: uid(), item: "Vergalhão aço CA-50 10mm", categoria: "aço", quantidade: 18, unidade: "barra", minimo: 40, custo: 62.5 },
  { id: uid(), item: "Cabo flexível 2,5mm² (rolo 100m)", categoria: "elétrica", quantidade: 8, unidade: "rolo", minimo: 5, custo: 189.0 },
  { id: uid(), item: "Tubo PVC esgoto 100mm (6m)", categoria: "hidráulica", quantidade: 35, unidade: "barra", minimo: 20, custo: 78.0 },
  { id: uid(), item: "Furadeira de impacto 750W", categoria: "ferramentas", quantidade: 4, unidade: "un", minimo: 6, custo: 349.0 },
  { id: uid(), item: "Capacete de segurança classe B", categoria: "EPI", quantidade: 60, unidade: "un", minimo: 30, custo: 22.5 },
  { id: uid(), item: "Luva de raspa cano longo", categoria: "EPI", quantidade: 12, unidade: "par", minimo: 25, custo: 14.9 },
  { id: uid(), item: "Tábua de pinus 30cm (2,5m)", categoria: "madeira", quantidade: 90, unidade: "un", minimo: 40, custo: 41.0 },
];

const COTACOES_SEED: Cotacao[] = [
  { id: uid(), item: "Vergalhão aço CA-50 10mm (50 barras)", fornecedor: "Aço Forte Ltda", valor: 3125, prazo: "2026-06-12", status: "recebida" },
  { id: uid(), item: "Furadeira de impacto 750W (4 un)", fornecedor: "FerraTools Equipamentos", valor: 1396, prazo: "2026-06-08", status: "aprovada" },
  { id: uid(), item: "Luva de raspa cano longo (30 pares)", fornecedor: "Segura EPI Distribuidora", valor: 447, prazo: "2026-06-10", status: "solicitada" },
  { id: uid(), item: "Saco de cimento CP-II 50kg (100 sc)", fornecedor: "Cimento Brasil Distribuidora S/A", valor: 3490, prazo: "2026-06-15", status: "recusada" },
];

// ── Opções / helpers ───────────────────────────────────────────────────────

const CATEGORIAS: Categoria[] = ["cimento", "aço", "elétrica", "hidráulica", "ferramentas", "EPI", "madeira"];
const COTACAO_STATUS: CotacaoStatus[] = ["solicitada", "recebida", "aprovada", "recusada"];

const opts = (arr: string[]) => arr.map((v) => ({ value: v, label: v.charAt(0).toUpperCase() + v.slice(1) }));

function estrelas(n: number): string {
  const v = Math.max(0, Math.min(5, Math.round(n)));
  return "★".repeat(v) + "☆".repeat(5 - v);
}

function cotacaoTone(s: CotacaoStatus): "blue" | "orange" | "green" | "red" {
  return s === "solicitada" ? "blue" : s === "recebida" ? "orange" : s === "aprovada" ? "green" : "red";
}

// ════════════════════════════════════════════════════════════════════════════

export function FornecedoresModule({ adminKey }: { adminKey: string }) {
  const [tab, setTab] = useState("fornecedores");

  return (
    <div>
      <PageHeader title="Fornecedores & Estoque" subtitle="Cadastro de fornecedores, controle de insumos e cotações" />
      <Tabs
        tabs={[
          { key: "fornecedores", label: "Fornecedores" },
          { key: "estoque", label: "Estoque/Insumos" },
          { key: "cotacoes", label: "Cotações" },
        ]}
        active={tab}
        onChange={setTab}
      />
      <div style={{ marginTop: 16 }}>
        {tab === "fornecedores" && <FornecedoresTab adminKey={adminKey} />}
        {tab === "estoque" && <EstoqueTab adminKey={adminKey} />}
        {tab === "cotacoes" && <CotacoesTab adminKey={adminKey} />}
      </div>
    </div>
  );
}

// ── Aba Fornecedores ───────────────────────────────────────────────────────────

const emptyFornecedor = (): Omit<Fornecedor, "id"> => ({
  nome: "", cnpj: "", categoria: "cimento", contato: "", telefone: "", cidade: "", avaliacao: 3,
});

function FornecedoresTab({ adminKey }: { adminKey: string }) {
  const { items, add, update, remove } = useApiCollection<Fornecedor>(`${CRM_API_BASE}/forn/fornecedores`, adminKey);
  void FORNECEDORES_SEED;
  const [busca, setBusca] = useState("");
  const [filtroCat, setFiltroCat] = useState("todas");
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<Omit<Fornecedor, "id">>(emptyFornecedor());

  const totalCategorias = useMemo(() => new Set(items.map((f) => f.categoria)).size, [items]);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return items.filter((f) => {
      if (filtroCat !== "todas" && f.categoria !== filtroCat) return false;
      if (!q) return true;
      return f.nome.toLowerCase().includes(q) || f.contato.toLowerCase().includes(q) || f.cidade.toLowerCase().includes(q) || f.cnpj.includes(q);
    });
  }, [items, busca, filtroCat]);

  function novo() { setEditId(null); setForm(emptyFornecedor()); setOpen(true); }
  function editar(f: Fornecedor) {
    setEditId(f.id);
    const { id, ...rest } = f;
    setForm(rest);
    setOpen(true);
  }
  function salvar() {
    if (!form.nome.trim()) return;
    if (editId) update(editId, form);
    else add(form);
    setOpen(false);
  }

  const columns: Column<Fornecedor>[] = [
    { key: "nome", label: "Nome", render: (r) => <strong>{r.nome}</strong> },
    { key: "cnpj", label: "CNPJ" },
    { key: "categoria", label: "Categoria", render: (r) => <Badge tone="purple">{r.categoria}</Badge> },
    { key: "contato", label: "Contato" },
    { key: "telefone", label: "Telefone" },
    { key: "cidade", label: "Cidade" },
    { key: "avaliacao", label: "Avaliação", render: (r) => <span style={{ color: "#f5a623", letterSpacing: 1 }}>{estrelas(r.avaliacao)}</span> },
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
        <Kpi label="Total de fornecedores" value={items.length} icon="🏭" tone="blue" />
        <Kpi label="Categorias atendidas" value={totalCategorias} icon="🗂️" tone="purple" hint={`${CATEGORIAS.length} categorias possíveis`} />
        <Kpi label="Avaliação média" value={items.length ? (items.reduce((s, f) => s + f.avaliacao, 0) / items.length).toFixed(1) : "—"} icon="⭐" tone="orange" />
      </KpiGrid>

      <SectionCard
        title="Fornecedores"
        actions={<Button tone="green" onClick={novo}>+ Novo fornecedor</Button>}
      >
        <Toolbar>
          <SearchInput value={busca} onChange={setBusca} placeholder="Buscar por nome, contato, cidade ou CNPJ..." />
          <Select
            value={filtroCat}
            onChange={setFiltroCat}
            options={[{ value: "todas", label: "Todas as categorias" }, ...opts(CATEGORIAS)]}
          />
        </Toolbar>
        <DataTable columns={columns} rows={filtrados} empty="Nenhum fornecedor cadastrado." />
      </SectionCard>

      <Modal
        open={open}
        title={editId ? "Editar fornecedor" : "Novo fornecedor"}
        onClose={() => setOpen(false)}
        wide
        footer={
          <>
            <Button tone="muted" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button tone="green" onClick={salvar}>Salvar</Button>
          </>
        }
      >
        <Field label="Nome / Razão social">
          <TextInput value={form.nome} onChange={(v) => setForm({ ...form, nome: v })} placeholder="Nome do fornecedor" />
        </Field>
        <div className="crm-grid-2">
          <Field label="CNPJ">
            <TextInput value={form.cnpj} onChange={(v) => setForm({ ...form, cnpj: v })} placeholder="00.000.000/0000-00" />
          </Field>
          <Field label="Categoria">
            <Select value={form.categoria} onChange={(v) => setForm({ ...form, categoria: v as Categoria })} options={opts(CATEGORIAS)} />
          </Field>
        </div>
        <div className="crm-grid-2">
          <Field label="Contato">
            <TextInput value={form.contato} onChange={(v) => setForm({ ...form, contato: v })} placeholder="Pessoa de contato" />
          </Field>
          <Field label="Telefone">
            <TextInput value={form.telefone} onChange={(v) => setForm({ ...form, telefone: v })} placeholder="(00) 0000-0000" />
          </Field>
        </div>
        <div className="crm-grid-2">
          <Field label="Cidade">
            <TextInput value={form.cidade} onChange={(v) => setForm({ ...form, cidade: v })} placeholder="Cidade/UF" />
          </Field>
          <Field label="Avaliação (1-5)">
            <Select
              value={String(form.avaliacao)}
              onChange={(v) => setForm({ ...form, avaliacao: Number(v) || 1 })}
              options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `${n} — ${estrelas(n)}` }))}
            />
          </Field>
        </div>
      </Modal>
    </div>
  );
}

// ── Aba Estoque/Insumos ────────────────────────────────────────────────────────

const emptyInsumo = (): Omit<Insumo, "id"> => ({
  item: "", categoria: "cimento", quantidade: 0, unidade: "un", minimo: 0, custo: 0,
});

function EstoqueTab({ adminKey }: { adminKey: string }) {
  const { items, add, update, remove } = useApiCollection<Insumo>(`${CRM_API_BASE}/forn/estoque`, adminKey);
  void ESTOQUE_SEED;
  const [busca, setBusca] = useState("");
  const [filtroCat, setFiltroCat] = useState("todas");
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<Omit<Insumo, "id">>(emptyInsumo());

  const kpis = useMemo(() => {
    const abaixo = items.filter((i) => i.quantidade < i.minimo).length;
    const valorTotal = items.reduce((s, i) => s + i.quantidade * i.custo, 0);
    return { total: items.length, abaixo, valorTotal };
  }, [items]);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return items.filter((i) => {
      if (filtroCat !== "todas" && i.categoria !== filtroCat) return false;
      if (!q) return true;
      return i.item.toLowerCase().includes(q);
    });
  }, [items, busca, filtroCat]);

  function novo() { setEditId(null); setForm(emptyInsumo()); setOpen(true); }
  function editar(i: Insumo) {
    setEditId(i.id);
    const { id, ...rest } = i;
    setForm(rest);
    setOpen(true);
  }
  function salvar() {
    if (!form.item.trim()) return;
    if (editId) update(editId, form);
    else add(form);
    setOpen(false);
  }

  const columns: Column<Insumo>[] = [
    { key: "item", label: "Item", render: (r) => <strong>{r.item}</strong> },
    { key: "categoria", label: "Categoria", render: (r) => <Badge tone="purple">{r.categoria}</Badge> },
    {
      key: "quantidade", label: "Qtd.", align: "right", render: (r) => (
        <span style={{ display: "inline-flex", gap: 6, alignItems: "center", justifyContent: "flex-end" }}>
          {r.quantidade} {r.unidade}
          {r.quantidade < r.minimo && <Badge tone="red">Repor</Badge>}
        </span>
      ),
    },
    { key: "minimo", label: "Mínimo", align: "right", render: (r) => `${r.minimo} ${r.unidade}` },
    { key: "custo", label: "Custo unit.", align: "right", render: (r) => brl(r.custo) },
    { key: "subtotal", label: "Valor em estoque", align: "right", render: (r) => brl(r.quantidade * r.custo) },
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
        <Kpi label="Itens em estoque" value={kpis.total} icon="📦" tone="blue" />
        <Kpi label="Abaixo do mínimo" value={kpis.abaixo} icon="🔻" tone="red" hint="Necessitam reposição" />
        <Kpi label="Valor total do estoque" value={brl(kpis.valorTotal)} icon="💰" tone="green" />
      </KpiGrid>

      <SectionCard
        title="Estoque de insumos"
        actions={<Button tone="green" onClick={novo}>+ Novo insumo</Button>}
      >
        <Toolbar>
          <SearchInput value={busca} onChange={setBusca} placeholder="Buscar insumo..." />
          <Select
            value={filtroCat}
            onChange={setFiltroCat}
            options={[{ value: "todas", label: "Todas as categorias" }, ...opts(CATEGORIAS)]}
          />
        </Toolbar>
        <DataTable columns={columns} rows={filtrados} empty="Nenhum insumo em estoque." />
      </SectionCard>

      <Modal
        open={open}
        title={editId ? "Editar insumo" : "Novo insumo"}
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button tone="muted" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button tone="green" onClick={salvar}>Salvar</Button>
          </>
        }
      >
        <Field label="Item">
          <TextInput value={form.item} onChange={(v) => setForm({ ...form, item: v })} placeholder="Descrição do insumo" />
        </Field>
        <div className="crm-grid-2">
          <Field label="Categoria">
            <Select value={form.categoria} onChange={(v) => setForm({ ...form, categoria: v as Categoria })} options={opts(CATEGORIAS)} />
          </Field>
          <Field label="Unidade">
            <TextInput value={form.unidade} onChange={(v) => setForm({ ...form, unidade: v })} placeholder="un, sc, barra, par..." />
          </Field>
        </div>
        <div className="crm-grid-2">
          <Field label="Quantidade">
            <TextInput type="number" value={String(form.quantidade)} onChange={(v) => setForm({ ...form, quantidade: Number(v) || 0 })} />
          </Field>
          <Field label="Estoque mínimo">
            <TextInput type="number" value={String(form.minimo)} onChange={(v) => setForm({ ...form, minimo: Number(v) || 0 })} />
          </Field>
        </div>
        <Field label="Custo unitário (R$)">
          <TextInput type="number" value={String(form.custo)} onChange={(v) => setForm({ ...form, custo: Number(v) || 0 })} />
        </Field>
      </Modal>
    </div>
  );
}

// ── Aba Cotações ──────────────────────────────────────────────────────────────

const emptyCotacao = (): Omit<Cotacao, "id"> => ({
  item: "", fornecedor: "", valor: 0, prazo: todayISO(), status: "solicitada",
});

function CotacoesTab({ adminKey }: { adminKey: string }) {
  const { items, add, update, remove } = useApiCollection<Cotacao>(`${CRM_API_BASE}/forn/cotacoes`, adminKey);
  void COTACOES_SEED;
  const [busca, setBusca] = useState("");
  const [filtroStatus, setFiltroStatus] = useState("todos");
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<Omit<Cotacao, "id">>(emptyCotacao());

  const kpis = useMemo(() => {
    const pendentes = items.filter((c) => c.status === "solicitada" || c.status === "recebida").length;
    const aprovadas = items.filter((c) => c.status === "aprovada").length;
    const totalAprovado = items.filter((c) => c.status === "aprovada").reduce((s, c) => s + c.valor, 0);
    return { pendentes, aprovadas, totalAprovado };
  }, [items]);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return items.filter((c) => {
      if (filtroStatus !== "todos" && c.status !== filtroStatus) return false;
      if (!q) return true;
      return c.item.toLowerCase().includes(q) || c.fornecedor.toLowerCase().includes(q);
    });
  }, [items, busca, filtroStatus]);

  function novo() { setEditId(null); setForm(emptyCotacao()); setOpen(true); }
  function editar(c: Cotacao) {
    setEditId(c.id);
    const { id, ...rest } = c;
    setForm(rest);
    setOpen(true);
  }
  function salvar() {
    if (!form.item.trim()) return;
    if (editId) update(editId, form);
    else add(form);
    setOpen(false);
  }

  const columns: Column<Cotacao>[] = [
    { key: "item", label: "Item", render: (r) => <strong>{r.item}</strong> },
    { key: "fornecedor", label: "Fornecedor" },
    { key: "valor", label: "Valor cotado", align: "right", render: (r) => brl(r.valor) },
    { key: "prazo", label: "Prazo de entrega", render: (r) => dateBR(r.prazo) },
    { key: "status", label: "Status", render: (r) => <Badge tone={cotacaoTone(r.status)}>{r.status}</Badge> },
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
        <Kpi label="Cotações pendentes" value={kpis.pendentes} icon="📨" tone="orange" />
        <Kpi label="Aprovadas" value={kpis.aprovadas} icon="✅" tone="green" />
        <Kpi label="Total aprovado" value={brl(kpis.totalAprovado)} icon="💰" tone="blue" />
      </KpiGrid>

      <SectionCard
        title="Cotações"
        actions={<Button tone="green" onClick={novo}>+ Nova cotação</Button>}
      >
        <Toolbar>
          <SearchInput value={busca} onChange={setBusca} placeholder="Buscar por item ou fornecedor..." />
          <Select
            value={filtroStatus}
            onChange={setFiltroStatus}
            options={[{ value: "todos", label: "Todos os status" }, ...opts(COTACAO_STATUS)]}
          />
        </Toolbar>
        <DataTable columns={columns} rows={filtrados} empty="Nenhuma cotação registrada." />
      </SectionCard>

      <Modal
        open={open}
        title={editId ? "Editar cotação" : "Nova cotação"}
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button tone="muted" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button tone="green" onClick={salvar}>Salvar</Button>
          </>
        }
      >
        <Field label="Item">
          <TextInput value={form.item} onChange={(v) => setForm({ ...form, item: v })} placeholder="Item / descrição cotada" />
        </Field>
        <Field label="Fornecedor">
          <TextInput value={form.fornecedor} onChange={(v) => setForm({ ...form, fornecedor: v })} placeholder="Nome do fornecedor" />
        </Field>
        <div className="crm-grid-2">
          <Field label="Valor cotado (R$)">
            <TextInput type="number" value={String(form.valor)} onChange={(v) => setForm({ ...form, valor: Number(v) || 0 })} />
          </Field>
          <Field label="Prazo de entrega">
            <TextInput type="date" value={form.prazo} onChange={(v) => setForm({ ...form, prazo: v })} />
          </Field>
        </div>
        <Field label="Status">
          <Select value={form.status} onChange={(v) => setForm({ ...form, status: v as CotacaoStatus })} options={opts(COTACAO_STATUS)} />
        </Field>
      </Modal>
    </div>
  );
}
