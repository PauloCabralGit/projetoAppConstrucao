# Guia de Deploy — ConstruConnect

Checklist completo para levar o projeto a produção.
Execute cada passo na ordem abaixo.

---

## Pré-requisitos

| Item | Status | Como obter |
|---|---|---|
| Conta Supabase | ✅ configurada | supabase.com |
| Conta Cloudflare | ✅ configurada | cloudflare.com |
| Conta MercadoPago (Marketplace) | ⚠️ **AÇÃO NECESSÁRIA** | Abrir ticket em mercadopago.com.br/developers solicitando aprovação de marketplace |
| CNPJ da empresa | ⚠️ **NECESSÁRIO para MP** | — |
| Conta Sentry | ⚠️ recomendado | sentry.io (plano free funciona) |
| Conta Expo (EAS) | ⚠️ para iOS/Android | expo.dev |

---

## Passo 1 — Aplicar migrações no Supabase

```bash
npx supabase login
npx supabase link --project-ref hjmcfekqhwshbmvsfkod
npx supabase db push
```

Verifica as 3 migrações:
- `20260519_new_tables.sql` — chat, bids, portfolio, complaints
- `20260602_saas_payments.sql` — payments, splits, subscriptions, locations
- `20260602_missing_columns.sql` — colunas ausentes + request_photos

---

## Passo 2 — Configurar secrets no Cloudflare

Execute um por um (evite colocar no wrangler.toml):

```bash
cd apps/api

# Supabase
npx wrangler secret put SUPABASE_SERVICE_KEY

# MercadoPago
npx wrangler secret put MERCADOPAGO_ACCESS_TOKEN     # APP_USR-... (produção)
npx wrangler secret put MERCADOPAGO_WEBHOOK_SECRET   # gerado em MP > Webhooks
npx wrangler secret put MERCADOPAGO_PUBLIC_KEY        # APP_USR-... (chave pública)
npx wrangler secret put MP_APP_ID                    # ID do app no MP
npx wrangler secret put MP_APP_SECRET                # Secret do app no MP

# Admin
npx wrangler secret put ADMIN_KEY                    # string aleatória forte

# Sentry
npx wrangler secret put SENTRY_DSN                   # https://xxx@xxx.ingest.sentry.io/xxx
```

---

## Passo 3 — Configurar Webhook no MercadoPago

1. Acesse https://www.mercadopago.com.br/developers/panel
2. Vá em **Webhooks > Configurar notificações**
3. URL de pagamentos: `https://construconnect-api.orionsystem.workers.dev/v1/webhooks/mercadopago`
4. URL de assinaturas: `https://construconnect-api.orionsystem.workers.dev/v1/webhooks/mercadopago/subscription`
5. Selecione eventos: **Pagamentos** e **Planos/Assinaturas (preapproval)**
6. Copie o **Secret de assinatura** → use como `MERCADOPAGO_WEBHOOK_SECRET`

---

## Passo 4 — Deploy da API

```bash
cd apps/api
npm run deploy
```

Verifique:
```bash
curl https://construconnect-api.orionsystem.workers.dev/health
# Esperado: {"ok":true}

curl https://construconnect-api.orionsystem.workers.dev/
# Esperado: {"name":"ConstruConnect","status":"ok",...}
```

---

## Passo 5 — Deploy do Frontend Web

```bash
cd apps/web
npm run build
npx wrangler pages deploy dist --project-name construconnect-web --branch main
```

URL: https://construconnect-web.pages.dev

---

## Passo 6 — Build dos apps mobile (EAS)

```bash
# Instalar EAS CLI (uma vez)
npm install -g eas-cli
eas login

# Build Android
cd apps/mobile-client
eas build --platform android --profile production

# Build iOS (requer Apple Developer Account)
eas build --platform ios --profile production
```

---

## Passo 7 — Configurar CORS para domínios de produção

No `apps/api/src/index.ts`, a linha de CORS já permite:
```
origin: ["https://projetoappconstrucao.pages.dev", "http://localhost:5173"]
```

Se o domínio final mudar, atualize e redeploy:
```typescript
origin: ["https://construconnect-web.pages.dev", "https://seudominio.com.br"]
```

---

