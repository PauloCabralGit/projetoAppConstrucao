# 🚀 Squad Dashboard Server

Servidor local que permite executar tarefas/histórias do planning direto do dashboard.

## Setup

### 1. Instalar dependências

```bash
npm install express cors @anthropic-ai/sdk
```

### 2. Rodar o servidor

```bash
node server.js
```

Você verá:
```
🚀 Squad Dashboard Server rodando em http://localhost:3333
```

### 3. Configurar API Key

O servidor precisa da sua **API Key da Anthropic** para funcionar.

**Opção A — Via linha de comando (bash/curl):**
```bash
curl -X POST http://localhost:3333/set-api-key \
  -H "Content-Type: application/json" \
  -d '{"apiKey":"sk-ant-..."}'
```

**Opção B — Via dashboard:**
- Abra `docs/squad-dashboard.html` no browser
- Você verá um campo para configurar a API key
- Salve, e a key será usada pelo servidor

### 4. Executar tarefas no dashboard

1. Recarregue `docs/squad-dashboard.html` (F5)
2. Cada tarefa agora tem um botão **▶** (play)
3. Clique no play → a tarefa é executada pelo agente correspondente
4. O resultado aparece em um alert
5. O status muda para "Pronto"

## Como funciona

```
Dashboard (HTML)
    ↓ (POST /execute-task)
    ↓
Servidor Node.js (localhost:3333)
    ↓ (chama API)
    ↓
Claude API (Anthropic)
    ↓ (retorna resposta)
    ↓
Servidor (responde ao dashboard)
    ↓ (resultado em JSON)
    ↓
Dashboard (atualiza tarefa + mostra resultado)
```

## Agentes disponíveis

| ID | Nome | Função |
|----|----|--------|
| `po` | Product Owner | Discovery, MVP, user stories |
| `ux` | UI/UX Designer | Wireframes, design tokens, fluxos |
| `techlead` | Tech Lead | Arquitetura, SDD, ADRs |
| `pm` | Project Manager | Plano de execução, dependências, riscos |
| `frontend` | Dev Frontend | Implementação UI, testes, performance |
| `backend` | Dev Backend | APIs, domínio, persistência |
| `qa` | QA | Testes, cenários, quality |
| `devops` | DevOps | Build, deploy, infra, observabilidade |

## Endpoints

### `GET /health`
Verifica status do servidor
```bash
curl http://localhost:3333/health
```

### `GET /agents`
Lista agentes disponíveis
```bash
curl http://localhost:3333/agents
```

### `POST /set-api-key`
Configura a API key
```bash
curl -X POST http://localhost:3333/set-api-key \
  -H "Content-Type: application/json" \
  -d '{"apiKey":"sk-ant-..."}'
```

### `POST /execute-task`
Executa uma tarefa
```bash
curl -X POST http://localhost:3333/execute-task \
  -H "Content-Type: application/json" \
  -d '{
    "taskId": 1,
    "taskTitle": "US-001: ...",
    "assignee": "po",
    "description": "Descrição detalhada da tarefa"
  }'
```

**Response (sucesso):**
```json
{
  "success": true,
  "taskId": 1,
  "taskTitle": "US-001: ...",
  "assignee": "po",
  "response": "A resposta do agente aparece aqui...",
  "usage": {
    "input_tokens": 1234,
    "output_tokens": 567
  }
}
```

**Response (erro):**
```json
{
  "error": "API key not configured. Call POST /set-api-key first.",
  "taskId": 1,
  "taskTitle": "US-001: ..."
}
```

## Troubleshooting

### ❌ "Erro ao executar: Failed to fetch"
- Certifique-se que o servidor está rodando (`node server.js`)
- Verifique se está em `http://localhost:3333` (não HTTPS)
- Abra o DevTools (F12) → Console e veja o erro exato

### ❌ "API key not configured"
- Chame `POST /set-api-key` com sua key
- Ou configure no dashboard e recarregue

### ❌ "Invalid assignee"
- Certifique-se que `assignee` é um dos IDs acima (po, ux, techlead, etc.)

### ❌ "Erro da API: invalid_request_error"
- Verifique se sua API key é válida
- Verifique se tem saldo de créditos na Anthropic

## Parar o servidor

```bash
Ctrl + C
```

## Variáveis de ambiente

Você pode configurar a API key via variável de ambiente:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
node server.js
```

Ou no Windows:
```cmd
set ANTHROPIC_API_KEY=sk-ant-...
node server.js
```

---

**💡 Dica:** O servidor roda em background enquanto você usa o dashboard. Deixe um terminal aberto com `node server.js` rodando.
