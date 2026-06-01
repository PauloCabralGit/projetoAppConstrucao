# Squad de Agentes Especialistas

Esta squad é composta por agentes especialistas que colaboram para entregar software com qualidade. Cada agente tem um arquivo próprio descrevendo sua identidade, responsabilidades, práticas e artefatos.

## Composição da Squad

| Papel | Arquivo | Responsabilidade central |
|---|---|---|
| Product Owner (PO) | [`po.md`](./po.md) | Valor de negócio, backlog, prioridades |
| UI/UX Designer | (subagent `ux-designer`) | Desenho de telas/fluxos e implementação do front |
| Project Manager (PM) | [`pm.md`](./pm.md) | Fluxo, riscos, comunicação, métricas |
| Tech Lead | [`tech-lead.md`](./tech-lead.md) | Arquitetura, decisões técnicas, qualidade |
| Dev Frontend | [`frontend-dev.md`](./frontend-dev.md) | UI, UX técnica, performance no cliente |
| Dev Backend | [`backend-dev.md`](./backend-dev.md) | APIs, domínio, persistência, integrações |
| QA | [`qa.md`](./qa.md) | Estratégia de testes, automação, qualidade |
| DevOps | [`devops.md`](./devops.md) | CI/CD, infraestrutura, observabilidade, segurança operacional |

## Como usar a squad no Claude Code

Estas personas agora também existem como **subagents reais** em [`.claude/agents/`](./agents/) — o Claude Code consegue invocá-los de verdade. Os arquivos `.md` nesta pasta seguem sendo a **documentação detalhada** (templates, checklists, antipadrões) que cada subagent consulta.

### Iniciar um planning

Use o comando **`/planning`** com a ideia ou feature:

```
/planning quero adicionar avaliação por estrelas no app do cliente
```

O orquestrador conduz o fluxo **entender → desenhar → discutir → desenvolver**:

1. **PO** define problema, MVP e user stories
2. **UI/UX** desenha as telas (wireframes + spec) e, após aprovação, codifica
3. **Tech Lead** define arquitetura/SDD e contratos
4. **PM** monta o plano de execução em fatias
5. Você aprova e a squad desenvolve (front, back, QA, devops)

Sempre que um agente tiver dúvida, o orquestrador **pergunta a você** antes de seguir — nenhum requisito é inventado.

### Invocar um agente isolado

Também dá para chamar um papel direto, ex.: *"use o agente `ux-designer` para desenhar a tela de busca"* ou *"peça ao `tech-lead` para avaliar trocar Cloudflare por AWS"*.

## Metodologia: Kanban

A squad trabalha com fluxo contínuo, **sem sprints fixos**, priorizando WIP limitado e entregas pequenas e frequentes.

### Colunas do board

```
Backlog → Refinamento → Pronto p/ Dev → Em Dev → Code Review → QA → Pronto p/ Deploy → Em Produção → Done
```

### Limites de WIP (sugestão inicial)

- **Em Dev:** 1 item por dev (front e back contam separado)
- **Code Review:** 2 itens (ninguém deve ter mais que 1 PR seu esperando review)
- **QA:** 3 itens
- **Pronto p/ Deploy:** 2 itens

Quando uma coluna estoura o WIP, a squad **para de puxar trabalho novo** e ajuda a destravar o gargalo.

### Métricas que a squad acompanha

- **Lead Time** — do "Pronto p/ Dev" ao "Done"
- **Cycle Time** — do "Em Dev" ao "Done"
- **Throughput** — itens entregues por semana
- **WIP médio** — quanto trabalho em paralelo
- **Aging WIP** — itens parados há muito tempo (alerta de gargalo)
- **Escaped defects** — bugs que chegaram em produção

## Cerimônias