## Passo 8 — Verificar RLS no Supabase

No painel Supabase > Authentication > Policies, confirme que existem políticas em:
- `app_users` ✅
- `provider_profiles` ✅
- `service_requests` ✅
- `payments` ✅
- `provider_splits` ✅
- `provider_subscriptions` ✅
- `messages` ✅
- `bids` ✅
- `request_photos` ✅

---

## Passo 9 — Monitoramento

| Ferramenta | O que monitora | URL |
|---|---|---|
| Cloudflare Analytics | Requests, latência, erros 4xx/5xx | dash.cloudflare.com > Workers |
| Sentry | Erros de runtime + stack traces | sentry.io/construconnect |
| Supabase Dashboard | Queries lentas, uso de DB | supabase.com/dashboard |

**Alertas a configurar no Cloudflare:**
- Error rate > 5% → notificação imediata
- Worker CPU time > 50ms (p99) → investigar

---

## Checklist final pré-go-live

### Segurança
- [x] JWT obrigatório em todos os endpoints de escrita
- [x] HMAC validado no webhook MercadoPago
- [x] RLS ativo nas tabelas core
- [x] Rate limiting: 120 req/min por IP
- [x] Secrets fora do código (wrangler secrets)
- [ ] ADMIN_KEY rotacionado (não usar senha simples)
- [ ] Revisar CORS — remover `localhost` em produção

### Banco de dados
- [x] 3 migrações aplicadas
- [x] Tabela `payments`, `provider_splits`, `provider_subscriptions`
- [x] Tabela `request_photos`, `provider_locations`, `provider_withdrawals`
- [x] Índices de performance aplicados
- [x] Backup automático habilitado no Supabase (Configurações > Backups)

### Pagamentos
- [ ] Conta MercadoPago Marketplace aprovada
- [ ] Webhook configurado com secret correto
- [ ] Teste end-to-end em sandbox: Pix aprovado → push enviado ✓
- [ ] Teste split: R$ 100 → plataforma R$ 8, prestador R$ 92 ✓
- [ ] Teste cartão em sandbox (número: 5031 7557 3453 0604)

### Produto
- [x] Toggle online/offline persiste no banco
- [x] Endpoint /reject corrigido
- [x] Dashboard de ganhos usa `provider_amount`
- [x] Tela de pagamento por cartão funcional
- [x] Tela de saque via Pix funcional
- [x] Tela de planos (Free/Pro/Premium) funcional
- [x] Endpoint de exclusão LGPD

### Deploy
- [ ] API deployed em produção
- [ ] Frontend deployed em produção
- [ ] Apps mobile publicados (Android / iOS)
- [ ] Cron ativo (verificar em CF > Workers > Triggers)
- [ ] Sentry recebendo eventos

---

## Rollback

Se algo der errado após o deploy:

```bash
# Reverter API para versão anterior
cd apps/api
npx wrangler rollback

# Verificar deployments
npx wrangler deployments list
```

Para reverter migração do banco: o Supabase não suporta rollback automático de DDL.
**Antes de aplicar migrações em produção, sempre tire um backup manual:**
```bash
npx supabase db dump --data-only > backup_$(date +%Y%m%d).sql
```

---

## Variáveis de ambiente (resumo)

| Var | Onde | Valor |
|---|---|---|
| `SUPABASE_URL` | wrangler.toml | `https://hjmcfekqhwshbmvsfkod.supabase.co` |
| `SUPABASE_SERVICE_KEY` | wrangler secret | painel Supabase > Settings > API |
| `MERCADOPAGO_ACCESS_TOKEN` | wrangler secret | painel MP > Credenciais |
| `MERCADOPAGO_WEBHOOK_SECRET` | wrangler secret | painel MP > Webhooks |
| `MERCADOPAGO_PUBLIC_KEY` | wrangler secret | painel MP > Credenciais |
| `MP_APP_ID` | wrangler secret | painel MP > Aplicações |
| `MP_APP_SECRET` | wrangler secret | painel MP > Aplicações |
| `ADMIN_KEY` | wrangler secret | string aleatória (gere com `openssl rand -hex 32`) |
| `SENTRY_DSN` | wrangler secret | painel Sentry > Settings > DSN |
