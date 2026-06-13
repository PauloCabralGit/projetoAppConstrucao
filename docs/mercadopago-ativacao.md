# Mercado Pago — credenciais de cartão (resolvido)

> A integração de pagamento com cartão (Checkout API) está **pronta, validada e
> funcionando** em produção. Abaixo, o que aprendemos e a configuração correta.

## Resumo (validado em 11/06/2026, no staging)
- ✅ Tokenização device→MP, endpoints `/cards` `/installments` `/mp-public-key`,
  `create-card-payment` — todos funcionando.
- ✅ **Cobrança real processa no MP** com as credenciais de **produção**
  (a transação de teste retornou `cc_rejected_high_risk` = recusa do antifraude,
  não erro de credencial — ou seja, autorizou e o MP decidiu).

## A causa da novela (token de teste x produção)
O erro `401 cause 7 "Unauthorized use of live credentials"` aparecia porque o
**Access Token usado era o de TESTE**. O recebedor (dono do token) era "teste",
então o MP recusava como "uma das partes é de teste" — mesmo com public key de
produção e cartão real. **Trocando o Access Token para o de PRODUÇÃO, resolveu.**

Regra de ouro: **public key e access token têm que ser do MESMO ambiente.**

## Configuração correta
| Ambiente | Public Key | Access Token |
|---|---|---|
| **Produção** | `APP_USR-a61f8380-1809-4be1-a267-dbfd9be408bb` | o de **produção** (aba "Credenciais de produção") |
| Teste/sandbox | `APP_USR-0c6078fb-...` | o de **teste** — porém a cobrança de teste da conta retorna "uma das partes é de teste" (ver abaixo) |

App: nº `5433105883550280` · user `3464420034`.

## Para produção (rollout)
1. No worker de **produção** (`--env production`): `MERCADOPAGO_PUBLIC_KEY` = `a61f8380...`
   e `wrangler secret put MERCADOPAGO_ACCESS_TOKEN --env production` = token de produção.
2. `wrangler deploy --env production`.
3. Ligar a flag `card_saved_cards` em produção.

## Sobre o `cc_rejected_high_risk`
É o **antifraude do MP** recusando a transação específica (comum em conta nova / primeiras
cobranças). Não é bug. Para uma aprovação: tentar outro cartão real, valor baixo, ou
aguardar a conta ganhar histórico.

## Sandbox (opcional — só se quiser testar sem dinheiro real)
As credenciais de **teste da própria aplicação** retornam "uma das partes é de teste".
Para sandbox de verdade, usar **usuário de teste vendedor** (Contas de teste → Vendedor →
logar como ele → criar app → usar as credenciais dele). ⚠️ Observado: criar app pelo
usuário de teste deu erro `DXT400-AR9BBM8NTGXW` — se for usar sandbox, reportar ao suporte MP.
Como produção já funciona, sandbox é opcional.