| Cerimônia | Frequência | Quem participa | Objetivo |
|---|---|---|---|
| Daily | Diária, 15min | Toda a squad | Destravar bloqueios, sincronizar fluxo (foco no board, não nas pessoas) |
| Refinamento | 2x por semana, 1h | PO, PM, Tech Lead, QA, devs (rotativo) | Quebrar e detalhar itens do backlog até estarem "Prontos p/ Dev" |
| Replenishment | Semanal, 30min | PO, PM, Tech Lead | Repor topo do backlog priorizado |
| Service Delivery Review | Quinzenal, 45min | Toda a squad + stakeholders | Olhar métricas, lead time, throughput |
| Retrospectiva | Quinzenal, 1h | Toda a squad | Melhorar o processo |
| Risk Review | Mensal, 30min | PM, Tech Lead, DevOps, QA | Revisar riscos técnicos, de segurança e de prazo |

## Definição de Pronto para Dev (DoR)

Um item só sai do "Refinamento" quando:

- [ ] User story escrita no formato `Como <persona>, quero <ação>, para <valor>`
- [ ] Critérios de aceite claros (Given/When/Then quando aplicável)
- [ ] Spec técnica anexada (ver [`tech-lead.md`](./tech-lead.md) para SDD)
- [ ] Dependências mapeadas
- [ ] Riscos de segurança e performance levantados
- [ ] Estimado em tamanho (P, M, G) — não em horas
- [ ] QA aprovou os critérios de aceite e a estratégia de teste

## Definição de Pronto (DoD)

Um item só vai para "Done" quando:

- [ ] Código revisado por pelo menos 1 outro dev + Tech Lead (em mudanças arquiteturais)
- [ ] Testes automatizados escritos e passando (unit + integração + e2e quando aplicável)
- [ ] Cobertura de testes não regrediu
- [ ] Testes manuais exploratórios feitos pelo QA
- [ ] Análise de segurança (SAST/dependências) sem alertas críticos
- [ ] Performance validada (carga quando aplicável)
- [ ] Deploy em produção feito e monitorado
- [ ] Documentação atualizada (README, ADR, runbook se necessário)
- [ ] Métricas/observabilidade configuradas para a feature

## Como os agentes se conversam

Cada agente segue um **protocolo de comunicação** explícito (descrito no arquivo dele). Em geral:

1. **PO** traz a demanda → **PM** prioriza no fluxo → **Tech Lead** + **QA** participam do refinamento
2. **Tech Lead** propõe SDD → **Devs** dão input → **DevOps** valida impacto de infra
3. **Dev** abre PR → **Tech Lead** + outro **Dev** revisam → **QA** valida
4. **QA** aprova → **DevOps** cuida do pipeline e deploy
5. Em produção, **DevOps** monitora; qualquer um pode acionar **rollback**

## Práticas que a squad pratica

- **TDD** (Test-Driven Development) — para lógica de domínio, regras de negócio críticas
- **SDD** (Specification-Driven Development) — toda feature começa com spec escrita pelo Tech Lead + PO
- **Code Review** obrigatório em todo PR
- **Pair / Mob programming** para itens complexos ou de alto risco
- **Trunk-based development** com feature flags
- **Continuous Integration** — build + testes a cada push
- **Continuous Delivery** — sempre deployável
- **Testes automatizados** em camadas (pirâmide: unit > integração > e2e)
- **Testes manuais** exploratórios (sessões com charter)
- **Testes de carga e performance** antes de releases grandes
- **Threat modeling** (STRIDE) em features sensíveis
- **Observabilidade by design** — logs, métricas e traces desde o primeiro commit

## Como usar estes arquivos

Cada `.md` é uma **persona/agente** autônomo. Você pode:

- Carregá-los como system prompt em assistentes de IA (Claude, Cursor, Copilot Workspace)
- Usá-los como onboarding de novos membros
- Tratá-los como contratos de papel dentro da squad
- Compor conversas entre eles (ex: "PO pergunta ao Tech Lead", "QA pergunta ao Backend")
