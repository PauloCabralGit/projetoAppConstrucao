import { useEffect, useMemo, useState } from "react";
import {
  uid, brl, dateBR, todayISO, monthKey,
  useApiCollection, CRM_API_BASE,
  PageHeader, KpiGrid, Kpi,
  Toolbar, SearchInput, Select,
  Badge, DataTable, type Column,
  Button, Modal,
  Field, TextInput, Textarea,
  Tabs, Empty, MiniBars, SectionCard,
} from "../kit";

// ════════════════════════════════════════════════════════════════════════════
// Módulo Financeiro — ConstruConnect CRM
// Lançamentos (receitas/despesas), faturas a receber/pagar e visão de fluxo
// de caixa. Persiste tudo em localStorage via useLocalCollection.
// ════════════════════════════════════════════════════════════════════════════

type TipoLancamento = "receita" | "despesa";
type CategoriaDespesa =
  | "folha" | "marketing" | "infra" | "impostos" | "taxas_mp" | "escritorio" | "outros";

interface Lancamento {
  id: string;
  data: string;            // ISO yyyy-mm-dd
  descricao: string;
  categoria: string;       // categoria livre / CategoriaDespesa para despesas
  tipo: TipoLancamento;
  valor: number;           // sempre positivo
}

type StatusFatura = "pago" | "pendente" | "atrasado";
type DirecaoFatura = "receber" | "pagar";

interface Fatura {
  id: string;
  parte: string;           // cliente (receber) ou fornecedor (pagar)
  direcao: DirecaoFatura;
  valor: number;
  vencimento: string;      // ISO yyyy-mm-dd
  status: StatusFatura;
}

interface AdminOverview {
  totalRevenue?: number;
  pendingRevenue?: number;
}

const CATEGORIAS_DESPESA: { value: CategoriaDespesa; label: string }[] = [
  { value: "folha", label: "Folha de pagamento" },
  { value: "marketing", label: "Marketing" },
  { value: "infra", label: "Infra / Servidores" },
  { value: "impostos", label: "Impostos" },
  { value: "taxas_mp", label: "Taxas MercadoPago" },
  { value: "escritorio", label: "Escritório" },
  { value: "outros", label: "Outros" },
];

// Datas relativas a 2026 (data corrente do projeto) para os seeds.
const SEED_LANCAMENTOS: Lancamento[] = [
  { id: uid(), data: "2026-06-02", descricao: "Comissões de serviços concluídos", categoria: "Comissão plataforma", tipo: "receita", valor: 18450.0 },
  { id: uid(), data: "2026-06-01", descricao: "Assinaturas Premium (prestadores)", categoria: "Assinaturas", tipo: "receita", valor: 7600.0 },
  { id: uid(), data: "2026-05-28", descricao: "Folha de pagamento equipe", categoria: "folha", tipo: "despesa", valor: 22000.0 },
  { id: uid(), data: "2026-05-20", descricao: "Campanha Google Ads — reforma", categoria: "marketing", tipo: "despesa", valor: 4800.0 },
  { id: uid(), data: "2026-05-15", descricao: "Cloudflare Workers + banco de dados", categoria: "infra", tipo: "despesa", valor: 1350.0 },
  { id: uid(), data: "2026-05-10", descricao: "Comissões de serviços concluídos", categoria: "Comissão plataforma", tipo: "receita", valor: 15200.0 },
  { id: uid(), data: "2026-05-05", descricao: "Taxas de repasse MercadoPago", categoria: "taxas_mp", tipo: "despesa", valor: 2980.0 },
  { id: uid(), data: "2026-04-30", descricao: "Simples Nacional (DAS)", categoria: "impostos", tipo: "despesa", valor: 5400.0 },
  { id: uid(), data: "2026-04-22", descricao: "Comissões de serviços concluídos", categoria: "Comissão plataforma", tipo: "receita", valor: 13750.0 },
  { id: uid(), data: "2026-04-12", descricao: "Aluguel e contas do escritório", categoria: "escritorio", tipo: "despesa", valor: 3200.0 },
  { id: uid(), data: "2026-04-08", descricao: "Assinaturas Premium (prestadores)", categoria: "Assinaturas", tipo: "receita", valor: 6900.0 },
];

