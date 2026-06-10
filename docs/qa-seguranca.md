# QA de Segurança — ConstruConnect

Checklist de validação da segurança implementada na branch `feat/seguranca-ondas-fase1`
(Onda 1: IDORs · Fase 1: Authorization · Fase 2: RLS lockdown · Ratings/ownership).

## Como usar
- **Ambiente:** rodar contra **staging** (não produção). Defina `BASE` e tokens reais.
- **Legenda de status:** ⬜ a fazer · ✅ passou · ❌ falhou · ⚠️ bloqueado/parcial.
- **Pré-requisito Fase 2:** os casos SEC-11..SEC-14 só valem **depois** de aplicar a migration
  `20260613_fase2_rls_lockdown.sql`. Antes disso, escrita direta ainda é permitida.
- **Pré-requisito Ratings:** SEC-09/SEC-17 dependem da migration `20260614_rating_comment.sql`.

```bash
BASE="https://<staging>/v1"
TOKEN_A="<jwt cliente A>"        # dono dos recursos de teste
TOKEN_B="<jwt cliente/prestador B>"  # atacante
TOKEN_PA="<jwt prestador A>"
ANON_KEY="<supabase anon key staging>"
SUPA_URL="<https://<proj>.supabase.co>"
ADMIN_KEY="<x-admin-key staging>"
```

---

## A. Autenticação (JWT)

### SEC-01 — Endpoint autenticado sem token → 401  ⬜
- **Passos:** `curl -i $BASE/profile` (sem header Authorization).
- **Esperado:** `401` `{ "message": "Não autorizado." }`. Vale para qualquer rota fora de `PUBLIC_PATHS`.

### SEC-02 — Token inválido/expirado → 401  ⬜
- **Passos:** `curl -i -H "Authorization: Bearer abc.invalido" $BASE/profile`.
- **Esperado:** `401` `{ "message": "Token inválido ou expirado." }`.

### SEC-03 — Rotas públicas acessíveis sem token → 200  ⬜
- **Passos (cada uma sem Authorization):**
  `GET /feature-flags`, `GET /providers`, `GET /providers/available`,
  `GET /providers/<id>/portfolio`, `GET /providers/<id>/certifications`,
  `GET /providers/<id>/ratings`, `POST /register`.
- **Esperado:** `2xx` (sem 401). Confirma que o lockdown de auth não quebrou o que é público.

### SEC-04 — `GET /providers/me/ratings` sem token → 401  ⬜
- **Passos:** `curl -i "$BASE/providers/me/ratings"` (sem token).
- **Esperado:** `401`. O segmento `me` **não** é público; só resolve via JWT.

---

## B. IDOR / Ownership (identidade derivada do JWT, nunca do body)

### SEC-05 — Prestador não conclui chamado de outro  ⬜
- **Pré:** chamado X pertence ao prestador A (`provider_user_id = A`).
- **Passos:** com `TOKEN_PB` (prestador B): `PATCH $BASE/service-requests/X/complete`.
- **Esperado:** não altera o chamado (0 linhas afetadas pela cláusula `.eq(provider_user_id, B)`); status permanece. Repetir para `/start`.

### SEC-06 — `provider_user_id` do body é ignorado no bid  ⬜
- **Passos:** com `TOKEN_PB`: `POST $BASE/service-requests/X/bids` body `{ "amount": 100, "provider_user_id": "<id do A>" }`.
- **Esperado:** o bid é criado como do **B** (derivado do JWT), nunca do A. `provider_user_id` do body é descartado.

### SEC-07 — Cliente não aceita bid de chamado alheio → 403  ⬜
- **Pré:** chamado X pertence ao cliente A; bid `Bid1` em X.
- **Passos:** com `TOKEN_B` (outro cliente): `PATCH $BASE/service-requests/X/bids/Bid1/accept`.
- **Esperado:** `403` `{ "message": "Não autorizado." }` (checagem `reqRow.client_user_id === JWT`).

### SEC-08 — Cliente não cancela/aceita-orçamento de chamado alheio  ⬜
- **Passos:** com `TOKEN_B`: `PATCH $BASE/service-requests/X/cancel` e `/accept-quote` (body com `client_user_id` do A).
- **Esperado:** não altera o chamado do A (cláusula `.eq(client_user_id, ...)` não casa) / sem efeito.

### SEC-09 — `POST /ratings` em chamado de outro cliente → 403  ⬜
- **Passos:** com `TOKEN_B`: `POST $BASE/ratings` body `{ "service_request_id": "X", "score": 5 }` (X é do A).
- **Esperado:** `403` `{ "message": "Não autorizado." }`. Idem `POST /service-requests/X/rate`.

