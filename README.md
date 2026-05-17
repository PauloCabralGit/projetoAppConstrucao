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

## Como rodar

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

## Produto

Funcionalidades entregues na POC:

- landing page do produto
- busca e listagem de profissionais
- fluxo de cadastro de cliente e prestador
- captura de dados para biometria com WebAuthn
- dashboard com pedidos, agenda e etapas futuras
- API com rotas mockadas para onboarding, profissionais e corridas de servico

## Evolucao recomendada

- autenticar usuarios com Supabase Auth ou Clerk
- persistir WebAuthn usando tabelas do schema
- ligar pagamentos, chat e geolocalizacao
- depois migrar a API para AWS ECS/Lambda se o volume crescer
