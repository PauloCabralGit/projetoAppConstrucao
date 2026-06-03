import { useMemo, useState } from "react";
import {
  uid, dateBR, todayISO,
  useLocalCollection,
  PageHeader, KpiGrid, Kpi,
  Toolbar, SearchInput, Select,
  Badge, DataTable, type Column,
  Button, Modal, Field, TextInput, Textarea,
  Tabs, Empty,
} from "../kit";

// ════════════════════════════════════════════════════════════════════════════
// Módulo de Suporte (Atendimento) — tickets e base de conhecimento
// ════════════════════════════════════════════════════════════════════════════

type Canal = "app" | "email" | "whatsapp" | "telefone";
type Prioridade = "baixa" | "média" | "alta" | "urgente";
type StatusTicket = "aberto" | "em andamento" | "resolvido" | "fechado";

interface Ticket {
  id: string;
  assunto: string;
  solicitante: string;
  canal: Canal;
  prioridade: Prioridade;
  status: StatusTicket;
  responsavel: string;
  abertura: string;
  resposta: string;
}

interface Artigo {
  id: string;
  titulo: string;
  categoria: string;
  conteudo: string;
}

const CANAIS: Canal[] = ["app", "email", "whatsapp", "telefone"];
const PRIORIDADES: Prioridade[] = ["baixa", "média", "alta", "urgente"];
const STATUSES: StatusTicket[] = ["aberto", "em andamento", "resolvido", "fechado"];

const PRIORIDADE_TONE: Record<Prioridade, "gray" | "blue" | "orange" | "red"> = {
  baixa: "gray", média: "blue", alta: "orange", urgente: "red",
};
const STATUS_TONE: Record<StatusTicket, "blue" | "orange" | "green" | "gray"> = {
  aberto: "blue", "em andamento": "orange", resolvido: "green", fechado: "gray",
};

const SEED_TICKETS: Ticket[] = [
  { id: uid(), assunto: "Pagamento não foi confirmado", solicitante: "Marcos Vinícius", canal: "app", prioridade: "alta", status: "em andamento", responsavel: "Juliana Alves", abertura: "2026-05-30", resposta: "Verificando junto ao gateway de pagamento." },
  { id: uid(), assunto: "Não consigo finalizar cadastro de prestador", solicitante: "Construtora Silva ME", canal: "email", prioridade: "média", status: "aberto", responsavel: "—", abertura: "2026-06-01", resposta: "" },
  { id: uid(), assunto: "Como emitir nota fiscal pelo app?", solicitante: "João Pereira", canal: "whatsapp", prioridade: "baixa", status: "resolvido", responsavel: "Juliana Alves", abertura: "2026-05-28", resposta: "Enviado tutorial da Base de Conhecimento ao cliente." },
  { id: uid(), assunto: "App travando ao enviar fotos da obra", solicitante: "Reforma Express", canal: "app", prioridade: "urgente", status: "em andamento", responsavel: "Rafael Mendes", abertura: "2026-06-02", resposta: "Time de Tech investigando bug de upload." },
  { id: uid(), assunto: "Solicito reembolso de serviço cancelado", solicitante: "Ana Lúcia", canal: "telefone", prioridade: "alta", status: "aberto", responsavel: "—", abertura: "2026-06-02", resposta: "" },
  { id: uid(), assunto: "Dúvida sobre taxa da plataforma", solicitante: "Pedreiro Express", canal: "whatsapp", prioridade: "baixa", status: "fechado", responsavel: "Juliana Alves", abertura: "2026-05-25", resposta: "Esclarecido percentual de comissão. Ticket encerrado." },
];

const SEED_KB: Artigo[] = [
  { id: uid(), titulo: "Como cadastrar minha empresa como prestadora", categoria: "Cadastro", conteudo: "Acesse Menu > Minha Conta > Tornar-se Prestador. Preencha CNPJ, dados bancários e categorias de serviço. A aprovação leva até 48h úteis." },
  { id: uid(), titulo: "Formas de pagamento aceitas", categoria: "Pagamentos", conteudo: "Aceitamos cartão de crédito, Pix e boleto. O valor fica retido até a confirmação da conclusão do serviço pelo cliente." },
  { id: uid(), titulo: "Política de reembolso e cancelamento", categoria: "Pagamentos", conteudo: "Cancelamentos com mais de 24h de antecedência têm reembolso integral. Após esse prazo, aplica-se taxa de 20%." },
  { id: uid(), titulo: "Como avaliar um prestador de serviço", categoria: "Uso do App", conteudo: "Após a conclusão do serviço, vá em Meus Pedidos > Avaliar. Atribua de 1 a 5 estrelas e deixe um comentário opcional." },
];

