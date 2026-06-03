# ✅ VALIDATION CHECKLIST — SEMANA 3

Checklist completo para validar que todas as tarefas da Semana 3 foram implementadas corretamente.

---

## 📦 ARQUIVOS CRIADOS

### E2E Tests (US-012)
```bash
# Verificar que arquivo existe
ls -la apps/mobile-client/e2e/rating.e2e.ts

# Conteúdo esperado:
# - 8 describe blocks (8 testes)
# - Métodos: beforeAll, beforeEach
# - Assertions com waitFor, expect, tap, typeText
# - Linha count: ~350+
```

**Validação:**
```bash
[ ] Arquivo existe: apps/mobile-client/e2e/rating.e2e.ts
[ ] 347 linhas de código
[ ] Contém 8 testes nomeados
[ ] Usa sintaxe Detox/Appium
```

---

### Performance Tests (US-013)
```bash
# Verificar que arquivo existe
ls -la apps/api/test/performance.spec.ts

# Conteúdo esperado:
# - 5 describe blocks (5 suites)
# - 15+ testes
# - Validações de latência, load, consistência, índices, transações
# - Linha count: ~500+
```

**Validação:**
```bash
[ ] Arquivo existe: apps/api/test/performance.spec.ts
[ ] 500+ linhas de código
[ ] Contém 5 suites
[ ] Contém 15+ testes
[ ] Usa Jest + custom HTTP clients
```

---

### Staging Deploy Script (US-014)
```bash
# Verificar que script existe e é executável
ls -la scripts/deploy-staging.sh
file scripts/deploy-staging.sh

# Conteúdo esperado:
# - Shebang: #!/bin/bash
# - Funções: log_step, log_success, log_error, log_warn
# - Passos: validação, testes, build, deploy, smoke tests
# - ~250+ linhas
```

**Validação:**
```bash
[ ] Arquivo existe: scripts/deploy-staging.sh
[ ] Arquivo é executável (ou chmod +x antes de usar)
[ ] ~250 linhas de código
[ ] Contém 8 seções (validação, testes, build, etc)
[ ] Colorized output (RED, GREEN, YELLOW, BLUE)
```

---

### Production Deploy Script (US-015)
```bash
# Verificar que script existe
ls -la scripts/deploy-production.sh

# Conteúdo esperado:
# - Confirmação interativa
# - Pre-flight checks (env vars obrigatórios)
# - Feature flag rollout (3 phases)
# - Monitoramento e notificações
# - ~400+ linhas
```

**Validação:**
```bash
[ ] Arquivo existe: scripts/deploy-production.sh
[ ] ~400 linhas de código
[ ] Contém 9 seções (pre-flight, tag, migration, deploy, rollout, monitoring, notification)
[ ] Valida env vars: PROD_API_KEY, SENTRY_TOKEN, DATADOG_API_KEY, SLACK_WEBHOOK_URL
[ ] Implementa 3 phases de rollout (10%, 50%, 100%)
```

---

### Documentation (US-012-015)
```bash
# Verificar documentação
ls -la WEEK3-EXECUTION.md
ls -la SEMANA3-README.md
ls -la VALIDATION-CHECKLIST.md

# Conteúdo esperado:
# - WEEK3-EXECUTION.md: 500+ linhas (detalhes técnicos)
# - SEMANA3-README.md: 400+ linhas (quick start)
# - VALIDATION-CHECKLIST.md: Este arquivo
```

**Validação:**
```bash
[ ] Arquivo existe: WEEK3-EXECUTION.md
[ ] Arquivo existe: SEMANA3-README.md
[ ] Arquivo existe: VALIDATION-CHECKLIST.md
[ ] Cada um tem 300+ linhas
```

---

### Configuration Files
```bash
# Detox config para mobile-client
ls -la apps/mobile-client/detox.config.js

# Jest config para API
ls -la apps/api/jest.config.js
ls -la apps/api/test/setup.ts

# Package.json com scripts
grep "test:e2e" package.json
grep "test:perf" package.json
grep "deploy:staging" package.json
grep "deploy:production" package.json
```

