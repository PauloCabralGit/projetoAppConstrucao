# 🚀 SEMANA 3 — TESTES E2E + PERFORMANCE + DEPLOY

Sistema de **Avaliação por Estrelas** — Testes e Deploy em Staging/Produção

---

## 📖 QUICK START

### 1. Executar Testes E2E (US-012)
```bash
# Instalar dependências do Detox/Appium (se necessário)
npm install --workspace=apps/mobile-client

# Rodar todos os 8 testes E2E
npm run test:e2e

# Resultado esperado: ✅ 8/8 testes passando
```

### 2. Executar Testes de Performance (US-013)
```bash
# Instalar Jest e dependências de teste
npm install --save-dev jest @types/jest --workspace=apps/api

# Rodar testes de performance
npm run test:perf

# Resultado esperado: ✅ Todas as métricas dentro dos targets
```

### 3. Deploy em Staging (US-014)
```bash
# Apenas staging não requer confirmação
npm run deploy:staging

# Ou manualmente:
bash scripts/deploy-staging.sh

# URLs de staging:
# - Web: https://staging-web.pages.dev
# - API: https://staging-api.construconnect.workers.dev
```

### 4. Deploy em Produção (US-015)
```bash
# Requer confirmação interativa + env vars
npm run deploy:production

# Ou manualmente:
bash scripts/deploy-production.sh

# Será solicitado: "Digite 'sim' para continuar:"
```

---

## 🧪 TESTES E2E (US-012)

### O que é testado?

```
✅ Rating Modal
   └─ Aparece após conclusão do serviço
   └─ Mostra nome do provider
   └─ Mostra campo de estrelas (1-5)
   └─ Mostra campo de comentário (max 200 chars)

✅ Submissão de Rating
   └─ Selecionar 5 estrelas + comentário = sucesso
   └─ Sem selecionar estrela = botão desabilitado
   └─ Comentário > 200 chars = trunca automaticamente

✅ Histórico de Avaliações
   └─ Rating aparece após submissão
   └─ Mostra Score + Comentário + Data
   └─ Paginação infinita (50 itens por página)

✅ Prevenção de Duplicação
   └─ Não permite avaliar 2x o mesmo serviço
   └─ Mostra erro ou oculta modal

✅ Dashboard do Provider
   └─ Nota média é atualizada
   └─ Pull-to-refresh funciona
```

### Arquivos de Teste

```
apps/mobile-client/e2e/
└── rating.e2e.ts (347 linhas)
    ├── TEST 1: Modal aparece após conclusão ✓
    ├── TEST 2: Submissão com stars + comment ✓
    ├── TEST 3: Validação de score obrigatório ✓
    ├── TEST 4: Limite de 200 chars ✓
    ├── TEST 5: Rating no histórico ✓
    ├── TEST 6: Prevenção de duplicação ✓
    ├── TEST 7: Atualização provider dashboard ✓
    └── TEST 8: Paginação infinita ✓
```

### Como rodar testes específicos?

```bash
# Rodar apenas um teste
npm run test:e2e -- --testNamePattern="should display rating modal"

# Rodar com verbose output
npm run test:e2e -- --verbose

# Rodar com watch mode
npm run test:e2e -- --watch

# Debug um teste
npm run test:e2e -- --testNamePattern="should submit rating" --verbose
```

---

## 📊 TESTES DE PERFORMANCE (US-013)

### O que é validado?

```
✅ Latência de Requisições
   ├─ POST /ratings P95 < 200ms
   ├─ GET /ratings P95 < 300ms
   └─ P99 < 500ms

✅ Load Test (100 concurrent users)
   ├─ 100% sucesso
   ├─ 0% erro
   └─ Avg response < 100ms

✅ Consistência de Dados
   ├─ ratings_stats = ratings table
   ├─ Total count match: 100%
   └─ Divergência: 0 casos

✅ Índices
   ├─ Nenhuma full table scan
   ├─ Queries < 100ms
   └─ Índices sendo usados

✅ Transações
   ├─ SERIALIZABLE isolation
   ├─ Prevenção de race condition
   └─ Duplicação bloqueada
```

