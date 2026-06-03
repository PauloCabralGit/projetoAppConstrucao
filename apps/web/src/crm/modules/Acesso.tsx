import { useState } from "react";
import {
  useApiCollection, CRM_API_BASE,
  PageHeader, KpiGrid, Kpi, Toolbar, Button,
  Badge, DataTable, type Column, Modal, Field, TextInput, Select, Empty,
} from "../kit";

// ════════════════════════════════════════════════════════════════════════════
// Controle de Acesso — gestão de operadores e permissões por área (master)
// ════════════════════════════════════════════════════════════════════════════

const USERS_BASE = CRM_API_BASE.replace(/\/crm$/, "/crm-users");

export const AREAS: { key: string; label: string }[] = [
  { key: "operacao", label: "Operação do App" },
  { key: "vendas", label: "Vendas (CRM)" },
  { key: "marketing", label: "Marketing" },
  { key: "financeiro", label: "Financeiro" },
  { key: "relatorios", label: "Relatórios & BI" },
  { key: "juridico", label: "Jurídico" },
  { key: "rh", label: "RH" },
  { key: "fornecedores", label: "Fornecedores" },
  { key: "suporte", label: "Suporte" },
  { key: "agenda", label: "Agenda & Tarefas" },
];

const AREA_LABEL: Record<string, string> = Object.fromEntries(AREAS.map((a) => [a.key, a.label]));

interface Operador {
  id: string;
  nome: string;
  email: string;
  perfil: string;       // "admin" = todas as áreas | "operador" = áreas selecionadas
  areas: string[];
  ativo: boolean;
  senha?: string;
}

function emptyForm(): Operador {
  return { id: "", nome: "", email: "", perfil: "operador", areas: [], ativo: true, senha: "" };
}

export function AcessoModule({ adminKey }: { adminKey: string }) {
  const { items, add, update, remove } = useApiCollection<Operador>(USERS_BASE, adminKey);
  const [modal, setModal] = useState<Operador | null>(null);
  const [novaSenha, setNovaSenha] = useState("");

  const ativos = items.filter((o) => o.ativo).length;
  const admins = items.filter((o) => o.perfil === "admin").length;

  function openNovo() { setNovaSenha(""); setModal(emptyForm()); }
  function openEdit(o: Operador) { setNovaSenha(""); setModal({ ...o }); }

  function salvar() {
    if (!modal) return;
    const payload: any = {
      nome: modal.nome.trim(),
      email: modal.email.trim(),
      perfil: modal.perfil,
      areas: modal.perfil === "admin" ? [] : modal.areas,
    };
    if (novaSenha.trim()) payload.senha = novaSenha.trim();

    if (modal.id) {
      update(modal.id, payload);
    } else {
      if (!payload.senha) return;
      add(payload);
    }
    setModal(null);
  }

  function toggleArea(area: string) {
    if (!modal) return;
    const has = modal.areas.includes(area);
    setModal({ ...modal, areas: has ? modal.areas.filter((a) => a !== area) : [...modal.areas, area] });
  }

  const columns: Column<Operador>[] = [
    { key: "nome", label: "Nome", render: (o) => o.nome || "—" },
    { key: "email", label: "E-mail" },
    { key: "perfil", label: "Perfil", render: (o) => o.perfil === "admin"
        ? <Badge tone="purple">Admin (tudo)</Badge>
        : <Badge tone="blue">Operador</Badge> },
    { key: "areas", label: "Áreas", render: (o) => o.perfil === "admin"
        ? "Todas as áreas"
        : (o.areas?.length ? o.areas.map((a) => AREA_LABEL[a] ?? a).join(", ") : "—") },
    { key: "ativo", label: "Status", render: (o) => o.ativo
        ? <Badge tone="green">Ativo</Badge>
        : <Badge tone="gray">Inativo</Badge> },
    {
      key: "acoes", label: "Ações", align: "right", render: (o) => (
        <span style={{ display: "inline-flex", gap: 6 }}>
          <Button size="sm" tone="muted" onClick={() => openEdit(o)}>Editar</Button>
          <Button size="sm" tone={o.ativo ? "muted" : "green"} onClick={() => update(o.id, { ativo: !o.ativo })}>
            {o.ativo ? "Desativar" : "Ativar"}
          </Button>
          <Button size="sm" tone="danger" onClick={() => remove(o.id)}>Excluir</Button>
        </span>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Controle de Acesso"
        subtitle="Crie operadores e defina a quais áreas do CRM cada um tem acesso"
        actions={<Button tone="green" onClick={openNovo}>+ Novo operador</Button>}
      />

      <KpiGrid>
        <Kpi label="Operadores" value={items.length} icon="👤" tone="blue" />
        <Kpi label="Ativos" value={ativos} icon="✅" tone="green" />
        <Kpi label="Acesso total (admin)" value={admins} icon="🔑" tone="purple" />
      </KpiGrid>

      <div className="crm-card">
        {items.length === 0
          ? <Empty icon="🔒" title="Nenhum operador cadastrado" hint="Crie o primeiro operador para conceder acesso por área." />
          : <DataTable columns={columns} rows={items} />}
      </div>

      {modal && (
        <Modal
          open
          wide
          title={modal.id ? "Editar operador" : "Novo operador"}
          onClose={() => setModal(null)}
          footer={
            <>
              <Button tone="muted" onClick={() => setModal(null)}>Cancelar</Button>
              <Button tone="green" onClick={salvar} disabled={!modal.email.trim() || (!modal.id && !novaSenha.trim())}>Salvar</Button>
            </>
          }
        >
          <div className="crm-field-row">
            <Field label="Nome"><TextInput value={modal.nome} onChange={(v) => setModal({ ...modal, nome: v })} placeholder="Nome do operador" /></Field>
            <Field label="E-mail"><TextInput value={modal.email} onChange={(v) => setModal({ ...modal, email: v })} placeholder="email@empresa.com" /></Field>
          </div>

          <Field label={modal.id ? "Nova senha (deixe em branco para manter)" : "Senha"}>
            <TextInput type="password" value={novaSenha} onChange={setNovaSenha} placeholder="Senha de acesso" />
          </Field>

          <Field label="Perfil">
            <Select
              value={modal.perfil}
              onChange={(v) => setModal({ ...modal, perfil: v })}
              options={[
                { value: "operador", label: "Operador (áreas específicas)" },
                { value: "admin", label: "Administrador (todas as áreas)" },
              ]}
            />
          </Field>

          {modal.perfil !== "admin" && (
            <Field label="Áreas permitidas" hint="Marque as áreas que este operador poderá acessar">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 4 }}>
                {AREAS.map((a) => (
                  <label key={a.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                    <input type="checkbox" checked={modal.areas.includes(a.key)} onChange={() => toggleArea(a.key)} />
                    {a.label}
                  </label>
                ))}
              </div>
            </Field>
          )}
        </Modal>
      )}
    </div>
  );
}