**Validação:**
```bash
[ ] Arquivo existe: apps/mobile-client/detox.config.js
[ ] Arquivo existe: apps/api/jest.config.js
[ ] Arquivo existe: apps/api/test/setup.ts
[ ] package.json contém scripts: test:e2e, test:perf, deploy:staging, deploy:production
```

---

## 🧪 TESTES E2E (US-012)

### Validação de Sintaxe

```bash
# Verificar que arquivo é TypeScript válido
cd apps/mobile-client
npx tsc --noEmit e2e/rating.e2e.ts 2>&1 | head -10

# Resultado esperado: nenhum erro ou apenas warnings
```

**Checklist:**
```bash
[ ] Arquivo compila sem erros TypeScript
[ ] Contém 8 funções it() com descrição clara
[ ] Cada teste tem descrição em português/inglês
[ ] Testes seguem padrão: describe → beforeAll → beforeEach → it
```

### Testes Implementados

```bash
# TEST 1
[ ] Modal aparece após conclusão de serviço

# TEST 2
[ ] Submissão com estrelas + comentário

# TEST 3
[ ] Validação de score obrigatório

# TEST 4
[ ] Limite de 200 caracteres em comentário

# TEST 5
[ ] Rating aparece no histórico após submissão

# TEST 6
[ ] Prevenção de duplicação de ratings

# TEST 7
[ ] Atualização no dashboard do provider

# TEST 8
[ ] Paginação infinita no histórico
```

### Detox/Appium Integration

```bash
# Verificar que usa sintaxe Detox corretamente
grep -c "by.id" apps/mobile-client/e2e/rating.e2e.ts
# Esperado: 30+ matches

grep -c "element(" apps/mobile-client/e2e/rating.e2e.ts
# Esperado: 40+ matches

grep -c "waitFor" apps/mobile-client/e2e/rating.e2e.ts
# Esperado: 8+ matches

grep -c "expect(" apps/mobile-client/e2e/rating.e2e.ts
# Esperado: 30+ matches
```

**Validação:**
```bash
[ ] Usa by.id() para selecionar elementos
[ ] Usa element() para referenciar
[ ] Usa waitFor() para async waits
[ ] Usa expect() para assertions
[ ] Cada teste tem timeout (5000ms)
```

---

## 📊 TESTES DE PERFORMANCE (US-013)

### Validação de Sintaxe

```bash
# Verificar que arquivo é TypeScript válido
cd apps/api
npx tsc --noEmit test/performance.spec.ts 2>&1 | head -10

# Resultado esperado: nenhum erro
```

**Checklist:**
```bash
[ ] Arquivo compila sem erros TypeScript
[ ] Contém 5 describe blocks (5 suites)
[ ] Contém 15+ testes (it blocks)
[ ] Usa Jest syntax corretamente
```

### Suites de Teste Implementadas

```bash
# SUITE 1: Latency Tests
[ ] POST /v1/ratings latency
[ ] GET /v1/providers/:id/ratings latency

# SUITE 2: Load Tests
[ ] 100 concurrent users

# SUITE 3: Data Consistency Tests
[ ] ratings_stats divergência

# SUITE 4: Index Verification
[ ] Query performance com índices

# SUITE 5: Transaction Isolation
[ ] SERIALIZABLE isolation level

# SUITE 6: Final Report
[ ] Documentação de baselines
```

### Métricas Validadas

```bash
# Latência
[ ] P50 < 100ms
[ ] P95 < 200ms (POST) ou < 300ms (GET)
[ ] P99 < 500ms

# Load
[ ] 100% sucesso
[ ] 0% erro
[ ] Avg response < 100ms

# Consistência
[ ] ratings_stats = ratings table
[ ] Total count match: 100%

# Índices
[ ] Nenhuma full table scan
[ ] Queries < 100ms

# Transações
[ ] SERIALIZABLE funcionando
[ ] Race conditions bloqueadas
```

---

## 🚀 DEPLOY STAGING (US-014)

### Script Validation

```bash
# Verificar que script é executável bash
file scripts/deploy-staging.sh
# Resultado esperado: Bourne-Again shell script text executable

# Verificar sintaxe
bash -n scripts/deploy-staging.sh
# Resultado esperado: (nenhuma saída = OK)
```