### Arquivos de Teste

```
apps/api/test/
└── performance.spec.ts (500+ linhas)
    ├── Suite 1: Latency Tests ✓
    ├── Suite 2: Load Tests ✓
    ├── Suite 3: Data Consistency ✓
    ├── Suite 4: Index Verification ✓
    ├── Suite 5: Transaction Isolation ✓
    └── Suite 6: Final Report ✓
```

### Como rodar testes de performance?

```bash
# Rodar todos os testes de performance
npm run test:perf

# Rodar suite específica
npm run test:perf -- --testPathPattern="latency"

# Com timeout aumentado (para load tests)
npm run test:perf -- --testTimeout=120000

# Ver métricas detalhadas
npm run test:perf -- --verbose --forceExit
```

---

## 🚀 DEPLOY EM STAGING (US-014)

### Pré-requisitos

```bash
# 1. Node.js 18+
node --version  # v18.12.0+

# 2. Wrangler CLI
npm install -g wrangler
wrangler --version

# 3. Cloudflare credenciais (auth via CLI)
wrangler login

# 4. Git na branch main
git checkout main
git pull origin main
```

### Executar Deploy

```bash
# Opção 1: Via npm script
npm run deploy:staging

# Opção 2: Via shell script direto
chmod +x scripts/deploy-staging.sh
./scripts/deploy-staging.sh

# Saída esperada:
# ✅ Branch validada: main
# ✅ Testes concluídos
# ✅ Web app compilada com sucesso
# ✅ API compilada com sucesso
# ✅ Web deploy concluído
# ✅ API deploy concluído
# ✅ Smoke tests concluídos
# ✅ DEPLOY STAGING CONCLUÍDO COM SUCESSO!
```

### Verificar Deploy

```bash
# Health check Web
curl https://staging-web.pages.dev

# Health check API
curl https://staging-api.construconnect.workers.dev/health

# Testar endpoint de ratings
curl -X GET "https://staging-api.construconnect.workers.dev/v1/ratings" \
  -H "Content-Type: application/json"
```

### Rollback Staging (se necessário)

```bash
# Simplesmente re-execute o deploy anterior
git revert HEAD
./scripts/deploy-staging.sh
```

---

## 🌍 DEPLOY EM PRODUÇÃO (US-015)

### Pré-requisitos

```bash
# 1. Staging rodou por 24h sem erros
# 2. Env vars de produção configuradas:
export PROD_API_KEY="your-production-api-key"
export PROD_SUPABASE_URL="https://prod.supabase.co"
export SENTRY_TOKEN="your-sentry-token"
export DATADOG_API_KEY="your-datadog-api-key"
export SLACK_WEBHOOK_URL="https://hooks.slack.com/..."

# 3. Estar na branch main
git checkout main
git pull origin main

# 4. Verificar que não há uncommitted changes
git status
```

### Executar Deploy

```bash
# Opção 1: Via npm script
npm run deploy:production

# Opção 2: Via shell script direto
chmod +x scripts/deploy-production.sh
./scripts/deploy-production.sh

# Será solicitado:
# "ATENÇÃO: Este comando vai fazer deploy em PRODUÇÃO"
# "Digite 'sim' para continuar:"

# Digite: sim

# Deploy procederá:
# PHASE 1: Rollout 10% (5 min) - beta testers
# PHASE 2: Rollout 50% (10 min) - standard users
# PHASE 3: Rollout 100% - FULL RELEASE
```

### Monitorar Deploy

```bash
# Durante o deploy, em outro terminal:

# Terminal 1: Watch Sentry errors
open https://sentry.io/construconnect/ratings/

# Terminal 2: Watch Datadog dashboard
open https://datadog.construconnect.com/dashboard/ratings

# Terminal 3: Check Slack for notifications
# Procure por mensagem: "✅ Produção Deploy — Ratings System"

# Terminal 4: Manual health check
while true; do
  curl -s https://construconnect-api.orionsystem.workers.dev/health | jq .
  sleep 5
done
```

### Rollback Produção (emergência)