const emptyTicket = (): Ticket => ({
  id: "", assunto: "", solicitante: "", canal: "app", prioridade: "média", status: "aberto", responsavel: "", abertura: todayISO(), resposta: "",
});
const emptyArtigo = (): Artigo => ({ id: "", titulo: "", categoria: "", conteudo: "" });

export function SuporteModule() {
  const tickets = useLocalCollection<Ticket>("sup_tickets", SEED_TICKETS);
  const kb = useLocalCollection<Artigo>("sup_kb", SEED_KB);
  const [tab, setTab] = useState("tickets");

  const abertos = tickets.items.filter((t) => t.status === "aberto").length;
  const andamento = tickets.items.filter((t) => t.status === "em andamento").length;
  const resolvidosHoje = tickets.items.filter((t) => t.status === "resolvido").length;

  return (
    <div className="crm-module">
      <PageHeader title="Suporte" subtitle="Atendimento ao cliente: tickets e base de conhecimento" />

      <KpiGrid>
        <Kpi label="Tickets abertos" value={abertos} icon="📨" tone="blue" />
        <Kpi label="Em andamento" value={andamento} icon="⏳" tone="orange" />
        <Kpi label="Resolvidos hoje" value={resolvidosHoje} icon="✅" tone="green" />
        <Kpi label="Tempo médio" value="2h 45min" icon="⏱️" tone="purple" hint="Primeira resposta (simulado)" />
      </KpiGrid>

      <Tabs
        tabs={[{ key: "tickets", label: "Tickets" }, { key: "kb", label: "Base de conhecimento" }]}
        active={tab}
        onChange={setTab}
      />

      {tab === "tickets" && <TicketsTab tickets={tickets} />}
      {tab === "kb" && <KbTab kb={kb} />}
    </div>
  );
}

// ── Tickets ─────────────────────────────────────────────────────────────────
function TicketsTab({ tickets }: { tickets: ReturnType<typeof useLocalCollection<Ticket>> }) {
  const [busca, setBusca] = useState("");
  const [filtroStatus, setFiltroStatus] = useState("todos");
  const [modal, setModal] = useState<Ticket | null>(null);

  const rows = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return tickets.items.filter((t) => {
      const okBusca = !q || t.assunto.toLowerCase().includes(q) || t.solicitante.toLowerCase().includes(q);
      const okStatus = filtroStatus === "todos" || t.status === filtroStatus;
      return okBusca && okStatus;
    });
  }, [tickets.items, busca, filtroStatus]);

  const columns: Column<Ticket>[] = [
    { key: "assunto", label: "Assunto" },
    { key: "solicitante", label: "Solicitante" },
    { key: "canal", label: "Canal", render: (r) => <Badge tone="gray">{r.canal}</Badge> },
    { key: "prioridade", label: "Prioridade", render: (r) => <Badge tone={PRIORIDADE_TONE[r.prioridade]}>{r.prioridade}</Badge> },
    { key: "status", label: "Status", render: (r) => <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge> },
    { key: "responsavel", label: "Responsável" },
    { key: "abertura", label: "Abertura", render: (r) => dateBR(r.abertura) },
    {
      key: "acoes", label: "Ações", align: "right", render: (r) => (
        <span style={{ display: "inline-flex", gap: 6 }}>
          <Button size="sm" tone="muted" onClick={() => setModal(r)}>Abrir</Button>
          <Button size="sm" tone="danger" onClick={() => tickets.remove(r.id)}>Excluir</Button>
        </span>
      ),
    },
  ];

  return (
    <div className="crm-card">
      <Toolbar>
        <SearchInput value={busca} onChange={setBusca} placeholder="Buscar por assunto ou solicitante..." />
        <Select
          value={filtroStatus}
          onChange={setFiltroStatus}
          options={[{ value: "todos", label: "Todos os status" }, ...STATUSES.map((s) => ({ value: s, label: s }))]}
        />
        <Button onClick={() => setModal(emptyTicket())}>+ Novo ticket</Button>
      </Toolbar>

      <DataTable columns={columns} rows={rows} empty="Nenhum ticket encontrado." />

      {modal && (
        <TicketModal
          ticket={modal}
          onClose={() => setModal(null)}
          onSave={(t) => { if (t.id) tickets.update(t.id, t); else tickets.add(t); setModal(null); }}
        />
      )}
    </div>
  );
}

