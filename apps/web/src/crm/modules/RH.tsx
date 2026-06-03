import { useMemo, useState } from "react";
import {
  uid, brl, dateBR, todayISO,
  useApiCollection, CRM_API_BASE,
  PageHeader, KpiGrid, Kpi,
  Toolbar, SearchInput, Select,
  Badge, DataTable, type Column,
  Button, Modal, Field, TextInput,
  Tabs,
} from "../kit";

// ════════════════════════════════════════════════════════════════════════════
// Módulo de Recursos Humanos (RH) — equipe, folha, recrutamento e ausências
// ════════════════════════════════════════════════════════════════════════════

type Departamento = "Operações" | "Comercial" | "Financeiro" | "Suporte" | "Tech" | "Jurídico";
type StatusColab = "ativo" | "afastado" | "desligado";

interface Colaborador {
  id: string;
  nome: string;
  cargo: string;
  departamento: Departamento;
  salario: number;
  beneficios: number;
  admissao: string;
  status: StatusColab;
}

type StatusVaga = "aberta" | "em entrevista" | "fechada";

interface Vaga {
  id: string;
  cargo: string;
  departamento: Departamento;
  candidatos: number;
  status: StatusVaga;
  abertura: string;
}

type TipoAusencia = "férias" | "licença" | "atestado";
type StatusAusencia = "aprovada" | "pendente";

interface Ausencia {
  id: string;
  colaborador: string;
  tipo: TipoAusencia;
  inicio: string;
  fim: string;
  status: StatusAusencia;
}

const DEPARTAMENTOS: Departamento[] = ["Operações", "Comercial", "Financeiro", "Suporte", "Tech", "Jurídico"];

const SEED_EQUIPE: Colaborador[] = [
  { id: uid(), nome: "Ana Beatriz Souza", cargo: "Gerente de Operações", departamento: "Operações", salario: 11500, beneficios: 1800, admissao: "2021-03-15", status: "ativo" },
  { id: uid(), nome: "Carlos Eduardo Lima", cargo: "Executivo de Vendas", departamento: "Comercial", salario: 6800, beneficios: 1200, admissao: "2022-07-01", status: "ativo" },
  { id: uid(), nome: "Mariana Costa", cargo: "Analista Financeiro", departamento: "Financeiro", salario: 7200, beneficios: 1100, admissao: "2020-11-20", status: "ativo" },
  { id: uid(), nome: "Rafael Mendes", cargo: "Desenvolvedor Full-Stack", departamento: "Tech", salario: 9800, beneficios: 1500, admissao: "2023-01-10", status: "ativo" },
  { id: uid(), nome: "Juliana Alves", cargo: "Analista de Suporte", departamento: "Suporte", salario: 4500, beneficios: 900, admissao: "2023-05-22", status: "afastado" },
  { id: uid(), nome: "Pedro Henrique Rocha", cargo: "Advogado", departamento: "Jurídico", salario: 8900, beneficios: 1300, admissao: "2019-09-05", status: "ativo" },
  { id: uid(), nome: "Fernanda Dias", cargo: "Auxiliar Administrativo", departamento: "Operações", salario: 3200, beneficios: 700, admissao: "2024-02-14", status: "desligado" },
];

const SEED_VAGAS: Vaga[] = [
  { id: uid(), cargo: "Desenvolvedor Mobile", departamento: "Tech", candidatos: 18, status: "em entrevista", abertura: "2026-04-10" },
  { id: uid(), cargo: "Vendedor Externo", departamento: "Comercial", candidatos: 32, status: "aberta", abertura: "2026-05-02" },
  { id: uid(), cargo: "Analista Contábil", departamento: "Financeiro", candidatos: 9, status: "aberta", abertura: "2026-05-18" },
  { id: uid(), cargo: "Coordenador de Suporte", departamento: "Suporte", candidatos: 12, status: "fechada", abertura: "2026-02-20" },
];

const SEED_AUSENCIAS: Ausencia[] = [
  { id: uid(), colaborador: "Juliana Alves", tipo: "licença", inicio: "2026-05-12", fim: "2026-08-12", status: "aprovada" },
  { id: uid(), colaborador: "Carlos Eduardo Lima", tipo: "férias", inicio: "2026-07-01", fim: "2026-07-20", status: "aprovada" },
  { id: uid(), colaborador: "Rafael Mendes", tipo: "atestado", inicio: "2026-06-02", fim: "2026-06-04", status: "pendente" },
  { id: uid(), colaborador: "Mariana Costa", tipo: "férias", inicio: "2026-08-15", fim: "2026-09-03", status: "pendente" },
];

