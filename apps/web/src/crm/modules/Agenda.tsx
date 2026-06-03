import { useMemo, useState } from "react";
import {
  uid, dateBR, todayISO,
  useLocalCollection,
  PageHeader, KpiGrid, Kpi,
  Toolbar, Select,
  Badge, Button, Modal, Field, TextInput, Textarea,
  Tabs, Empty,
} from "../kit";

// ════════════════════════════════════════════════════════════════════════════
// Módulo de Agenda & Tarefas — lista de tarefas e timeline de compromissos
// ════════════════════════════════════════════════════════════════════════════

type Prioridade = "baixa" | "média" | "alta";

interface Tarefa {
  id: string;
  titulo: string;
  responsavel: string;
  prioridade: Prioridade;
  prazo: string;
  concluida: boolean;
}

type TipoCompromisso = "reunião" | "visita" | "ligação";

interface Compromisso {
  id: string;
  titulo: string;
  data: string;
  hora: string;
  participantes: string;
  tipo: TipoCompromisso;
  notas: string;
}

const PRIORIDADES: Prioridade[] = ["baixa", "média", "alta"];
const PRIORIDADE_TONE: Record<Prioridade, "gray" | "blue" | "red"> = {
  baixa: "gray", média: "blue", alta: "red",
};
const TIPOS: TipoCompromisso[] = ["reunião", "visita", "ligação"];
const TIPO_ICON: Record<TipoCompromisso, string> = {
  reunião: "👥", visita: "🏗️", ligação: "📞",
};

const SEED_TAREFAS: Tarefa[] = [
  { id: uid(), titulo: "Aprovar orçamentos pendentes do mês", responsavel: "Mariana Costa", prioridade: "alta", prazo: "2026-06-02", concluida: false },
  { id: uid(), titulo: "Revisar contrato com novo prestador", responsavel: "Pedro Henrique Rocha", prioridade: "média", prazo: "2026-06-05", concluida: false },
  { id: uid(), titulo: "Atualizar tabela de comissões", responsavel: "Carlos Eduardo Lima", prioridade: "baixa", prazo: "2026-06-10", concluida: false },
  { id: uid(), titulo: "Responder avaliações negativas no app", responsavel: "Juliana Alves", prioridade: "alta", prazo: "2026-05-31", concluida: false },
  { id: uid(), titulo: "Fechar relatório financeiro de maio", responsavel: "Mariana Costa", prioridade: "alta", prazo: "2026-05-28", concluida: true },
];

const SEED_COMPROMISSOS: Compromisso[] = [
  { id: uid(), titulo: "Reunião de alinhamento comercial", data: "2026-06-04", hora: "09:00", participantes: "Equipe Comercial", tipo: "reunião", notas: "Revisar metas do trimestre." },
  { id: uid(), titulo: "Visita técnica à obra Jardins", data: "2026-06-05", hora: "14:30", participantes: "Rafael Mendes, cliente", tipo: "visita", notas: "Validar uso do app em campo." },
  { id: uid(), titulo: "Ligação com fornecedor de materiais", data: "2026-06-06", hora: "11:00", participantes: "Ana Beatriz Souza", tipo: "ligação", notas: "Negociar parceria de descontos." },
  { id: uid(), titulo: "Reunião de produto - roadmap mobile", data: "2026-06-09", hora: "16:00", participantes: "Time de Tech", tipo: "reunião", notas: "Priorizar correção de upload de fotos." },
];

const emptyTarefa = (): Tarefa => ({
  id: "", titulo: "", responsavel: "", prioridade: "média", prazo: todayISO(), concluida: false,
});
const emptyCompromisso = (): Compromisso => ({
  id: "", titulo: "", data: todayISO(), hora: "09:00", participantes: "", tipo: "reunião", notas: "",
});