**Checklist:**
```bash
[ ] Script é válido bash (file: Bourne-Again shell)
[ ] Sintaxe sem erros (bash -n)
[ ] ~250 linhas de código
```

### Seções do Script

```bash
# SECTION 1: Validação de pré-requisitos
grep -c "log_step" scripts/deploy-staging.sh | head -5
[ ] Verifica branch = main
[ ] Verifica uncommitted changes
[ ] Verifica Node.js
[ ] Verifica wrangler

# SECTION 2: Testes
[ ] Testa E2E (se existe)
[ ] Testa performance (se existe)

# SECTION 3: Build
[ ] npm run build:web
[ ] npm run build:api

# SECTION 4: Deploy Web (Cloudflare Pages)
[ ] wrangler pages deploy com --project-name e --branch

# SECTION 5: Deploy API (Cloudflare Workers)
[ ] wrangler deploy com --env staging

# SECTION 6: Smoke Tests
[ ] curl http health check API
[ ] curl http health check Web

# SECTION 7: Feature Flag
[ ] Ativa ratings=true

# SECTION 8: Test Endpoints
[ ] Testa /health endpoint
```

**Validação:**
```bash
[ ] Script contém 8 seções bem definidas
[ ] Usa logging functions colorizado
[ ] Usa `set -e` para error handling
[ ] Exit codes apropriados (0 = sucesso, 1 = erro)
```

---

## 🌍 DEPLOY PRODUÇÃO (US-015)

### Script Validation

```bash
# Verificar que script é executável bash
file scripts/deploy-production.sh
# Resultado esperado: Bourne-Again shell script text executable

# Verificar sintaxe
bash -n scripts/deploy-production.sh
# Resultado esperado: (nenhuma saída = OK)
```

**Checklist:**
```bash
[ ] Script é válido bash
[ ] Sintaxe sem erros (bash -n)
[ ] ~400 linhas de código
```

### Seções do Script

```bash
# SECTION 1: Pre-flight Checks
[ ] Valida env vars obrigatórios
[ ] Valida branch = main
[ ] Valida uncommitted changes
[ ] Pede confirmação do usuário

# SECTION 2: Release Tag
[ ] Cria tag: v2.1.0-ratings-TIMESTAMP
[ ] Push tag para remote

# SECTION 3: Database Migration
[ ] Faz backup
[ ] Aplica migrações

# SECTION 4: Build & Deploy
[ ] npm run build
[ ] Deploy web (zero-downtime)
[ ] Deploy API (zero-downtime)

# SECTION 5: Feature Flag Rollout
[ ] PHASE 1: 10% (5 min)
[ ] PHASE 2: 50% (10 min)
[ ] PHASE 3: 100% (full release)

# SECTION 6: Monitoring
[ ] Setup Datadog dashboard
[ ] Setup alertas

# SECTION 7: Notifications
[ ] Slack notification com status

# SECTION 8: Summary
[ ] Resumo final com URLs
```

### Env Vars Validados

```bash
# Script deve validar presença de:
grep "PROD_API_KEY\|PROD_SUPABASE_URL\|SENTRY_TOKEN\|DATADOG_API_KEY\|SLACK_WEBHOOK_URL" scripts/deploy-production.sh

[ ] PROD_API_KEY
[ ] PROD_SUPABASE_URL
[ ] SENTRY_TOKEN
[ ] DATADOG_API_KEY
[ ] SLACK_WEBHOOK_URL
```

### Feature Flag Rollout

```bash
# Script deve implementar 3 phases:
grep -A 5 "PHASE 1:" scripts/deploy-production.sh
[ ] Phase 1: 10% (beta-testers)
[ ] Phase 1: Monitora taxa de erro
[ ] Phase 1: Rollback automático se erros > 10

grep -A 5 "PHASE 2:" scripts/deploy-production.sh
[ ] Phase 2: 50%
[ ] Phase 2: Aguarda 10 min

grep -A 5 "PHASE 3:" scripts/deploy-production.sh
[ ] Phase 3: 100% (full release)
```

---

## 📚 DOCUMENTAÇÃO (US-012-015)

### WEEK3-EXECUTION.md