const SEED_FATURAS: Fatura[] = [
  { id: uid(), parte: "Construtora Vértice Ltda", direcao: "receber", valor: 9800.0, vencimento: "2026-06-15", status: "pendente" },
  { id: uid(), parte: "Reformas Bom Lar ME", direcao: "receber", valor: 4250.0, vencimento: "2026-05-25", status: "atrasado" },
  { id: uid(), parte: "Imobiliária Solar", direcao: "receber", valor: 12300.0, vencimento: "2026-05-10", status: "pago" },
  { id: uid(), parte: "MercadoPago — repasse mensal", direcao: "pagar", valor: 2980.0, vencimento: "2026-06-05", status: "pendente" },
  { id: uid(), parte: "Cloudflare Inc.", direcao: "pagar", valor: 1350.0, vencimento: "2026-06-10", status: "pendente" },
];

// Lista de chaves dos últimos 6 meses (mais antigo → mais recente), base = hoje.
function ultimos6MesesKeys(): string[] {
  const out: string[] = [];
  const base = new Date(todayISO());
  for (let i = 5; i >= 0; i--) {
    const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

function rotuloMes(key: string): string {
  const [y, m] = key.split("-");
  const nomes = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return `${nomes[Number(m) - 1]}/${y.slice(2)}`;
}

function labelCategoria(cat: string): string {
  const found = CATEGORIAS_DESPESA.find((c) => c.value === cat);
  return found ? found.label : cat;
}

const STATUS_TONE: Record<StatusFatura, "green" | "orange" | "red"> = {
  pago: "green", pendente: "orange", atrasado: "red",
};

export function FinanceiroModule({ adminKey }: { adminKey: string }) {
  const [tab, setTab] = useState<string>("visao");
  const lancamentos = useApiCollection<Lancamento>(`${CRM_API_BASE}/lancamentos`, adminKey);
  const faturas = useApiCollection<Fatura>(`${CRM_API_BASE}/faturas`, adminKey);
  void SEED_LANCAMENTOS; void SEED_FATURAS;

  const [overview, setOverview] = useState<AdminOverview | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("https://construconnect-api.orionsystem.workers.dev/v1/admin/overview", {
          headers: { "x-admin-key": adminKey },
        });
        if (!res.ok) return;
        const json = (await res.json()) as AdminOverview;
        if (alive) setOverview(json);
      } catch {
        // degrada graciosamente — apenas dados locais
      }
    })();
    return () => { alive = false; };
  }, [adminKey]);

  // ── Métricas do mês corrente ──────────────────────────────────────────────
  const mesAtual = monthKey(todayISO());
  const { receitaMes, despesaMes } = useMemo(() => {
    let r = 0, d = 0;
    for (const l of lancamentos.items) {
      if (monthKey(l.data) !== mesAtual) continue;
      if (l.tipo === "receita") r += l.valor; else d += l.valor;
    }
    return { receitaMes: r, despesaMes: d };
  }, [lancamentos.items, mesAtual]);

  const saldoMes = receitaMes - despesaMes;

  // ── Série de 6 meses para MiniBars ────────────────────────────────────────
  const serie6 = useMemo(() => {
    const keys = ultimos6MesesKeys();
    const rec: Record<string, number> = {};
    const des: Record<string, number> = {};
    keys.forEach((k) => { rec[k] = 0; des[k] = 0; });
    for (const l of lancamentos.items) {
      const k = monthKey(l.data);
      if (!(k in rec)) continue;
      if (l.tipo === "receita") rec[k] += l.valor; else des[k] += l.valor;
    }
    return {
      receita: keys.map((k) => ({ label: rotuloMes(k), value: Math.round(rec[k]) })),
      despesa: keys.map((k) => ({ label: rotuloMes(k), value: Math.round(des[k]) })),
    };
  }, [lancamentos.items]);

  const totalEntradas = useMemo(
    () => lancamentos.items.filter((l) => l.tipo === "receita").reduce((s, l) => s + l.valor, 0),
    [lancamentos.items],
  );
  const totalSaidas = useMemo(
    () => lancamentos.items.filter((l) => l.tipo === "despesa").reduce((s, l) => s + l.valor, 0),
    [lancamentos.items],
  );

  return (
    <div className="crm-module">
      <PageHeader
        title="Financeiro"
        subtitle="Lançamentos, faturas e fluxo de caixa da plataforma"
      />

      <Tabs
        tabs={[
          { key: "visao", label: "Visão geral" },
          { key: "lancamentos", label: "Lançamentos" },
          { key: "faturas", label: "Faturas" },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "visao" && (
        <VisaoGeral
          receitaMes={receitaMes}
          despesaMes={despesaMes}
          saldoMes={saldoMes}
          overview={overview}
          serie6={serie6}
          totalEntradas={totalEntradas}
          totalSaidas={totalSaidas}
        />
      )}

      {tab === "lancamentos" && <LancamentosTab store={lancamentos} />}

      {tab === "faturas" && <FaturasTab store={faturas} />}
    </div>
  );
}