export function AgendaModule() {
  const tarefas = useLocalCollection<Tarefa>("agenda_tarefas", SEED_TAREFAS);
  const compromissos = useLocalCollection<Compromisso>("agenda_compromissos", SEED_COMPROMISSOS);
  const [tab, setTab] = useState("tarefas");

  const hoje = todayISO();
  const pendentes = tarefas.items.filter((t) => !t.concluida).length;
  const concluidas = tarefas.items.filter((t) => t.concluida).length;
  const atrasadas = tarefas.items.filter((t) => !t.concluida && t.prazo < hoje).length;

  return (
    <div className="crm-module">
      <PageHeader title="Agenda & Tarefas" subtitle="Organização de tarefas e compromissos da equipe" />

      <KpiGrid>
        <Kpi label="Tarefas pendentes" value={pendentes} icon="📋" tone="blue" />
        <Kpi label="Concluídas" value={concluidas} icon="✅" tone="green" />
        <Kpi label="Atrasadas" value={atrasadas} icon="⚠️" tone="red" hint="Prazo vencido e não concluída" />
      </KpiGrid>

      <Tabs
        tabs={[{ key: "tarefas", label: "Tarefas" }, { key: "compromissos", label: "Compromissos" }]}
        active={tab}
        onChange={setTab}
      />

      {tab === "tarefas" && <TarefasTab tarefas={tarefas} />}
      {tab === "compromissos" && <CompromissosTab compromissos={compromissos} />}
    </div>
  );
}

// ── Tarefas ─────────────────────────────────────────────────────────────────
function TarefasTab({ tarefas }: { tarefas: ReturnType<typeof useLocalCollection<Tarefa>> }) {
  const [filtro, setFiltro] = useState("todas");
  const [modal, setModal] = useState<Tarefa | null>(null);
  const hoje = todayISO();

  const rows = useMemo(() => {
    return tarefas.items.filter((t) => {
      if (filtro === "pendentes") return !t.concluida;
      if (filtro === "concluidas") return t.concluida;
      return true;
    });
  }, [tarefas.items, filtro]);

  return (
    <div className="crm-card">
      <Toolbar>
        <Select
          value={filtro}
          onChange={setFiltro}
          options={[
            { value: "todas", label: "Todas as tarefas" },
            { value: "pendentes", label: "Pendentes" },
            { value: "concluidas", label: "Concluídas" },
          ]}
        />
        <Button onClick={() => setModal(emptyTarefa())}>+ Nova tarefa</Button>
      </Toolbar>

      {rows.length === 0 ? (
        <Empty icon="📭" title="Nenhuma tarefa" hint="Crie tarefas para organizar o trabalho da equipe." />
      ) : (
        <div className="crm-list">
          {rows.map((t) => {
            const atrasada = !t.concluida && t.prazo < hoje;
            return (
              <div key={t.id} className="crm-card" style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <input
                  type="checkbox"
                  checked={t.concluida}
                  onChange={() => tarefas.update(t.id, { concluida: !t.concluida })}
                  style={{ width: 18, height: 18 }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, textDecoration: t.concluida ? "line-through" : "none", opacity: t.concluida ? 0.6 : 1 }}>
                    {t.titulo}
                  </div>
                  <div className="crm-subtitle">
                    {t.responsavel || "Sem responsável"} · Prazo: {dateBR(t.prazo)}
                    {atrasada && <span style={{ color: "var(--danger, #d33)", fontWeight: 600 }}> · Atrasada</span>}
                  </div>
                </div>
                <Badge tone={PRIORIDADE_TONE[t.prioridade]}>{t.prioridade}</Badge>
                <span style={{ display: "inline-flex", gap: 6 }}>
                  <Button size="sm" tone="muted" onClick={() => setModal(t)}>Editar</Button>
                  <Button size="sm" tone="danger" onClick={() => tarefas.remove(t.id)}>Excluir</Button>
                </span>
              </div>
            );
          })}
        </div>
      )}

      {modal && (
        <TarefaModal
          tarefa={modal}
          onClose={() => setModal(null)}
          onSave={(t) => { if (t.id) tarefas.update(t.id, t); else tarefas.add(t); setModal(null); }}
        />
      )}
    </div>
  );
}