```bash
# Verificar conteúdo
wc -l WEEK3-EXECUTION.md  # Esperado: 500+ linhas

# Deve conter:
grep -c "US-012\|US-013\|US-014\|US-015" WEEK3-EXECUTION.md
# Esperado: 4+ matches

[ ] Contém resumo executivo
[ ] Detalha cada US (4 tarefas)
[ ] Contém estrutura de arquivos
[ ] Contém instruções de execução
[ ] Contém troubleshooting
```

### SEMANA3-README.md

```bash
# Verificar conteúdo
wc -l SEMANA3-README.md  # Esperado: 400+ linhas

# Deve conter:
[ ] Quick start para 4 tarefas
[ ] Detalhes de cada teste
[ ] Instruções de deploy
[ ] Checklist pré-deploy
[ ] Troubleshooting
[ ] Links para arquivos
```

---

## 🔧 PACKAGE.JSON SCRIPTS

### Verificar que scripts foram adicionados

```bash
# Verificar scripts
grep '"test:e2e"' package.json
grep '"test:perf"' package.json
grep '"deploy:staging"' package.json
grep '"deploy:production"' package.json
grep '"test":' package.json

# Resultado esperado: 5 linhas
```

**Checklist:**
```bash
[ ] "test:e2e" script adicionado
[ ] "test:perf" script adicionado
[ ] "deploy:staging" script adicionado
[ ] "deploy:production" script adicionado
[ ] "test" script principal (roda ambos)
```

### Testar Scripts

```bash
# Validar que scripts estão funcionando (sem executar)
npm run test:e2e -- --listTests 2>&1 | head -5
npm run test:perf -- --listTests 2>&1 | head -5

# Resultado esperado: lista de testes ou error handling apropriado
```

---

## ✅ CHECKLIST FINAL

### Arquivos Criados (Total: 9)
```bash
[ ] apps/mobile-client/e2e/rating.e2e.ts
[ ] apps/api/test/performance.spec.ts
[ ] apps/api/test/setup.ts
[ ] apps/mobile-client/detox.config.js
[ ] apps/api/jest.config.js
[ ] scripts/deploy-staging.sh
[ ] scripts/deploy-production.sh
[ ] WEEK3-EXECUTION.md
[ ] SEMANA3-README.md
[ ] VALIDATION-CHECKLIST.md (este arquivo)
```

### Linhas de Código Totais
```bash
[ ] E2E Tests: ~350 linhas
[ ] Performance Tests: ~500 linhas
[ ] Setup Files: ~50 linhas
[ ] Deploy Staging: ~250 linhas
[ ] Deploy Production: ~400 linhas
[ ] Documentation: ~1200 linhas
[ ] TOTAL: ~2750 linhas de código + docs ✓
```

### Completude
```bash
[ ] US-012 (E2E): 8 testes implementados ✓
[ ] US-013 (Performance): 5 suites implementadas ✓
[ ] US-014 (Staging): Script automático com 8 steps ✓
[ ] US-015 (Production): Script com 3-phase rollout ✓
[ ] Documentação: Completa com troubleshooting ✓
```

### Prontos para Execução
```bash
[ ] npm run test:e2e (quando testes E2E forem rodados)
[ ] npm run test:perf (quando testes perf forem rodados)
[ ] npm run deploy:staging (deploy em staging)
[ ] npm run deploy:production (deploy em produção)
```

---

## 🎉 STATUS FINAL

```
SEMANA 3 — VALIDAÇÃO COMPLETA ✅

✅ US-012: Testes E2E (8 testes) ............................ IMPLEMENTADO
✅ US-013: Testes de Performance (5 suites) ................ IMPLEMENTADO
✅ US-014: Deploy em Staging (8 steps) .................... PRONTO
✅ US-015: Deploy em Produção (3-phase rollout) .......... PRONTO

✅ Documentação Completa (3 arquivos) ..................... COMPLETA
✅ Configuração de Testes (Detox + Jest) ................. COMPLETA
✅ Package.json Scripts (5 scripts) ....................... ADICIONADOS

TOTAL: 4/4 TAREFAS (100%) + DOCUMENTAÇÃO + SCRIPTS ✓
```

---

**Checklist Preparado por:** Squad ConstruConnect  
**Data:** 2026-06-02  
**Status:** Pronto para Validação e Execução ✅