### SEC-10 — `GET /ratings/given` só retorna do próprio usuário  ⬜
- **Passos:** `GET $BASE/ratings/given` com `TOKEN_A` e depois `TOKEN_B`.
- **Esperado:** cada resposta lista apenas avaliações do respectivo `client_user_id` (derivado do JWT); sem vazamento cruzado.

---

## C. RLS lockdown — Fase 2 (somente APÓS `20260613`)

> Use o cliente Supabase com a **anon key** (como o app), autenticado como um usuário comum.

### SEC-11 — UPDATE direto em `service_requests` negado  ⬜
- **Passos:** com anon key + sessão do dono, tentar
  `update service_requests set status='completed' where id=X`.
- **Esperado:** **0 linhas / erro de RLS** (sem policy de escrita). A transição só funciona pelos endpoints da API.

### SEC-12 — INSERT/UPDATE direto em `bids` negado  ⬜
- **Passos:** com anon key, tentar `insert into bids(...)` e `update bids set status='accepted'`.
- **Esperado:** negado por RLS. Envio/aceite de bid só via endpoints.

### SEC-13 — SELECT (leitura) e Realtime continuam funcionando  ⬜
- **Passos:** com anon key, `select` dos próprios `service_requests`/`bids`; abrir uma subscription Realtime.
- **Esperado:** leitura OK (policies `sr_select_involved` / `bids_select_client` intactas); Realtime entrega eventos.

### SEC-14 — Self-writes permitidos continuam  ⬜
- **Passos:** com anon key, upsert em `provider_locations` (própria posição) e update de `app_users.push_token`/`last_seen_at` (próprio id).
- **Esperado:** **permitido** (policies de dono mantidas). Esses fluxos não foram migrados para a API de propósito.

---

## D. Escalada de privilégio / regras de transição

### SEC-15 — Pagamento respeita o método (sem auto-confirm indevido)  ⬜
- **Passos:** via `PATCH $BASE/service-requests/X/payment-send`:
  (a) `payment_method: "cash"` → `payment_status` deve virar `client_paid` (exige confirmação do prestador);
  (b) `payment_method: "pix"`/`"card"` → `payment_status` `confirmed` (auto).
- **Esperado:** comportamento conforme método. Pós-RLS, **não** é possível setar `payment_status='confirmed'` por escrita direta.

### SEC-16 — Transições de status respeitam a máquina de estados  ⬜
- **Passos:** tentar `PATCH /start` em chamado que **não** está `accepted`; `PATCH /accept` (prestador) em chamado que não está `requested`.
- **Esperado:** sem efeito / 409 conforme o caso (cláusulas `.eq("status", ...)`). Não dá para pular etapas.

### SEC-17 — Avaliação dupla e suspensão automática  ⬜
- **Passos:** (a) avaliar X duas vezes (`/ratings` ou `/report` → depois `/rate`); (b) levar a média de um prestador para `< 4.6`.
- **Esperado:** (a) segunda avaliação simples → `400 "Pedido já avaliado."`; (b) `provider_profiles.status='offline'` + `blocked_until` ~30 dias e push de suspensão. `/report` mantém `client_rating` em sincronia (unificação).

---

## Apêndice — Infra de segurança (smoke)

### INFRA-01 — Admin exige `x-admin-key`  ⬜
- **Passos:** `PATCH $BASE/admin/providers/<id>/block` sem header `x-admin-key` (e com chave errada).
- **Esperado:** negado. Com `ADMIN_KEY` correta → permitido.

### INFRA-02 — Rate limiting de escrita (120 req/min por IP)  ⬜
- **Passos:** disparar > 120 requisições `POST/PATCH` do mesmo IP em 1 min.
- **Esperado:** excedente recebe `429 "Muitas requisições..."`. GET/OPTIONS não são limitados.

---

## Resumo de cobertura
| Área | Casos |
|---|---|
| Autenticação JWT | SEC-01..04 |
| IDOR / Ownership | SEC-05..10 |
| RLS lockdown (Fase 2) | SEC-11..14 |
| Privilégio / transições | SEC-15..17 |
| Infra | INFRA-01..02 |

**Bloqueios conhecidos para rodar ao vivo:** precisa de staging com a API e os apps no ar
e as migrations `20260613`/`20260614` aplicadas. Daqui (offline/localhost, sem DDL) não é
possível executar; este checklist é o roteiro para rodar no ambiente certo.