// ══════════════════════════════ Visão geral ════════════════════════════════
function VisaoGeral({
  receitaMes, despesaMes, saldoMes, overview, serie6, totalEntradas, totalSaidas,
}: {
  receitaMes: number;
  despesaMes: number;
  saldoMes: number;
  overview: AdminOverview | null;
  serie6: { receita: { label: string; value: number }[]; despesa: { label: string; value: number }[] };
  totalEntradas: number;
  totalSaidas: number;
}) {
  return (
    <>
      <KpiGrid>
        <Kpi label="Receita do mês" value={brl(receitaMes)} icon="💰" tone="green" />
        <Kpi label="Despesas do mês" value={brl(despesaMes)} icon="📉" tone="red" />
        <Kpi
          label={saldoMes >= 0 ? "Lucro do mês" : "Prejuízo do mês"}
          value={brl(saldoMes)}
          icon="📊"
          tone={saldoMes >= 0 ? "blue" : "orange"}
        />
        <Kpi
          label="Receita da plataforma (app)"
          value={overview?.totalRevenue != null ? brl(overview.totalRevenue) : "—"}
          icon="🏗️"
          tone="purple"
          hint={overview?.pendingRevenue != null ? `Pendente: ${brl(overview.pendingRevenue)}` : "Dados locais"}
        />
      </KpiGrid>

      <div className="crm-grid-2">
        <SectionCard title="Receita — últimos 6 meses">
          <MiniBars data={serie6.receita} />
        </SectionCard>
        <SectionCard title="Despesa — últimos 6 meses">
          <MiniBars data={serie6.despesa} />
        </SectionCard>
      </div>

      <SectionCard title="Fluxo de caixa">
        <div className="crm-grid-2">
          <div className="crm-card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span className="crm-kpi-label">Total de entradas</span>
            <strong style={{ fontSize: 22, color: "var(--cc-green, #1b873f)" }}>{brl(totalEntradas)}</strong>
          </div>
          <div className="crm-card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span className="crm-kpi-label">Total de saídas</span>
            <strong style={{ fontSize: 22, color: "var(--cc-red, #c92a2a)" }}>{brl(totalSaidas)}</strong>
          </div>
        </div>
        <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--cc-border, #e5e7eb)" }}>
          <span className="crm-kpi-label">Saldo acumulado</span>
          <div style={{ fontSize: 26, fontWeight: 700 }}>
            <Badge tone={totalEntradas - totalSaidas >= 0 ? "green" : "red"}>
              {brl(totalEntradas - totalSaidas)}
            </Badge>
          </div>
        </div>
      </SectionCard>
    </>
  );
}

// ══════════════════════════════ Lançamentos ════════════════════════════════
type LancStore = ReturnType<typeof useApiCollection<Lancamento>>;

const LANC_VAZIO: Omit<Lancamento, "id"> = {
  data: todayISO(), descricao: "", categoria: "Comissão plataforma", tipo: "receita", valor: 0,
};

