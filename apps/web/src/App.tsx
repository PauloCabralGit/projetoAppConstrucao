import { useState } from "react";
import type { RegistrationPayload, UserRole } from "@construconnect/shared";
import { dashboardMetrics, providerProfiles, serviceRequests } from "./data";
import { registerBiometricCredential } from "./lib/webauthn";

const roleLabels: Record<UserRole, string> = {
  client: "Cliente",
  builder: "Pedreiro",
  contractor: "Empreiteiro"
};

const initialRegistration: RegistrationPayload = {
  role: "client",
  fullName: "",
  email: "",
  phone: "",
  city: "",
  document: "",
  specialties: [],
  companyName: "",
  acceptsEmergencyJobs: false
};

type ProviderFilter = "todos" | "builder" | "contractor";

export function App() {
  const [selectedRole, setSelectedRole] = useState<UserRole>("client");
  const [registration, setRegistration] = useState<RegistrationPayload>(initialRegistration);
  const [filter, setFilter] = useState<ProviderFilter>("todos");
  const [message, setMessage] = useState("Biometria opcional na POC, pronta para virar login com passkey.");

  const filteredProviders =
    filter === "todos" ? providerProfiles : providerProfiles.filter((profile) => profile.role === filter);

  function updateField<K extends keyof RegistrationPayload>(field: K, value: RegistrationPayload[K]) {
    setRegistration((current) => ({
      ...current,
      role: selectedRole,
      [field]: value
    }));
  }

  async function handleBiometricSetup() {
    try {
      const result = await registerBiometricCredential(registration.fullName || "Novo usuario");
      setMessage(`Biometria preparada com credencial ${result.credentialId.slice(0, 12)}...`);
    } catch (error) {
      const details = error instanceof Error ? error.message : "Falha desconhecida.";
      setMessage(details);
    }
  }

  function handleRegistrationSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(
      `${roleLabels[selectedRole]} ${registration.fullName || "sem nome"} cadastrado na POC. Proximo passo: persistir no Postgres e validar WebAuthn na API.`
    );
  }

  return (
    <div className="shell">
      <header className="hero">
        <nav className="topbar">
          <div className="brand">
            <span className="brand-mark">CC</span>
            <div>
              <strong>ConstruConnect</strong>
              <p>Uber da construcao para contratar e atender obras.</p>
            </div>
          </div>
          <a className="ghost-button" href="#cadastro">
            Criar POC
          </a>
        </nav>

        <section className="hero-grid">
          <div className="hero-copy">
            <span className="eyebrow">Marketplace de servicos</span>
            <h1>Contrate pedreiros e empreiteiros com a experiencia de um app de corrida.</h1>
            <p>
              Encontre profissionais por cidade, tipo de servico, disponibilidade e reputacao. A base ja nasce pronta
              para crescer depois para construtoras e materiais de construcao.
            </p>
            <div className="hero-actions">
              <a className="primary-button" href="#profissionais">
                Ver profissionais
              </a>
              <a className="secondary-button" href="#painel">
                Explorar painel
              </a>
            </div>
            <div className="hero-badges">
              <span>Biometria com passkeys</span>
              <span>Postgres para escala</span>
              <span>Cloudflare para POC</span>
            </div>
          </div>

          <div className="hero-card">
            <div className="ride-card">
              <div className="ride-card-top">
                <div>
                  <p className="muted">Chamado rapido</p>
                  <strong>Reforma de banheiro</strong>
                </div>
                <span className="surge">Aceite em 9 min</span>
              </div>
              <div className="route-line">
                <span className="dot start" />
                <span className="line" />
                <span className="dot end" />
              </div>
              <div className="ride-stops">
                <div>
                  <p className="muted">Cliente</p>
                  <strong>Vila Mariana, Sao Paulo</strong>
                </div>
                <div>
                  <p className="muted">Prestador</p>
                  <strong>Marcos Silva, 2.4 km</strong>
                </div>
              </div>
            </div>
            <div className="stats-grid">
              {dashboardMetrics.map((metric) => (
                <article className="stat-card" key={metric.label}>
                  <span>{metric.label}</span>
                  <strong>{metric.value}</strong>
                  <p>{metric.trend}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
      </header>

      <main>
        <section className="section" id="cadastro">
          <div className="section-heading">
            <span className="eyebrow">Onboarding</span>
            <h2>Cadastro de cliente, pedreiro ou empreiteiro</h2>
            <p>A mesma base suporta expansao futura para construtoras, equipes e fornecedores.</p>
          </div>

          <div className="registration-layout">
            <aside className="role-switch">
              {(["client", "builder", "contractor"] as UserRole[]).map((role) => (
                <button
                  key={role}
                  className={selectedRole === role ? "role-pill active" : "role-pill"}
                  onClick={() => {
                    setSelectedRole(role);
                    setRegistration((current) => ({ ...current, role }));
                  }}
                  type="button"
                >
                  {roleLabels[role]}
                </button>
              ))}
              <p className="support-note">
                Para construtoras e lojas de material, basta incluir novos papeis na tabela `app_users`.
              </p>
            </aside>

            <form className="registration-form" onSubmit={handleRegistrationSubmit}>
              <label>
                Nome completo
                <input
                  value={registration.fullName}
                  onChange={(event) => updateField("fullName", event.target.value)}
                  placeholder="Ex.: Marcos da Silva"
                />
              </label>

              <label>
                E-mail
                <input
                  type="email"
                  value={registration.email}
                  onChange={(event) => updateField("email", event.target.value)}
                  placeholder="voce@exemplo.com"
                />
              </label>

              <div className="split">
                <label>
                  Telefone
                  <input
                    value={registration.phone}
                    onChange={(event) => updateField("phone", event.target.value)}
                    placeholder="(11) 99999-9999"
                  />
                </label>

                <label>
                  Cidade
                  <input
                    value={registration.city}
                    onChange={(event) => updateField("city", event.target.value)}
                    placeholder="Sao Paulo, SP"
                  />
                </label>
              </div>

              <label>
                Documento
                <input
                  value={registration.document}
                  onChange={(event) => updateField("document", event.target.value)}
                  placeholder="CPF ou CNPJ"
                />
              </label>

              {selectedRole !== "client" && (
                <>
                  <label>
                    Especialidades
                    <input
                      value={registration.specialties?.join(", ") || ""}
                      onChange={(event) =>
                        updateField(
                          "specialties",
                          event.target.value
                            .split(",")
                            .map((item) => item.trim())
                            .filter(Boolean)
                        )
                      }
                      placeholder="Alvenaria, piso, pintura"
                    />
                  </label>

                  <label>
                    Nome da empresa ou equipe
                    <input
                      value={registration.companyName || ""}
                      onChange={(event) => updateField("companyName", event.target.value)}
                      placeholder="Opcional"
                    />
                  </label>

                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={registration.acceptsEmergencyJobs || false}
                      onChange={(event) => updateField("acceptsEmergencyJobs", event.target.checked)}
                    />
                    Aceita chamados urgentes
                  </label>
                </>
              )}

              <div className="form-actions">
                <button className="primary-button" type="submit">
                  Salvar cadastro
                </button>
                <button className="secondary-button" type="button" onClick={handleBiometricSetup}>
                  Ativar biometria
                </button>
              </div>
              <p className="status-box">{message}</p>
            </form>
          </div>
        </section>

        <section className="section" id="profissionais">
          <div className="section-heading row">
            <div>
              <span className="eyebrow">Matching</span>
              <h2>Profissionais prontos para receber chamados</h2>
            </div>
            <div className="filter-row">
              <button className={filter === "todos" ? "chip active" : "chip"} onClick={() => setFilter("todos")} type="button">
                Todos
              </button>
              <button
                className={filter === "builder" ? "chip active" : "chip"}
                onClick={() => setFilter("builder")}
                type="button"
              >
                Pedreiros
              </button>
              <button
                className={filter === "contractor" ? "chip active" : "chip"}
                onClick={() => setFilter("contractor")}
                type="button"
              >
                Empreiteiros
              </button>
            </div>
          </div>

          <div className="providers-grid">
            {filteredProviders.map((profile) => (
              <article className="provider-card" key={profile.id}>
                <div className="provider-head">
                  <div>
                    <span className="provider-role">{roleLabels[profile.role]}</span>
                    <h3>{profile.name}</h3>
                  </div>
                  <span className={`availability ${profile.availability}`}>{profile.availability}</span>
                </div>
                <p>{profile.bio}</p>
                <div className="provider-meta">
                  <strong>⭐ {profile.rating}</strong>
                  <span>{profile.completedJobs} servicos</span>
                  <span>A partir de R$ {profile.priceFrom}</span>
                </div>
                <div className="tag-row">
                  {profile.skills.map((skill) => (
                    <span className="tag" key={skill.id}>
                      {skill.label}
                    </span>
                  ))}
                </div>
                <footer className="provider-footer">
                  <span>{profile.city}</span>
                  <button className="ghost-button" type="button">
                    Solicitar
                  </button>
                </footer>
              </article>
            ))}
          </div>
        </section>

        <section className="section dashboard" id="painel">
          <div className="section-heading">
            <span className="eyebrow">Operacao</span>
            <h2>Painel da plataforma</h2>
            <p>Visao inicial para acompanhar servicos, prestadores e proxima camada do negocio.</p>
          </div>

          <div className="dashboard-grid">
            <article className="panel large">
              <h3>Chamados recentes</h3>
              <div className="request-list">
                {serviceRequests.map((request) => (
                  <div className="request-item" key={request.id}>
                    <div>
                      <strong>{request.category}</strong>
                      <p>{request.description}</p>
                    </div>
                    <div className="request-side">
                      <span>{request.city}</span>
                      <span>
                        R$ {request.budgetMin} - R$ {request.budgetMax}
                      </span>
                      <span className={`request-status ${request.status}`}>{request.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            </article>

            <article className="panel">
              <h3>Roadmap de expansao</h3>
              <ul className="plain-list">
                <li>Construtoras com cadastro corporativo e multiplas equipes</li>
                <li>Catalogo de materiais com pedido e entrega</li>
                <li>Pagamento dentro do app</li>
                <li>Avaliacao por etapa da obra e liberacao por marco</li>
              </ul>
            </article>

            <article className="panel">
              <h3>Infra agora e depois</h3>
              <ul className="plain-list">
                <li>Agora: Cloudflare Pages + Workers + Postgres gerenciado</li>
                <li>Depois: AWS com RDS, filas, storage e analytics dedicados</li>
                <li>Biometria: WebAuthn para Face ID, Touch ID e Windows Hello</li>
              </ul>
            </article>
          </div>
        </section>
      </main>
    </div>
  );
}
