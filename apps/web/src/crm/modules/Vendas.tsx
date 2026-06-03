import { useMemo, useState } from "react";
import {
  uid,
  brl,
  dateBR,
  todayISO,
  useApiCollection,
  CRM_API_BASE,
  PageHeader,
  KpiGrid,
  Kpi,
  Toolbar,
  SearchInput,
  Select,
  Button,
  Modal,
  Field,
  TextInput,
  Textarea,
  Empty,
} from "../kit";

// ════════════════════════════════════════════════════════════════════════════
// VENDAS — CRM comercial: leads, funil kanban e conversão
// ════════════════════════════════════════════════════════════════════════════

type Estagio = "novo" | "contato" | "proposta" | "negociacao" | "ganho" | "perdido";
type Origem = "site" | "indicacao" | "anuncio" | "app" | "outro";

interface Lead {
  id: string;
  nome: string;
  empresa: string;
  telefone: string;
  email: string;
  valor: number;
  origem: Origem;
  estagio: Estagio;
  responsavel: string;
  notas: string;
  createdAt: string;
}

const ESTAGIOS: { key: Estagio; label: string; tone: "blue" | "purple" | "orange" | "gray" | "green" | "red" }[] = [
  { key: "novo", label: "Novo", tone: "gray" },
  { key: "contato", label: "Contato", tone: "blue" },
  { key: "proposta", label: "Proposta", tone: "purple" },
  { key: "negociacao", label: "Negociação", tone: "orange" },
  { key: "ganho", label: "Ganho", tone: "green" },
  { key: "perdido", label: "Perdido", tone: "red" },
];

const ESTAGIO_OPTS = ESTAGIOS.map((e) => ({ value: e.key, label: e.label }));

const ORIGEM_OPTS: { value: Origem; label: string }[] = [
  { value: "site", label: "Site" },
  { value: "indicacao", label: "Indicação" },
  { value: "anuncio", label: "Anúncio" },
  { value: "app", label: "App" },
  { value: "outro", label: "Outro" },
];

const ORIGEM_LABEL: Record<Origem, string> = {
  site: "Site",
  indicacao: "Indicação",
  anuncio: "Anúncio",
  app: "App",
  outro: "Outro",
};

const SEED: Lead[] = [
  {
    id: uid(),
    nome: "Marcos Tavares",
    empresa: "Condomínio Jardim das Acácias",
    telefone: "(11) 98123-4567",
    email: "sindico@jardimacacias.com.br",
    valor: 85000,
    origem: "indicacao",
    estagio: "negociacao",
    responsavel: "Ana Lima",
    notas: "Reforma da fachada e área comum. Aguardando aprovação em assembleia.",
    createdAt: "2026-05-12",
  },
  {
    id: uid(),
    nome: "Juliana Prado",
    empresa: "Prado Reformas Residenciais",
    telefone: "(11) 99654-3210",
    email: "juliana@pradoreformas.com",
    valor: 32000,
    origem: "site",
    estagio: "proposta",
    responsavel: "Carlos Souza",
    notas: "Reforma de apartamento 120m² — cozinha e banheiros. Enviada proposta v2.",
    createdAt: "2026-05-18",
  },
  {
    id: uid(),
    nome: "Eng. Roberto Mendes",
    empresa: "Construtora Mendes & Filhos",
    telefone: "(21) 98777-1122",
    email: "roberto@mendesconstrucao.com.br",
    valor: 420000,
    origem: "anuncio",
    estagio: "contato",
    responsavel: "Ana Lima",
    notas: "Edifício residencial 8 andares. Primeira reunião agendada.",
    createdAt: "2026-05-24",
  },
  {
    id: uid(),
    nome: "Fernanda Castro",
    empresa: "Castro Empreendimentos",
    telefone: "(31) 99888-4455",
    email: "fernanda@castroemp.com.br",
    valor: 158000,
    origem: "app",
    estagio: "ganho",
    responsavel: "Carlos Souza",
    notas: "Galpão logístico 600m². Contrato assinado, obra iniciada.",
    createdAt: "2026-04-30",
  },
  {
    id: uid(),
    nome: "Paulo Henrique",
    empresa: "PH Construções",
    telefone: "(41) 98555-6677",
    email: "paulo@phconstrucoes.com",
    valor: 24000,
    origem: "site",
    estagio: "novo",
    responsavel: "Ana Lima",
    notas: "Solicitou orçamento para muro de arrimo e portão.",
    createdAt: "2026-05-29",
  },
  {
    id: uid(),
    nome: "Sandra Oliveira",
    empresa: "Residencial Vila Nova",
    telefone: "(11) 97444-8899",
    email: "contato@vilanova.com.br",
    valor: 67000,
    origem: "indicacao",
    estagio: "perdido",
    responsavel: "Carlos Souza",
    notas: "Optou por concorrente com prazo menor. Reabordar em 6 meses.",
    createdAt: "2026-04-15",
  },
];

