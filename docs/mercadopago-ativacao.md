# Ativação do Mercado Pago — pagamento com cartão

> A integração de pagamento com cartão (Checkout API / card_tokens + payments) está
> **pronta e validada no código**. O que falta é **configuração da conta Mercado Pago**:
> hoje nem as credenciais de teste nem as de produção conseguem cobrar.

## Dados da aplicação
- **N.º da aplicação:** 5433105883550280
- **User ID:** 3464420034
- Public Key de teste: `APP_USR-0c6078fb-429e-4125-8010-26a17b5cb02e`
- Public Key de produção: `APP_USR-a61f8380-1809-4be1-a267-dbfd9be408bb`

## Sintomas observados (validados em 11/06/2026)
| Credencial usada | Cartão | Resultado |
|---|---|---|
| **Teste** (public+token de teste) | cartão de **teste** (5031 4332…) | `401 cause 7 "Unauthorized use of live credentials"` |
| **Produção** (public de produção + token) | cartão **REAL** | `401 cause 7 "Unauthorized use of live credentials"` |

O `cause code 7` / "Unauthorized use of live credentials" (ou "Uma das partes é de teste")
com **cartão real + credenciais de produção** indica que a **aplicação não está
autorizada a operar em produção** (não ativada / não homologada).

## O que fazer

### A) Ativar a aplicação para PRODUÇÃO  ← resolve a cobrança real
1. https://www.mercadopago.com.br/developers → **Suas integrações** → aplicação **5433105883550280**
2. Procurar **"Ativar credenciais de produção"** / **"Ir para produção"** / **Homologação**
3. Completar os requisitos pedidos (descrição da integração, dados, etc.). Algumas contas
   passam por uma revisão de qualidade do Mercado Pago.
4. Depois de **ativada**, a cobrança com cartão real funciona usando a Public Key de
   produção (`a61f8380…`) + o Access Token de **produção**.

### B) Credenciais de TESTE / sandbox  ← resolve testar sem dinheiro real
As credenciais de teste da própria aplicação retornam "uma das partes é de teste" ao cobrar.
O caminho recomendado é usar **usuário de teste vendedor**:
1. Suas integrações → app → **Contas de teste** → criar um **Vendedor** (Brasil)
2. Logar (janela anônima) como esse vendedor → **criar uma aplicação** → usar a Public Key
   e o Access Token **dele** (ambos do mesmo vendedor)
3. ⚠️ Bloqueio observado: ao tentar criar a aplicação logado como o usuário de teste,
   o painel retornou o erro **DXT400-AR9BBM8NTGXW**. Reportar isso ao suporte.

## Mensagem pronta para o suporte do Mercado Pago
> "Integração de pagamento com cartão via API (Checkout Transparente). Ao criar o pagamento
> recebo **HTTP 401, cause code 7, 'Unauthorized use of live credentials'**, em DOIS casos:
> (1) com credenciais de **teste** cobrando cartão de teste; (2) com credenciais de
> **produção** cobrando um **cartão real**. Aplicação **5433105883550280** (user 3464420034).
> Como ativo a aplicação para produção? E ao tentar criar uma aplicação logado como um
> **usuário de teste vendedor**, recebo o erro **DXT400-AR9BBM8NTGXW** — como resolver?"

## Quando resolver (o código não muda)
1. Trocar a `MERCADOPAGO_PUBLIC_KEY` (em `apps/api/wrangler.toml`) e o secret
   `MERCADOPAGO_ACCESS_TOKEN` pelo par que funcionar (vendedor de teste OU produção ativada).
2. `npx wrangler deploy --env staging` (de dentro de `apps/api`).
3. Pagar no app e conferir `create-card-payment - Ok` **sem** erro no `wrangler tail`.

## O que JÁ foi validado no staging (código OK)
- App apontando para o staging; login + verificação de identidade funcionando.
- `GET /v1/cards`, `/installments`, `/mp-public-key` respondendo.
- Tokenização do cartão no device (MP card_tokens) — **funciona**.
- `create-card-payment` recebe e encaminha ao MP corretamente (o MP é quem recusa, por
  causa das credenciais — não há bug no app/API).