function TicketModal({ ticket, onClose, onSave }: { ticket: Ticket; onClose: () => void; onSave: (t: Ticket) => void }) {
  const [form, setForm] = useState<Ticket>(ticket);
  const set = <K extends keyof Ticket>(k: K, v: Ticket[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Modal
      open
      wide
      title={ticket.id ? "Detalhes do ticket" : "Novo ticket"}
      onClose={onClose}
      footer={
        <>
          <Button tone="muted" onClick={onClose}>Cancelar</Button>
          <Button tone="green" onClick={() => onSave(form)} disabled={!form.assunto.trim()}>Salvar</Button>
        </>
      }
    >
      <div className="crm-grid-2">
        <Field label="Assunto"><TextInput value={form.assunto} onChange={(v) => set("assunto", v)} placeholder="Resumo do problema" /></Field>
        <Field label="Solicitante"><TextInput value={form.solicitante} onChange={(v) => set("solicitante", v)} placeholder="Nome do cliente" /></Field>
        <Field label="Canal">
          <Select value={form.canal} onChange={(v) => set("canal", v as Canal)} options={CANAIS.map((c) => ({ value: c, label: c }))} />
        </Field>
        <Field label="Prioridade">
          <Select value={form.prioridade} onChange={(v) => set("prioridade", v as Prioridade)} options={PRIORIDADES.map((p) => ({ value: p, label: p }))} />
        </Field>
        <Field label="Status">
          <Select value={form.status} onChange={(v) => set("status", v as StatusTicket)} options={STATUSES.map((s) => ({ value: s, label: s }))} />
        </Field>
        <Field label="Responsável"><TextInput value={form.responsavel} onChange={(v) => set("responsavel", v)} placeholder="Atendente" /></Field>
        <Field label="Abertura"><TextInput type="date" value={form.abertura} onChange={(v) => set("abertura", v)} /></Field>
      </div>
      <Field label="Resposta / Notas internas" hint="Histórico de atendimento ao solicitante">
        <Textarea value={form.resposta} onChange={(v) => set("resposta", v)} rows={4} placeholder="Descreva a resposta ou as tratativas..." />
      </Field>
    </Modal>
  );
}

// ── Base de conhecimento ──────────────────────────────────────────────────────
function KbTab({ kb }: { kb: ReturnType<typeof useLocalCollection<Artigo>> }) {
  const [modal, setModal] = useState<Artigo | null>(null);

  return (
    <div className="crm-card">
      <Toolbar>
        <Button onClick={() => setModal(emptyArtigo())}>+ Novo artigo</Button>
      </Toolbar>

      {kb.items.length === 0 ? (
        <Empty icon="📚" title="Nenhum artigo publicado" hint="Crie artigos para ajudar a equipe e os clientes." />
      ) : (
        <div className="crm-grid-2">
          {kb.items.map((a) => (
            <div key={a.id} className="crm-card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <strong>{a.titulo}</strong>
                <Badge tone="blue">{a.categoria || "Geral"}</Badge>
              </div>
              <p className="crm-subtitle" style={{ marginBottom: 12 }}>{a.conteudo}</p>
              <div style={{ display: "inline-flex", gap: 6 }}>
                <Button size="sm" tone="muted" onClick={() => setModal(a)}>Editar</Button>
                <Button size="sm" tone="danger" onClick={() => kb.remove(a.id)}>Excluir</Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <ArtigoModal
          artigo={modal}
          onClose={() => setModal(null)}
          onSave={(a) => { if (a.id) kb.update(a.id, a); else kb.add(a); setModal(null); }}
        />
      )}
    </div>
  );
}

function ArtigoModal({ artigo, onClose, onSave }: { artigo: Artigo; onClose: () => void; onSave: (a: Artigo) => void }) {
  const [form, setForm] = useState<Artigo>(artigo);
  const set = <K extends keyof Artigo>(k: K, v: Artigo[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Modal
      open
      wide
      title={artigo.id ? "Editar artigo" : "Novo artigo"}
      onClose={onClose}
      footer={
        <>
          <Button tone="muted" onClick={onClose}>Cancelar</Button>
          <Button tone="green" onClick={() => onSave(form)} disabled={!form.titulo.trim()}>Salvar</Button>
        </>
      }
    >
      <div className="crm-grid-2">
        <Field label="Título"><TextInput value={form.titulo} onChange={(v) => set("titulo", v)} placeholder="Título do artigo" /></Field>
        <Field label="Categoria"><TextInput value={form.categoria} onChange={(v) => set("categoria", v)} placeholder="Ex.: Pagamentos, Cadastro" /></Field>
      </div>
      <Field label="Conteúdo">
        <Textarea value={form.conteudo} onChange={(v) => set("conteudo", v)} rows={6} placeholder="Conteúdo do artigo..." />
      </Field>
    </Modal>
  );
}
