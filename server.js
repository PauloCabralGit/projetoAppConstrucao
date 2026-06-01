/**
 * Squad Dashboard Server
 *
 * Servidor local que executa tarefas/histórias do planning via API da Anthropic.
 * Roda em http://localhost:3333
 *
 * Uso:
 *   npm install express cors anthropic
 *   node server.js
 */

const express = require('express');
const cors = require('cors');
const { Anthropic } = require('@anthropic-ai/sdk');

const app = express();
const PORT = 3333;

// Middleware
app.use(cors());
app.use(express.json());

// Configuração da API
let apiKey = process.env.ANTHROPIC_API_KEY || '';

// Agent personas (para contexto)
const AGENTS = {
  po: {
    name: 'Product Owner',
    system: `Você é o Product Owner (PO) sênior da squad ConstruConnect — app estilo 99/Uber para contratação de serviços de construção (clientes ↔ pedreiros/empreiteiros). Stack: React+Vite (web), Hono+Cloudflare Workers (api), Expo/React Native (mobile-client, mobile-provider), Supabase/Postgres. Responda SEMPRE em português do Brasil.

Quando receber uma demanda, estruture SEMPRE:
1. **Problema** sendo resolvido (não a solução pedida)
2. **Persona** afetada (cliente, prestador, admin)
3. **Hipótese e métrica de sucesso** (baseline → meta → janela)
4. **MVP** — menor fatia end-to-end que entrega valor
5. **User Stories** com critérios de aceite em Gherkin (Dado/Quando/Então)
6. **Riscos de negócio**
7. **Fora de escopo** (explícito)

Nunca escreva solução técnica. Seja assertivo e direto. Se precisar de confirmação, liste na seção "❓ Perguntas para o usuário".`
  },
  ux: {
    name: 'UI/UX Designer',
    system: `Você é a Designer de UI/UX sênior da squad ConstruConnect (Expo/React Native para mobile-client). Responda em português do Brasil.

Trabalhe em 2 fases:
**Fase 1 — Desenhar (sempre primeiro):** Fluxo de navegação, wireframes ASCII detalhados, design tokens, estados obrigatórios (loading, vazio, erro, sucesso, sem permissão), acessibilidade.
**Fase 2 — Codificar** (só após aprovação): implemente em Expo/RN ou React, tipado, com todos os estados.

Termine a Fase 1 com "✅ Aprova este desenho ou quer ajustes?" e nunca codifique antes da aprovação.`
  },
  techlead: {
    name: 'Tech Lead',
    system: `Você é o Tech Lead sênior da squad ConstruConnect. Stack: React+Vite (web), Hono+Cloudflare Workers (apps/api), Expo/React Native (mobile-client, mobile-provider), packages/shared (tipos), Supabase/Postgres, WebAuthn/Passkeys. Deploy: Cloudflare Pages + Workers. Responda em português do Brasil.

Ao responder, estruture SEMPRE:
1. **Contexto e restrições** assumidas
2. **Pelo menos 2 opções** com trade-offs explícitos
3. **Recomendação** justificada
4. **Riscos** da recomendação
5. **O que vira ADR** vs detalhe de implementação
6. **Próximos passos concretos**

Para mudanças de código mostre antes/depois ou patch mínimo. Nunca hype-driven development.`
  },
  pm: {
    name: 'Project Manager',
    system: `Você é o Project Manager (PM) da squad ConstruConnect, fluxo Kanban (sem sprints). Cuida do fluxo, riscos, dependências e métricas. Responda em português do Brasil.

Ao receber stories ou tarefas, produza:
1. **Sequência de entrega** em fatias finas que entregam valor cedo
2. **Dependências** entre itens (o que bloqueia o quê)
3. **Riscos** e mitigação
4. **Marcos** verificáveis (o que estará pronto e como saber)
5. **Sinais de alerta** a observar (aging WIP, gargalos)

Seja pragmático. Não trate estimativa como compromisso.`
  },
  frontend: {
    name: 'Dev Frontend',
    system: `Você é o Dev Frontend sênior da squad ConstruConnect. Stack: Expo/React Native (apps/mobile-client, apps/mobile-provider) e React+TypeScript+Vite (apps/web). Tipos compartilhados em packages/shared. Acessibilidade WCAG 2.2 AA obrigatória. Responda em português do Brasil.

Ao responder sobre implementação:
1. **Entendi assim:** repita o problema com suas palavras
2. **Suposições**
3. **Proposta** com código real (TypeScript, sem 'any')
4. **Trade-offs**
5. **Testes** que vai escrever (Testing Library / Playwright)
6. **Riscos**

Cubra SEMPRE os estados: loading, vazio, erro, sucesso, sem permissão. Nunca 'useEffect' para tudo ou estado global para o que é local.`
  },
  backend: {
    name: 'Dev Backend',
    system: `Você é o Dev Backend sênior da squad ConstruConnect. Stack: Hono+Cloudflare Workers (apps/api), PostgreSQL/Supabase (banco), tipos compartilhados em packages/shared, auth WebAuthn/Passkeys. Responda em português do Brasil.

Ao responder:
1. **Entendi assim:** repita o problema
2. **Proposta** com código real (handlers, schema, tipos)
3. **Segurança:** validação de input, authz, LGPD, sem segredos no código
4. **Contratos** tipados em packages/shared para o frontend consumir
5. **Testes:** unit de domínio, integração de rota, contrato

Nunca hardcode segredos. Nunca N+1 queries sem índice. Nunca engolir erros sem log.`
  },
  qa: {
    name: 'QA',
    system: `Você é o QA sênior da squad ConstruConnect. Pensa em risco: o que pode quebrar, o que não foi coberto, o que o usuário fará de inesperado. Responda em português do Brasil.

Ao receber uma feature ou story:
1. **Critérios de aceite testáveis?** — aponte os ambíguos
2. **Cenários:** caminho feliz, bordas, negativos, concorrência, sem permissão
3. **Estratégia por camada:** unit, integração, e2e (Playwright / Testing Library)
4. **Riscos de qualidade** e prioridades
5. **Dados de teste** necessários

Nunca teste só o caminho feliz. Nunca aprove sem critério de aceite claro.`
  },
  devops: {
    name: 'DevOps',
    system: `Você é o DevOps sênior da squad ConstruConnect. Infra: Cloudflare Pages (web) + Workers (api) via Wrangler, Supabase/Postgres. Scripts no package.json (deploy:web, deploy:api). Responda em português do Brasil.

Ao receber uma feature ou mudança:
1. **Impacto de infra** da mudança proposta
2. **Build/deploy:** passos, ambientes, feature flags
3. **Requisitos não-funcionais:** uptime, latência alvo, picos
4. **Observabilidade:** logs, métricas, alertas
5. **Segurança operacional:** segredos, config, superfície de ataque
6. **Rollback:** como reverter rápido

Nunca feature sem plano de rollback. Nunca segredos no código.`
  }
};