function LancamentosTab({ store }: { store: LancStore }) {
  const [busca, setBusca] = useState("");
  const [filtroTipo, setFiltroTipo] = useState("todos");
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<Omit<Lancamento, "id">>(LANC_VAZIO);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return store.items.filter((l) => {
      if (filtroTipo !== "todos" && l.tipo !== filtroTipo) return false;
      if (!q) return true;
      return (
        l.descricao.toLowerCase().includes(q) ||
        labelCategoria(l.categoria).toLowerCase().includes(q)
      );
    });
  }, [store.items, busca, filtroTipo]);

  function abrirNovo() {
    setEditId(null);
    setForm(LANC_VAZIO);
    setModalOpen(true);
  }

  function abrirEdicao(l: Lancamento) {
    setEditId(l.id);
    setForm({ data: l.data, descricao: l.descricao, categoria: l.categoria, tipo: l.tipo, valor: l.valor });
    setModalOpen(true);
  }

  function salvar() {
    if (!form.descricao.trim()) return;
    if (editId) store.update(editId, form);
    else store.add(form);
    setModalOpen(false);
  }

  const columns: Column<Lancamento>[] = [
    { key: "data", label: "Data", width: 110, render: (r) => dateBR(r.data) },
    { key: "descricao", label: "Descrição" },
    { key: "categoria", label: "Categoria", render: (r) => labelCategoria(r.categoria) },
    {
      key: "tipo", label: "Tipo", width: 110,
      render: (r) => <Badge tone={r.tipo === "receita" ? "green" : "red"}>{r.tipo === "receita" ? "Receita" : "Despesa"}</Badge>,
    },
    {
      key: "valor", label: "Valor", align: "right", width: 140,
      render: (r) => (
        <span style={{ color: r.tipo === "receita" ? "var(--cc-green, #1b873f)" : "var(--cc-red, #c92a2a)", fontWeight: 600 }}>
          {r.tipo === "receita" ? "" : "- "}{brl(r.valor)}
        </span>
      ),
    },
    {
      key: "acoes", label: "", align: "right", width: 140,
      render: (r) => (
        <div style={{ display: "inline-flex", gap: 6 }}>
          <Button size="sm" tone="muted" onClick={() => abrirEdicao(r)}>Editar</Button>
          <Button size="sm" tone="danger" onClick={() => store.remove(r.id)}>Excluir</Button>
        </div>
      ),
    },
  ];

  const categoriaOptions = [
    { value: "Comissão plataforma", label: "Comissão plataforma" },
    { value: "Assinaturas", label: "Assinaturas" },
    ...CATEGORIAS_DESPESA,
  ];

  return (
    <>
      <Toolbar>
        <SearchInput value={busca} onChange={setBusca} placeholder="Buscar por descrição ou categoria..." />
        <Select
          value={filtroTipo}
          onChange={setFiltroTipo}
          options={[
            { value: "todos", label: "Todos os tipos" },
            { value: "receita", label: "Apenas receitas" },
            { value: "despesa", label: "Apenas despesas" },
          ]}
        />
        <Button tone="green" onClick={abrirNovo}>+ Novo lançamento</Button>
      </Toolbar>

      <DataTable
        columns={columns}
        rows={filtrados}
        empty={<Empty icon="🧾" title="Nenhum lançamento" hint="Cadastre receitas e despesas para acompanhar o caixa." />}
      />

      <Modal
        open={modalOpen}
        title={editId ? "Editar lançamento" : "Novo lançamento"}
        onClose={() => setModalOpen(false)}
        footer={
          <>
            <Button tone="muted" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button tone="green" onClick={salvar}>Salvar</Button>
          </>
        }
      >
        <div className="crm-grid-2">
          <Field label="Data">
            <TextInput type="date" value={form.data} onChange={(v) => setForm({ ...form, data: v })} />
          </Field>
          <Field label="Tipo">
            <Select
              value={form.tipo}
              onChange={(v) => setForm({ ...form, tipo: v as TipoLancamento })}
              options={[
                { value: "receita", label: "Receita" },
                { value: "despesa", label: "Despesa" },
              ]}
            />
          </Field>
        </div>
        <Field label="Descrição">
          <Textarea value={form.descricao} onChange={(v) => setForm({ ...form, descricao: v })} rows={2} placeholder="Ex.: Comissões de serviços concluídos" />
        </Field>
        <div className="crm-grid-2">
          <Field label="Categoria">
            <Select
              value={form.categoria}
              onChange={(v) => setForm({ ...form, categoria: v })}
              options={categoriaOptions}
            />
          </Field>
          <Field label="Valor (R$)" hint="Informe o valor positivo">
            <TextInput
              type="number"
              value={String(form.valor)}
              onChange={(v) => setForm({ ...form, valor: Number(v) || 0 })}
            />
          </Field>
        </div>
      </Modal>
    </>
  );
}

// ════════════════════════════════ Faturas ══════════════════════════════════
type FatStore = ReturnType<typeof useApiCollection<Fatura>>;

const FAT_VAZIA: Omit<Fatura, "id"> = {
  parte: "", direcao: "receber", valor: 0, vencimento: todayISO(), status: "pendente",
};