```bash
# Se erro rate > 1% foi detectado em Phase 1,
# rollback é AUTOMÁTICO

# Ou rollback manual:
git revert HEAD --no-edit
git push origin main

# Desativar feature flag
# (ver instruções em scripts/deploy-production.sh)
```

---

## 📋 CHECKLIST PRÉ-DEPLOY

### Antes de Staging
- [ ] Código foi revisado (code review)
- [ ] Testes E2E passando: `npm run test:e2e`
- [ ] Testes de performance passando: `npm run test:perf`
- [ ] Nenhuma mudança não committada: `git status`
- [ ] Branch é main: `git branch`
- [ ] Build local sucedeu: `npm run build`

### Antes de Produção
- [ ] Staging rodou por 24h sem erros
- [ ] Métricas de staging validadas:
  - [ ] 0 erros em Sentry
  - [ ] P95 latência < 200ms
  - [ ] ratings_stats sync: 100%
- [ ] Env vars de produção estão definidos
- [ ] Equipe foi notificada
- [ ] Plano de rollback documentado
- [ ] Monitoramento foi configurado

---

## 🔍 TROUBLESHOOTING

### "Branch not 'main'"
```bash
git checkout main
git pull origin main
npm run deploy:staging
```

### "Uncommitted changes"
```bash
git status
git add .
git commit -m "fix: staging pre-deploy changes"
npm run deploy:staging
```

### "wrangler: command not found"
```bash
npm install -g wrangler
# ou
npx wrangler --version
```

### Smoke tests failing
```bash
# Verificar API
curl -v https://staging-api.construconnect.workers.dev/health
# Status esperado: 200 OK

# Verificar Web
curl -I https://staging-web.pages.dev
# Status esperado: 200

# Ver logs no Cloudflare dashboard
open https://dash.cloudflare.com
```

### Performance tests slow
```bash
# Verificar se testes podem conectar à API
curl https://construconnect-api.orionsystem.workers.dev/health

# Rodar testes com timeout aumentado
npm run test:perf -- --testTimeout=180000

# Ver qual teste está lento
npm run test:perf -- --verbose --detectOpenHandles
```

---

## 📚 ARQUIVOS CRIADOS

| Arquivo | Descrição |
|---------|-----------|
| `apps/mobile-client/e2e/rating.e2e.ts` | 8 testes E2E do modal de ratings |
| `apps/api/test/performance.spec.ts` | 5 suites de testes de performance |
| `scripts/deploy-staging.sh` | Script de deploy em staging |
| `scripts/deploy-production.sh` | Script de deploy em produção (com rollout gradual) |
| `WEEK3-EXECUTION.md` | Documentação detalhada da Semana 3 |
| `SEMANA3-README.md` | Este arquivo (quick start) |

---

## 📞 SUPORTE

**Dúvidas sobre Testes E2E?**
- Veja: `apps/mobile-client/e2e/rating.e2e.ts` (comentários detalhados)
- Framework: Detox/Appium para React Native

**Dúvidas sobre Performance?**
- Veja: `apps/api/test/performance.spec.ts`
- Framework: Jest com custom HTTP clients

**Dúvidas sobre Deploy?**
- Staging: `scripts/deploy-staging.sh` (comentários detalhados)
- Produção: `scripts/deploy-production.sh` (com rollout gradual)

**Problemas de Deploy?**
- Verificar logs: `git log --oneline -10`
- Verificar status: `git status`
- Revert se necessário: `git revert HEAD`

---

## ✅ STATUS FINAL

```
SEMANA 3 — COMPLETA ✅

US-012: Testes E2E (8 testes) .................... ✅ IMPLEMENTADO
US-013: Testes de Performance ................... ✅ IMPLEMENTADO
US-014: Deploy em Staging ....................... ✅ PRONTO
US-015: Deploy em Produção ...................... ✅ PRONTO

TOTAL: 4/4 TAREFAS COMPLETAS (100%)
```

---

**Executor:** Squad ConstruConnect  
**Data:** 2026-06-02  
**Status:** Semana 3 — Pronto para Execução ✅