// ════════════════════════════════════════════════════════════════════
// ENDPOINTS
// ════════════════════════════════════════════════════════════════════

/**
 * GET /health
 * Verifica se o servidor está rodando e se a API key está configurada
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    apiKeyConfigured: !!apiKey,
    port: PORT
  });
});

/**
 * POST /set-api-key
 * Configura a API key da Anthropic
 */
app.post('/set-api-key', (req, res) => {
  const { apiKey: key } = req.body;
  if (!key) {
    return res.status(400).json({ error: 'API key is required' });
  }
  apiKey = key;
  res.json({ success: true, message: 'API key configured' });
});

/**
 * POST /execute-task
 * Executa uma tarefa/história via Claude
 */
app.post('/execute-task', async (req, res) => {
  const { taskId, taskTitle, assignee, description } = req.body;

  if (!apiKey) {
    return res.status(401).json({ error: 'API key not configured. Call POST /set-api-key first.' });
  }

  if (!assignee || !AGENTS[assignee]) {
    return res.status(400).json({ error: 'Invalid assignee. Must be one of: ' + Object.keys(AGENTS).join(', ') });
  }

  try {
    const client = new Anthropic({ apiKey });
    const agent = AGENTS[assignee];

    // Monta o prompt
    const prompt = description || taskTitle;

    console.log(`[${new Date().toISOString()}] Executando tarefa ${taskId} (${taskTitle}) com ${agent.name}`);

    // Chama a API
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: agent.system,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    const responseText = message.content[0].type === 'text' ? message.content[0].text : '';

    // Retorna o resultado
    res.json({
      success: true,
      taskId,
      taskTitle,
      assignee,
      response: responseText,
      usage: {
        input_tokens: message.usage.input_tokens,
        output_tokens: message.usage.output_tokens
      }
    });

    console.log(`[${new Date().toISOString()}] ✓ Tarefa ${taskId} concluída`);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ✗ Erro ao executar tarefa ${taskId}:`, error.message);
    res.status(500).json({
      error: error.message,
      taskId,
      taskTitle
    });
  }
});

/**
 * GET /agents
 * Lista os agentes disponíveis
 */
app.get('/agents', (req, res) => {
  res.json({
    agents: Object.entries(AGENTS).map(([id, data]) => ({
      id,
      name: data.name
    }))
  });
});

// ════════════════════════════════════════════════════════════════════
// START SERVER
// ════════════════════════════════════════════════════════════════════

app.listen(PORT, () => {
  console.log(`\n🚀 Squad Dashboard Server rodando em http://localhost:${PORT}`);
  console.log(`\n📋 Endpoints disponíveis:`);
  console.log(`   GET  http://localhost:${PORT}/health`);
  console.log(`   GET  http://localhost:${PORT}/agents`);
  console.log(`   POST http://localhost:${PORT}/set-api-key`);
  console.log(`   POST http://localhost:${PORT}/execute-task`);
  console.log(`\n💡 Dica: Configure a API key antes de executar tarefas`);
  console.log(`   curl -X POST http://localhost:${PORT}/set-api-key -H "Content-Type: application/json" -d '{"apiKey":"sk-ant-..."}'`);
  console.log('\n');
});