const VENDIDOS: Estagio[] = ["ganho"];
const FECHADOS: Estagio[] = ["ganho", "perdido"];

function emptyForm(): Omit<Lead, "id" | "createdAt"> {
  return {
    nome: "",
    empresa: "",
    telefone: "",
    email: "",
    valor: 0,
    origem: "site",
    estagio: "novo",
    responsavel: "",
    notas: "",
  };
}

export function VendasModule({ adminKey }: { adminKey: string }) {
  const { items, add, update, remove } = useApiCollection<Lead>(`${CRM_API_BASE}/leads`, adminKey);
  void SEED;
  const [busca, setBusca] = useState("");
  const [filtroResp, setFiltroResp] = useState("todos");

  const [novoOpen, setNovoOpen] = useState(false);
  const [form, setForm] = useState<Omit<Lead, "id" | "createdAt">>(emptyForm);

  const [editId, setEditId] = useState<string | null>(null);
  const editLead = items.find((l) => l.id === editId) ?? null;

  const responsaveis = useMemo(() => {
    const set = new Set(items.map((l) => l.responsavel).filter(Boolean));
    return ["todos", ...Array.from(set)];
  }, [items]);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return items.filter((l) => {
      if (filtroResp !== "todos" && l.responsavel !== filtroResp) return false;
      if (!q) return true;
      return (
        l.nome.toLowerCase().includes(q) ||
        l.empresa.toLowerCase().includes(q) ||
        l.email.toLowerCase().includes(q)
      );
    });
  }, [items, busca, filtroResp]);

  // KPIs
  const totalLeads = items.length;
  const pipeline = items
    .filter((l) => !FECHADOS.includes(l.estagio))
    .reduce((s, l) => s + (l.valor || 0), 0);
  const ganhos = items.filter((l) => VENDIDOS.includes(l.estagio)).length;
  const conversao = totalLeads > 0 ? (ganhos / totalLeads) * 100 : 0;
  const valorGanho = items
    .filter((l) => VENDIDOS.includes(l.estagio))
    .reduce((s, l) => s + (l.valor || 0), 0);
  const ticketMedio = ganhos > 0 ? valorGanho / ganhos : 0;

  function salvarNovo() {
    if (!form.nome.trim()) return;
    add({ ...form, valor: Number(form.valor) || 0, createdAt: todayISO() });
    setForm(emptyForm());
    setNovoOpen(false);
  }

  function salvarEdicao() {
    if (!editLead) return;
    update(editLead.id, {
      estagio: editLead.estagio,
      valor: Number(editLead.valor) || 0,
      responsavel: editLead.responsavel,
      notas: editLead.notas,
    });
    setEditId(null);
  }

  function patchEdit(patch: Partial<Lead>) {
    if (!editLead) return;
    update(editLead.id, patch);
  }

  function excluir() {
    if (!editLead) return;
    remove(editLead.id);
    setEditId(null);
  }

  return (
    <div>
      <PageHeader
        title="Vendas"
        subtitle="Funil comercial, leads e oportunidades"
        actions={<Button tone="green" onClick={() => setNovoOpen(true)}>+ Novo lead</Button>}
      />

      <KpiGrid>
        <Kpi label="Total de leads" value={totalLeads} icon="👥" tone="blue" />
        <Kpi label="Valor em pipeline" value={brl(pipeline)} icon="💰" tone="purple" hint="Oportunidades abertas" />
        <Kpi
          label="Taxa de conversão"
          value={`${conversao.toFixed(1)}%`}
          icon="📈"
          tone="green"
          hint={`${ganhos} de ${totalLeads} fechados`}
        />
        <Kpi label="Ticket médio" value={brl(ticketMedio)} icon="🏷️" tone="orange" hint="Negócios ganhos" />
      </KpiGrid>

      <Toolbar>
        <SearchInput value={busca} onChange={setBusca} placeholder="Buscar por nome, empresa ou e-mail..." />
        <Select
          value={filtroResp}
          onChange={setFiltroResp}
          options={responsaveis.map((r) => ({ value: r, label: r === "todos" ? "Todos os responsáveis" : r }))}
        />
      </Toolbar>

      {filtrados.length === 0 ? (
        <Empty icon="🔍" title="Nenhum lead encontrado" hint="Ajuste a busca ou cadastre um novo lead." />
      ) : (
        <div className="crm-kanban">
          {ESTAGIOS.map((col) => {
            const cards = filtrados.filter((l) => l.estagio === col.key);
            return (
              <div key={col.key} className="crm-kanban-col">
                <div className="crm-kanban-col-head">
                  <span>{col.label}</span>
                  <span className="crm-kanban-count">{cards.length}</span>
                </div>
                {cards.map((l) => (
                  <div key={l.id} className="crm-kanban-card" onClick={() => setEditId(l.id)}>
                    <strong>{l.nome}</strong>
                    <div className="meta">{l.empresa}</div>
                    <div className="meta">Origem: {ORIGEM_LABEL[l.origem]}</div>
                    <div className="val">{brl(l.valor)}</div>
                  </div>
                ))}
                {cards.length === 0 && <div className="meta" style={{ fontSize: "0.74rem", color: "#94a3b8" }}>Sem leads</div>}
              </div>
            );
          })}
        </div>
      )}

      {/* Modal: novo lead */}
      <Modal
        open={novoOpen}
        title="Novo lead"
        onClose={() => setNovoOpen(false)}
        wide
        footer={
          <>
            <Button tone="muted" onClick={() => setNovoOpen(false)}>Cancelar</Button>
            <Button tone="green" onClick={salvarNovo} disabled={!form.nome.trim()}>Salvar lead</Button>
          </>
        }
      >
        <div className="crm-grid-2">
          <Field label="Nome do contato">
            <TextInput value={form.nome} onChange={(v) => setForm({ ...form, nome: v })} placeholder="Ex.: Marcos Tavares" />
          </Field>
          <Field label="Empresa / Obra">
            <TextInput value={form.empresa} onChange={(v) => setForm({ ...form, empresa: v })} placeholder="Ex.: Construtora Mendes" />
          </Field>
          <Field label="Telefone">
            <TextInput value={form.telefone} onChange={(v) => setForm({ ...form, telefone: v })} placeholder="(11) 9....." />
          </Field>
          <Field label="E-mail">
            <TextInput value={form.email} onChange={(v) => setForm({ ...form, email: v })} type="email" placeholder="contato@empresa.com" />
          </Field>
          <Field label="Valor estimado" hint="Em reais">
            <TextInput
              value={form.valor ? String(form.valor) : ""}
              onChange={(v) => setForm({ ...form, valor: Number(v.replace(/[^\d]/g, "")) || 0 })}
              type="number"
              placeholder="0"
            />
          </Field>
          <Field label="Origem">
            <Select value={form.origem} onChange={(v) => setForm({ ...form, origem: v as Origem })} options={ORIGEM_OPTS} />
          </Field>
          <Field label="Estágio">
            <Select value={form.estagio} onChange={(v) => setForm({ ...form, estagio: v as Estagio })} options={ESTAGIO_OPTS} />
          </Field>
          <Field label="Responsável">
            <TextInput value={form.responsavel} onChange={(v) => setForm({ ...form, responsavel: v })} placeholder="Ex.: Ana Lima" />
          </Field>
        </div>
        <Field label="Notas">
          <Textarea value={form.notas} onChange={(v) => setForm({ ...form, notas: v })} placeholder="Detalhes do lead, próximos passos..." rows={3} />
        </Field>
      </Modal>

      {/* Modal: editar lead */}
      <Modal
        open={!!editLead}
        title={editLead ? `Editar — ${editLead.nome}` : "Editar lead"}
        onClose={() => setEditId(null)}
        wide
        footer={
          <>
            <Button tone="danger" onClick={excluir}>Excluir</Button>
            <span style={{ flex: 1 }} />
            <Button tone="muted" onClick={() => setEditId(null)}>Fechar</Button>
            <Button tone="green" onClick={salvarEdicao}>Salvar alterações</Button>
          </>
        }
      >
        {editLead && (
          <>
            <div className="meta" style={{ fontSize: "0.8rem", color: "#64748b", marginBottom: 10 }}>
              {editLead.empresa} · {editLead.telefone || "sem telefone"} · {editLead.email || "sem e-mail"} · criado em {dateBR(editLead.createdAt)}
            </div>
            <div className="crm-grid-2">
              <Field label="Estágio">
                <Select value={editLead.estagio} onChange={(v) => patchEdit({ estagio: v as Estagio })} options={ESTAGIO_OPTS} />
              </Field>
              <Field label="Valor estimado" hint="Em reais">
                <TextInput
                  value={editLead.valor ? String(editLead.valor) : ""}
                  onChange={(v) => patchEdit({ valor: Number(v.replace(/[^\d]/g, "")) || 0 })}
                  type="number"
                  placeholder="0"
                />
              </Field>
              <Field label="Responsável">
                <TextInput value={editLead.responsavel} onChange={(v) => patchEdit({ responsavel: v })} placeholder="Responsável" />
              </Field>
              <Field label="Origem">
                <Select value={editLead.origem} onChange={(v) => patchEdit({ origem: v as Origem })} options={ORIGEM_OPTS} />
              </Field>
            </div>
            <Field label="Notas">
              <Textarea value={editLead.notas} onChange={(v) => patchEdit({ notas: v })} rows={4} />
            </Field>
          </>
        )}
      </Modal>
    </div>
  );
}