const STATUS_COLAB_TONE: Record<StatusColab, "green" | "orange" | "red"> = {
  ativo: "green", afastado: "orange", desligado: "red",
};
const STATUS_VAGA_TONE: Record<StatusVaga, "blue" | "orange" | "gray"> = {
  aberta: "blue", "em entrevista": "orange", fechada: "gray",
};

const emptyColab = (): Colaborador => ({
  id: "", nome: "", cargo: "", departamento: "Operações", salario: 0, beneficios: 0, admissao: todayISO(), status: "ativo",
});
const emptyVaga = (): Vaga => ({
  id: "", cargo: "", departamento: "Tech", candidatos: 0, status: "aberta", abertura: todayISO(),
});
const emptyAusencia = (): Ausencia => ({
  id: "", colaborador: "", tipo: "férias", inicio: todayISO(), fim: todayISO(), status: "pendente",
});

export function RHModule({ adminKey }: { adminKey: string }) {
  const equipe = useApiCollection<Colaborador>(`${CRM_API_BASE}/rh/equipe`, adminKey);
  const vagas = useApiCollection<Vaga>(`${CRM_API_BASE}/rh/vagas`, adminKey);
  const ausencias = useApiCollection<Ausencia>(`${CRM_API_BASE}/rh/ausencias`, adminKey);
  void SEED_EQUIPE; void SEED_VAGAS; void SEED_AUSENCIAS;

  const [tab, setTab] = useState("equipe");

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const ativos = useMemo(() => equipe.items.filter((c) => c.status === "ativo"), [equipe.items]);
  const custoFolha = useMemo(() => ativos.reduce((s, c) => s + c.salario, 0), [ativos]);
  const numDepartamentos = useMemo(() => new Set(equipe.items.map((c) => c.departamento)).size, [equipe.items]);

  return (
    <div className="crm-module">
      <PageHeader title="Recursos Humanos" subtitle="Gestão de equipe, folha de pagamento, recrutamento e ausências" />

      <KpiGrid>
        <Kpi label="Colaboradores" value={equipe.items.length} icon="👥" tone="blue" />
        <Kpi label="Ativos" value={ativos.length} icon="✅" tone="green" />
        <Kpi label="Custo mensal de folha" value={brl(custoFolha)} icon="💰" tone="purple" hint="Soma dos salários ativos" />
        <Kpi label="Departamentos" value={numDepartamentos} icon="🏢" tone="orange" />
      </KpiGrid>

      <Tabs
        tabs={[
          { key: "equipe", label: "Equipe" },
          { key: "folha", label: "Folha de pagamento" },
          { key: "recrutamento", label: "Recrutamento" },
          { key: "ausencias", label: "Férias/Ausências" },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "equipe" && <EquipeTab equipe={equipe} />}
      {tab === "folha" && <FolhaTab ativos={ativos} />}
      {tab === "recrutamento" && <RecrutamentoTab vagas={vagas} />}
      {tab === "ausencias" && <AusenciasTab ausencias={ausencias} equipe={equipe.items} />}
    </div>
  );
}

// ── Equipe ────────────────────────────────────────────────────────────────────
function EquipeTab({ equipe }: { equipe: ReturnType<typeof useApiCollection<Colaborador>> }) {
  const [busca, setBusca] = useState("");
  const [filtroDep, setFiltroDep] = useState("todos");
  const [modal, setModal] = useState<Colaborador | null>(null);

  const rows = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return equipe.items.filter((c) => {
      const okBusca = !q || c.nome.toLowerCase().includes(q) || c.cargo.toLowerCase().includes(q);
      const okDep = filtroDep === "todos" || c.departamento === filtroDep;
      return okBusca && okDep;
    });
  }, [equipe.items, busca, filtroDep]);

  const columns: Column<Colaborador>[] = [
    { key: "nome", label: "Nome" },
    { key: "cargo", label: "Cargo" },
    { key: "departamento", label: "Departamento" },
    { key: "salario", label: "Salário", align: "right", render: (r) => brl(r.salario) },
    { key: "admissao", label: "Admissão", render: (r) => dateBR(r.admissao) },
    { key: "status", label: "Status", render: (r) => <Badge tone={STATUS_COLAB_TONE[r.status]}>{r.status}</Badge> },
    {
      key: "acoes", label: "Ações", align: "right", render: (r) => (
        <span style={{ display: "inline-flex", gap: 6 }}>
          <Button size="sm" tone="muted" onClick={() => setModal(r)}>Editar</Button>
          <Button size="sm" tone="danger" onClick={() => equipe.remove(r.id)}>Excluir</Button>
        </span>
      ),
    },
  ];

  return (
    <div className="crm-card">
      <Toolbar>
        <SearchInput value={busca} onChange={setBusca} placeholder="Buscar por nome ou cargo..." />
        <Select
          value={filtroDep}
          onChange={setFiltroDep}
          options={[{ value: "todos", label: "Todos os departamentos" }, ...DEPARTAMENTOS.map((d) => ({ value: d, label: d }))]}
        />
        <Button onClick={() => setModal(emptyColab())}>+ Novo colaborador</Button>
      </Toolbar>

      <DataTable columns={columns} rows={rows} empty="Nenhum colaborador encontrado." />

      {modal && (
        <ColaboradorModal
          colab={modal}
          onClose={() => setModal(null)}
          onSave={(c) => {
            if (c.id) equipe.update(c.id, c);
            else equipe.add(c);
            setModal(null);
          }}
        />
      )}
    </div>
  );
}

