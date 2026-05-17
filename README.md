# ConstruConnect POC

POC de um app estilo 99/Uber para contratacao de servicos de construcao, com foco inicial em clientes, pedreiros e empreiteiros.

## Stack

- Frontend: React + TypeScript + Vite
- API: Hono + Cloudflare Workers
- Banco: PostgreSQL (idealmente Neon ou Supabase para a POC)
- Biometria: WebAuthn / Passkeys

## Estrutura

- `apps/web`: interface principal da POC
- `apps/api`: API pronta para rodar no Cloudflare Workers
- `packages/shared`: tipos compartilhados entre frontend e backend
- `database/schema.sql`: schema inicial do banco
- `docs/architecture.md`: arquitetura e evolucao para AWS

## URLs de Producao (Cloudflare)

| Servico  | URL                                                                 |
|----------|---------------------------------------------------------------------|
| Frontend | https://construconnect-web.pages.dev                                |
| API      | https://construconnect-api.orionsystem.workers.dev                  |

## Como rodar localmente

1. Instale as dependencias:

```bash
npm install
```

2. Rode o frontend:

```bash
npm run dev:web
```

3. Rode a API:

```bash
npm run dev:api
```

## Como fazer deploy no Cloudflare

### Pre-requisitos

1. Ter o [Wrangler](https://developers.cloudflare.com/workers/wrangler/) instalado (ja incluso nas devDependencies)
2. Estar autenticado:

```bash
npx wrangler login
```

### Deploy da API (Cloudflare Workers)

```bash
npm run deploy:api
```

Ou diretamente:

```bash
cd apps/api
npx wrangler deploy src/index.ts
```

A API sera publicada em: `https://construconnect-api.<seu-usuario>.workers.dev`

### Deploy do Frontend (Cloudflare Pages)

```bash
npm run deploy:web
```

Ou diretamente:

```bash
cd apps/web
npx vite build
npx wrangler pages deploy dist --project-name construconnect-web --branch main
```

O frontend sera publicado em: `https://construconnect-web.pages.dev`

### Deploy completo (API + Frontend)

```bash
npm run deploy
```

> **Nota:** Na primeira vez, o Wrangler pode perguntar se deseja criar o projeto Pages. Confirme com Enter.

## Produto

Funcionalidades entregues na POC:

- landing page do produto
- busca e listagem de profissionais
- fluxo de cadastro de cliente e prestador
- captura de dados para biometria com WebAuthn
- dashboard com pedidos, agenda e etapas futuras
- API com rotas mockadas para onboarding, profissionais e corridas de servico

## Rotas da API

| Metodo | Rota                                  | Descricao                        |
|--------|---------------------------------------|----------------------------------|
| GET    | /                                     | Status da API                    |
| GET    | /health                               | Health check                     |
| GET    | /v1/providers                         | Lista profissionais (filtros: role, city) |
| GET    | /v1/requests                          | Lista chamados de servico         |
| POST   | /v1/register                          | Cadastro de usuario               |
| POST   | /v1/auth/webauthn/register-options    | Opcoes de registro WebAuthn       |
| POST   | /v1/auth/webauthn/verify-registration | Verificacao de registro WebAuthn  |

## Evolucao recomendada

- autenticar usuarios com Supabase Auth ou Clerk
- persistir WebAuthn usando tabelas do schema
- ligar pagamentos, chat e geolocalizacao
- depois migrar a API para AWS ECS/Lambda se o volume crescer
