# Rollout — Pagamento com cartão salvo (flag `card_saved_cards`)

Runbook de habilitação, observabilidade e rollback da feature (branch
`feat/pagamento-cartao`). A flag `card_saved_cards` nasce **OFF**; com ela OFF o
app mantém o comportamento atual e nada do fluxo novo aparece.

## 1. Pré-requisitos (gate de início — todos obrigatórios)
- [ ] API com F1/F2/F3 + fix `save_card` no ar (`deploy:api`).
- [ ] Novo build dos apps (mobile-client) publicado/distribuído.
- [ ] Migration **`20260615_saved_cards.sql`** aplicada (DDL): tabela `saved_cards`,
      `app_users.mp_customer_id`, `payments.mp_fee_amount`/`installments`, RLS e índice
      único de preferido conferidos.
- [ ] Credenciais Mercado Pago configuradas no Worker: `MERCADOPAGO_ACCESS_TOKEN`
      (privada) e a public key servida por `GET /v1/mp-public-key`.
- [ ] webhook-fix (`c2c5574`) no ar — senão um cartão que confirme via webhook seria
      marcado como Pix.
- [ ] Validação em **staging** concluída (ver §5) — não habilitar em produção antes.

## 2. Como ligar/desligar a flag
A flag fica no KV de feature-flags e é alternada pela API admin:
```bash
# LIGAR
curl -X PATCH "$API/v1/admin/feature-flags/card_saved_cards" \
  -H "x-admin-key: $ADMIN_KEY" -H "Content-Type: application/json" \
  -d '{"enabled": true}'

# DESLIGAR (rollback imediato)
curl -X PATCH "$API/v1/admin/feature-flags/card_saved_cards" \
  -H "x-admin-key: $ADMIN_KEY" -H "Content-Type: application/json" \
  -d '{"enabled": false}'
```
O app lê `GET /v1/feature-flags` e mescla sobre os defaults; a mudança vale no próximo
carregamento de flags do cliente (sem novo build).

> Observação: o flip é **global** (KV booleano). Não há, hoje, ramp por % de usuários.
> Para um piloto controlado, ver §3 (estratégia com a base atual).

## 3. Estratégia de habilitação gradual
Como a flag é global, faça o ramp pelo **ambiente/janela**, não por porcentagem:
1. **Staging** (§5) — cartões de teste do MP, todos os caminhos.
2. **Produção / canário operacional** — ligar em **janela de baixo tráfego** com a equipe
   acompanhando os logs/métricas (§4) ao vivo por ~30–60 min. Faça 1–2 transações reais de
   baixo valor (equipe) antes de divulgar.
3. **Aberto** — manter ligada se os critérios (§4) estiverem saudáveis por 24–48h.
> Se/quando houver necessidade de ramp por %, evoluir a flag para suportar percentual
> (fora do escopo desta entrega).

## 4. Observabilidade — o que acompanhar
Sinais nos logs do Worker (prefixo `[card-payment]` / `[cards]`) e na tabela `payments`:

| Métrica | Como medir | Meta / alerta |
|---|---|---|
| Taxa de aprovação de cartão | `payments` method=card status=approved / total tentativas | ≥ ~60%; queda brusca = investigar |
| **Cobrança dupla** | nº de `payments` com mesma intenção/`external_reference` em janela curta | **0** — qualquer duplicata é incidente (idempotência) |
| Recusas por motivo | `status_detail` das respostas 402 (`statusDetailMessage`) | monitorar `cc_rejected_*`; pico anômalo = revisar |
| Erros de token | logs 400 com "token" / `token_expired` no app | baixo; alto = revisar tokenização/tempo no sheet |
| MP indisponível | logs 503/502 em `create-card-payment` | baixo; sustentado = abrir incidente com MP |
| Split/taxa | `payments.mp_fee_amount` preenchido em aprovados; `provider_amount = amount − platformFee − mpFee` | fee > 0 nos aprovados; provider_amount nunca negativo |
| save_card | inserts em `saved_cards` vs. opt-ins | falhas só logam (best-effort), não derrubam cobrança |

Pontos de log já existentes para grep: `[card-payment] tentativa de cobrar SR alheia`
(IDOR bloqueado/403), `[card-payment] pagamento recusado`, `[card-payment] MP retornou erro`,
`[card-payment] save_card ...`, `[cards] ...`.

## 5. Checklist de validação em staging (antes de produção)
Sandbox MP + migration aplicada + flag ON em staging. Use cartões de teste do MP.
- [ ] **Cartão novo crédito** → cobra, aprova, `payment_status=confirmed`, método `card`.
- [ ] **Parcelamento** (com juros do cliente) → parcelas vindas do MP; total confere.
- [ ] **Débito avulso** → cobra à vista, não oferece salvar, não cria `saved_cards`.
- [ ] **Salvar cartão** (opt-in, crédito) → aparece em `saved_cards`; 1º vira preferido.
- [ ] **Pagar com cartão salvo** → exige CVV; tokeniza por `card_id`+CVV; cobra.
- [ ] **Gerenciar** → marcar preferido (`PATCH .../default`) e remover (`DELETE`, apaga no MP).
- [ ] **Recusa** (cartão de teste recusado) → 402, mensagem amigável, serviço segue não pago.
- [ ] **Idempotência** → reenvio com a mesma `idempotency_key` não duplica cobrança.
- [ ] **IDOR** → cobrar SR de outro cliente → 403.
- [ ] **Split** → `mp_fee_amount` preenchido; comissão sobre o bruto; taxa MP do prestador.
- [ ] **Sem MP / 503** → sheet mostra "indisponível", oferece Pix/Dinheiro.

## 6. Critérios de abort / Rollback
**Aborte o rollout e DESLIGUE a flag (§2)** se observar qualquer um:
- Qualquer **cobrança duplicada** confirmada.
- Queda anômala da taxa de aprovação ou pico de erros de token/503.
- Divergência de valor (total cobrado ≠ esperado) ou `provider_amount` incorreto.
- Pagamento marcado como `confirmed` sem cobrança real correspondente no MP.

**Rollback:** desligar a flag é **imediato e suficiente** para esconder o fluxo novo no app
(volta ao comportamento atual). A migration `20260615` é **aditiva** — não precisa ser
revertida; as tabelas/colunas ficam inertes com a flag OFF. Reverter código = `git revert`
dos commits da feature na branch, se necessário.

## 7. Pós-rollout
- [ ] Remover/limpar logs de depuração excessivos, se houver.
- [ ] Registrar baseline das métricas (§4) para comparação futura.
- [ ] Abrir discovery da **fase 2** (NFC / carteira digital Google Pay / Apple Pay).