function ColaboradorModal({ colab, onClose, onSave }: { colab: Colaborador; onClose: () => void; onSave: (c: Colaborador) => void }) {
  const [form, setForm] = useState<Colaborador>(colab);
  const set = <K extends keyof Colaborador>(k: K, v: Colaborador[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Modal
      open
      title={colab.id ? "Editar colaborador" : "Novo colaborador"}
      onClose={onClose}
      footer={
        <>
          <Button tone="muted" onClick={onClose}>Cancelar</Button>
          <Button tone="green" onClick={() => onSave(form)} disabled={!form.nome.trim()}>Salvar</Button>
        </>
      }
    >
      <div className="crm-grid-2">
        <Field label="Nome"><TextInput value={form.nome} onChange={(v) => set("nome", v)} placeholder="Nome completo" /></Field>
        <Field label="Cargo"><TextInput value={form.cargo} onChange={(v) => set("cargo", v)} placeholder="Cargo" /></Field>
        <Field label="Departamento">
          <Select value={form.departamento} onChange={(v) => set("departamento", v as Departamento)} options={DEPARTAMENTOS.map((d) => ({ value: d, label: d }))} />
        </Field>
        <Field label="Status">
          <Select value={form.status} onChange={(v) => set("status", v as StatusColab)} options={[
            { value: "ativo", label: "Ativo" }, { value: "afastado", label: "Afastado" }, { value: "desligado", label: "Desligado" },
          ]} />
        </Field>
        <Field label="Salário (R$)"><TextInput type="number" value={String(form.salario)} onChange={(v) => set("salario", Number(v) || 0)} /></Field>
        <Field label="Benefícios (R$)"><TextInput type="number" value={String(form.beneficios)} onChange={(v) => set("beneficios", Number(v) || 0)} /></Field>
        <Field label="Admissão"><TextInput type="date" value={form.admissao} onChange={(v) => set("admissao", v)} /></Field>
      </div>
    </Modal>
  );
}

// ── Folha de pagamento (somente leitura, calculada) ────────────────────────────
function FolhaTab({ ativos }: { ativos: Colaborador[] }) {
  const linhas = useMemo(() => ativos.map((c) => {
    const encargos = c.salario * 0.27; // estimativa INSS+FGTS+provisões
    const liquido = c.salario + c.beneficios - c.salario * 0.11; // estimativa descontos
    return { ...c, encargos, liquido };
  }), [ativos]);

  const totalBase = linhas.reduce((s, l) => s + l.salario, 0);
  const totalBenef = linhas.reduce((s, l) => s + l.beneficios, 0);
  const totalEncargos = linhas.reduce((s, l) => s + l.encargos, 0);
  const totalLiquido = linhas.reduce((s, l) => s + l.liquido, 0);

  const columns: Column<Colaborador & { encargos: number; liquido: number }>[] = [
    { key: "nome", label: "Colaborador" },
    { key: "salario", label: "Salário base", align: "right", render: (r) => brl(r.salario) },
    { key: "beneficios", label: "Benefícios", align: "right", render: (r) => brl(r.beneficios) },
    { key: "encargos", label: "Encargos (est.)", align: "right", render: (r) => brl(r.encargos) },
    { key: "liquido", label: "Líquido", align: "right", render: (r) => <strong>{brl(r.liquido)}</strong> },
  ];

  return (
    <div className="crm-card">
      <p className="crm-subtitle" style={{ marginBottom: 12 }}>
        Valores calculados automaticamente a partir da equipe ativa. Encargos e descontos são estimativas.
      </p>
      <DataTable columns={columns} rows={linhas} empty="Nenhum colaborador ativo na folha." />
      <div className="crm-card" style={{ marginTop: 14 }}>
        <div className="crm-grid-2">
          <div>Total salários base: <strong>{brl(totalBase)}</strong></div>
          <div>Total benefícios: <strong>{brl(totalBenef)}</strong></div>
          <div>Total encargos (est.): <strong>{brl(totalEncargos)}</strong></div>
          <div>Total líquido: <strong>{brl(totalLiquido)}</strong></div>
        </div>
      </div>
    </div>
  );
}

// ── Recrutamento ───────────────────────────────────────────────────────────────
function RecrutamentoTab({ vagas }: { vagas: ReturnType<typeof useApiCollection<Vaga>> }) {
  const [modal, setModal] = useState<Vaga | null>(null);

  const columns: Column<Vaga>[] = [
    { key: "cargo", label: "Cargo" },
    { key: "departamento", label: "Departamento" },
    { key: "candidatos", label: "Candidatos", align: "right" },
    { key: "abertura", label: "Abertura", render: (r) => dateBR(r.abertura) },
    { key: "status", label: "Status", render: (r) => <Badge tone={STATUS_VAGA_TONE[r.status]}>{r.status}</Badge> },
    {
      key: "acoes", label: "Ações", align: "right", render: (r) => (
        <span style={{ display: "inline-flex", gap: 6 }}>
          <Button size="sm" tone="muted" onClick={() => setModal(r)}>Editar</Button>
          <Button size="sm" tone="danger" onClick={() => vagas.remove(r.id)}>Excluir</Button>
        </span>
      ),
    },
  ];

  return (
    <div className="crm-card">
      <Toolbar>
        <Button onClick={() => setModal(emptyVaga())}>+ Nova vaga</Button>
      </Toolbar>
      <DataTable columns={columns} rows={vagas.items} empty="Nenhuma vaga aberta." />

      {modal && (
        <VagaModal
          vaga={modal}
          onClose={() => setModal(null)}
          onSave={(v) => { if (v.id) vagas.update(v.id, v); else vagas.add(v); setModal(null); }}
        />
      )}
    </div>
  );
}

function VagaModal({ vaga, onClose, onSave }: { vaga: Vaga; onClose: () => void; onSave: (v: Vaga) => void }) {
  const [form, setForm] = useState<Vaga>(vaga);
  const set = <K extends keyof Vaga>(k: K, v: Vaga[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Modal
      open
      title={vaga.id ? "Editar vaga" : "Nova vaga"}
      onClose={onClose}
      footer={
        <>
          <Button tone="muted" onClick={onClose}>Cancelar</Button>
          <Button tone="green" onClick={() => onSave(form)} disabled={!form.cargo.trim()}>Salvar</Button>
        </>
      }
    >
      <div className="crm-grid-2">
        <Field label="Cargo"><TextInput value={form.cargo} onChange={(v) => set("cargo", v)} placeholder="Cargo da vaga" /></Field>
        <Field label="Departamento">
          <Select value={form.departamento} onChange={(v) => set("departamento", v as Departamento)} options={DEPARTAMENTOS.map((d) => ({ value: d, label: d }))} />
        </Field>
        <Field label="Candidatos"><TextInput type="number" value={String(form.candidatos)} onChange={(v) => set("candidatos", Number(v) || 0)} /></Field>
        <Field label="Status">
          <Select value={form.status} onChange={(v) => set("status", v as StatusVaga)} options={[
            { value: "aberta", label: "Aberta" }, { value: "em entrevista", label: "Em entrevista" }, { value: "fechada", label: "Fechada" },
          ]} />
        </Field>
        <Field label="Abertura"><TextInput type="date" value={form.abertura} onChange={(v) => set("abertura", v)} /></Field>
      </div>
    </Modal>
  );
}

// ── Férias / Ausências ─────────────────────────────────────────────────────────
function AusenciasTab({ ausencias, equipe }: { ausencias: ReturnType<typeof useApiCollection<Ausencia>>; equipe: Colaborador[] }) {
  const [modal, setModal] = useState<Ausencia | null>(null);

  const columns: Column<Ausencia>[] = [
    { key: "colaborador", label: "Colaborador" },
    { key: "tipo", label: "Tipo", render: (r) => <Badge tone="blue">{r.tipo}</Badge> },
    { key: "inicio", label: "Início", render: (r) => dateBR(r.inicio) },
    { key: "fim", label: "Fim", render: (r) => dateBR(r.fim) },
    { key: "status", label: "Status", render: (r) => <Badge tone={r.status === "aprovada" ? "green" : "orange"}>{r.status}</Badge> },
    {
      key: "acoes", label: "Ações", align: "right", render: (r) => (
        <span style={{ display: "inline-flex", gap: 6 }}>
          <Button size="sm" tone="muted" onClick={() => setModal(r)}>Editar</Button>
          <Button size="sm" tone="danger" onClick={() => ausencias.remove(r.id)}>Excluir</Button>
        </span>
      ),
    },
  ];

  return (
    <div className="crm-card">
      <Toolbar>
        <Button onClick={() => setModal(emptyAusencia())}>+ Nova ausência</Button>
      </Toolbar>
      <DataTable columns={columns} rows={ausencias.items} empty="Nenhuma ausência registrada." />

      {modal && (
        <AusenciaModal
          ausencia={modal}
          equipe={equipe}
          onClose={() => setModal(null)}
          onSave={(a) => { if (a.id) ausencias.update(a.id, a); else ausencias.add(a); setModal(null); }}
        />
      )}
    </div>
  );
}

function AusenciaModal({ ausencia, equipe, onClose, onSave }: { ausencia: Ausencia; equipe: Colaborador[]; onClose: () => void; onSave: (a: Ausencia) => void }) {
  const [form, setForm] = useState<Ausencia>(ausencia.colaborador ? ausencia : { ...ausencia, colaborador: equipe[0]?.nome ?? "" });
  const set = <K extends keyof Ausencia>(k: K, v: Ausencia[K]) => setForm((f) => ({ ...f, [k]: v }));

  const opcoesColab = equipe.length > 0
    ? equipe.map((c) => ({ value: c.nome, label: c.nome }))
    : [{ value: "", label: "Sem colaboradores" }];

  return (
    <Modal
      open
      title={ausencia.id ? "Editar ausência" : "Nova ausência"}
      onClose={onClose}
      footer={
        <>
          <Button tone="muted" onClick={onClose}>Cancelar</Button>
          <Button tone="green" onClick={() => onSave(form)} disabled={!form.colaborador.trim()}>Salvar</Button>
        </>
      }
    >
      <div className="crm-grid-2">
        <Field label="Colaborador">
          <Select value={form.colaborador} onChange={(v) => set("colaborador", v)} options={opcoesColab} />
        </Field>
        <Field label="Tipo">
          <Select value={form.tipo} onChange={(v) => set("tipo", v as TipoAusencia)} options={[
            { value: "férias", label: "Férias" }, { value: "licença", label: "Licença" }, { value: "atestado", label: "Atestado" },
          ]} />
        </Field>
        <Field label="Início"><TextInput type="date" value={form.inicio} onChange={(v) => set("inicio", v)} /></Field>
        <Field label="Fim"><TextInput type="date" value={form.fim} onChange={(v) => set("fim", v)} /></Field>
        <Field label="Status">
          <Select value={form.status} onChange={(v) => set("status", v as StatusAusencia)} options={[
            { value: "pendente", label: "Pendente" }, { value: "aprovada", label: "Aprovada" },
          ]} />
        </Field>
      </div>
    </Modal>
  );
}