function FaturasTab({ store }: { store: FatStore }) {
  const [busca, setBusca] = useState("");
  const [filtroStatus, setFiltroStatus] = useState("todos");
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<Omit<Fatura, "id">>(FAT_VAZIA);

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return store.items.filter((f) => {
      if (filtroStatus !== "todos" && f.status !== filtroStatus) return false;
      if (!q) return true;
      return f.parte.toLowerCase().includes(q);
    });
  }, [store.items, busca, filtroStatus]);

  function abrirNova() {
    setEditId(null);
    setForm(FAT_VAZIA);
    setModalOpen(true);
  }

  function abrirEdicao(f: Fatura) {
    setEditId(f.id);
    setForm({ parte: f.parte, direcao: f.direcao, valor: f.valor, vencimento: f.vencimento, status: f.status });
    setModalOpen(true);
  }

  function salvar() {
    if (!form.parte.trim()) return;
    if (editId) store.update(editId, form);
    else store.add(form);
    setModalOpen(false);
  }

  const columns: Column<Fatura>[] = [
    { key: "parte", label: "Cliente / Fornecedor" },
    {
      key: "direcao", label: "Direção", width: 120,
      render: (f) => <Badge tone={f.direcao === "receber" ? "green" : "orange"}>{f.direcao === "receber" ? "A receber" : "A pagar"}</Badge>,
    },
    { key: "valor", label: "Valor", align: "right", width: 130, render: (f) => brl(f.valor) },
    { key: "vencimento", label: "Vencimento", width: 120, render: (f) => dateBR(f.vencimento) },
    {
      key: "status", label: "Status", width: 110,
      render: (f) => <Badge tone={STATUS_TONE[f.status]}>{f.status === "pago" ? "Pago" : f.status === "pendente" ? "Pendente" : "Atrasado"}</Badge>,
    },
    {
      key: "acoes", label: "", align: "right", width: 140,
      render: (f) => (
        <div style={{ display: "inline-flex", gap: 6 }}>
          <Button size="sm" tone="muted" onClick={() => abrirEdicao(f)}>Editar</Button>
          <Button size="sm" tone="danger" onClick={() => store.remove(f.id)}>Excluir</Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <Toolbar>
        <SearchInput value={busca} onChange={setBusca} placeholder="Buscar por cliente ou fornecedor..." />
        <Select
          value={filtroStatus}
          onChange={setFiltroStatus}
          options={[
            { value: "todos", label: "Todos os status" },
            { value: "pago", label: "Pago" },
            { value: "pendente", label: "Pendente" },
            { value: "atrasado", label: "Atrasado" },
          ]}
        />
        <Button tone="green" onClick={abrirNova}>+ Nova fatura</Button>
      </Toolbar>

      <DataTable
        columns={columns}
        rows={filtradas}
        empty={<Empty icon="📄" title="Nenhuma fatura" hint="Cadastre faturas a receber ou a pagar." />}
      />

      <Modal
        open={modalOpen}
        title={editId ? "Editar fatura" : "Nova fatura"}
        onClose={() => setModalOpen(false)}
        footer={
          <>
            <Button tone="muted" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button tone="green" onClick={salvar}>Salvar</Button>
          </>
        }
      >
        <Field label="Cliente / Fornecedor">
          <TextInput value={form.parte} onChange={(v) => setForm({ ...form, parte: v })} placeholder="Ex.: Construtora Vértice Ltda" />
        </Field>
        <div className="crm-grid-2">
          <Field label="Direção">
            <Select
              value={form.direcao}
              onChange={(v) => setForm({ ...form, direcao: v as DirecaoFatura })}
              options={[
                { value: "receber", label: "A receber" },
                { value: "pagar", label: "A pagar" },
              ]}
            />
          </Field>
          <Field label="Status">
            <Select
              value={form.status}
              onChange={(v) => setForm({ ...form, status: v as StatusFatura })}
              options={[
                { value: "pendente", label: "Pendente" },
                { value: "pago", label: "Pago" },
                { value: "atrasado", label: "Atrasado" },
              ]}
            />
          </Field>
        </div>
        <div className="crm-grid-2">
          <Field label="Valor (R$)">
            <TextInput
              type="number"
              value={String(form.valor)}
              onChange={(v) => setForm({ ...form, valor: Number(v) || 0 })}
            />
          </Field>
          <Field label="Vencimento">
            <TextInput type="date" value={form.vencimento} onChange={(v) => setForm({ ...form, vencimento: v })} />
          </Field>
        </div>
      </Modal>
    </>
  );
}