function TarefaModal({ tarefa, onClose, onSave }: { tarefa: Tarefa; onClose: () => void; onSave: (t: Tarefa) => void }) {
  const [form, setForm] = useState<Tarefa>(tarefa);
  const set = <K extends keyof Tarefa>(k: K, v: Tarefa[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Modal
      open
      title={tarefa.id ? "Editar tarefa" : "Nova tarefa"}
      onClose={onClose}
      footer={
        <>
          <Button tone="muted" onClick={onClose}>Cancelar</Button>
          <Button tone="green" onClick={() => onSave(form)} disabled={!form.titulo.trim()}>Salvar</Button>
        </>
      }
    >
      <Field label="Título"><TextInput value={form.titulo} onChange={(v) => set("titulo", v)} placeholder="Descrição da tarefa" /></Field>
      <div className="crm-grid-2">
        <Field label="Responsável"><TextInput value={form.responsavel} onChange={(v) => set("responsavel", v)} placeholder="Nome" /></Field>
        <Field label="Prioridade">
          <Select value={form.prioridade} onChange={(v) => set("prioridade", v as Prioridade)} options={PRIORIDADES.map((p) => ({ value: p, label: p }))} />
        </Field>
        <Field label="Prazo"><TextInput type="date" value={form.prazo} onChange={(v) => set("prazo", v)} /></Field>
        <Field label="Situação">
          <Select value={form.concluida ? "sim" : "nao"} onChange={(v) => set("concluida", v === "sim")} options={[
            { value: "nao", label: "Pendente" }, { value: "sim", label: "Concluída" },
          ]} />
        </Field>
      </div>
    </Modal>
  );
}

// ── Compromissos (timeline) ────────────────────────────────────────────────────
function CompromissosTab({ compromissos }: { compromissos: ReturnType<typeof useLocalCollection<Compromisso>> }) {
  const [modal, setModal] = useState<Compromisso | null>(null);

  const ordenados = useMemo(
    () => [...compromissos.items].sort((a, b) => (a.data + a.hora).localeCompare(b.data + b.hora)),
    [compromissos.items],
  );

  return (
    <div className="crm-card">
      <Toolbar>
        <Button onClick={() => setModal(emptyCompromisso())}>+ Novo compromisso</Button>
      </Toolbar>

      {ordenados.length === 0 ? (
        <Empty icon="📅" title="Nenhum compromisso agendado" hint="Adicione reuniões, visitas e ligações." />
      ) : (
        <div className="crm-timeline">
          {ordenados.map((c) => (
            <div key={c.id} className="crm-timeline-item">
              <div className="crm-timeline-date">
                {dateBR(c.data)}<br />{c.hora}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>
                  {TIPO_ICON[c.tipo]} {c.titulo} <Badge tone="blue">{c.tipo}</Badge>
                </div>
                <div className="crm-subtitle">Participantes: {c.participantes || "—"}</div>
                {c.notas && <div className="crm-subtitle">{c.notas}</div>}
                <div style={{ display: "inline-flex", gap: 6, marginTop: 8 }}>
                  <Button size="sm" tone="muted" onClick={() => setModal(c)}>Editar</Button>
                  <Button size="sm" tone="danger" onClick={() => compromissos.remove(c.id)}>Excluir</Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <CompromissoModal
          compromisso={modal}
          onClose={() => setModal(null)}
          onSave={(c) => { if (c.id) compromissos.update(c.id, c); else compromissos.add(c); setModal(null); }}
        />
      )}
    </div>
  );
}

function CompromissoModal({ compromisso, onClose, onSave }: { compromisso: Compromisso; onClose: () => void; onSave: (c: Compromisso) => void }) {
  const [form, setForm] = useState<Compromisso>(compromisso);
  const set = <K extends keyof Compromisso>(k: K, v: Compromisso[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Modal
      open
      title={compromisso.id ? "Editar compromisso" : "Novo compromisso"}
      onClose={onClose}
      footer={
        <>
          <Button tone="muted" onClick={onClose}>Cancelar</Button>
          <Button tone="green" onClick={() => onSave(form)} disabled={!form.titulo.trim()}>Salvar</Button>
        </>
      }
    >
      <Field label="Título"><TextInput value={form.titulo} onChange={(v) => set("titulo", v)} placeholder="Assunto do compromisso" /></Field>
      <div className="crm-grid-2">
        <Field label="Data"><TextInput type="date" value={form.data} onChange={(v) => set("data", v)} /></Field>
        <Field label="Hora"><TextInput type="time" value={form.hora} onChange={(v) => set("hora", v)} /></Field>
        <Field label="Tipo">
          <Select value={form.tipo} onChange={(v) => set("tipo", v as TipoCompromisso)} options={TIPOS.map((t) => ({ value: t, label: t }))} />
        </Field>
        <Field label="Participantes"><TextInput value={form.participantes} onChange={(v) => set("participantes", v)} placeholder="Quem participa" /></Field>
      </div>
      <Field label="Notas">
        <Textarea value={form.notas} onChange={(v) => set("notas", v)} rows={3} placeholder="Pauta ou observações..." />
      </Field>
    </Modal>
  );
}
