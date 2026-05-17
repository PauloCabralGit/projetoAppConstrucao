# Arquitetura da POC

## Objetivo

Entregar uma base barata para validar o produto agora, mas sem travar a evolucao futura.

## POC recomendada

- Frontend React hospedado no Cloudflare Pages
- API em Cloudflare Workers com Hono
- Banco PostgreSQL gerenciado em Neon ou Supabase
- Arquivos e imagens em Cloudflare R2
- Autenticacao inicial com email/telefone
- Biometria no navegador usando passkeys com WebAuthn

## Por que essa arquitetura

- baixo custo para comecar
- deploy simples
- boa performance global
- codigo TypeScript em toda a stack
- migracao futura relativamente direta

## Como crescer depois

1. Manter o frontend no Cloudflare Pages ou mover para S3 + CloudFront.
2. Migrar a API de Workers para AWS Lambda ou ECS quando houver regras mais complexas, jobs demorados ou integracoes pesadas.
3. Mover o Postgres para RDS quando a operacao pedir mais controle.
4. Acrescentar servicos especializados:
   - fila para matching e notificacoes
   - busca geolocalizada
   - pagamentos
   - chat em tempo real
   - modulo de materiais de construcao
   - modulo B2B para construtoras

## Biometria

Em app web, "biometria" normalmente vira uso de passkeys:

- Face ID, Touch ID, Windows Hello ou biometria do Android
- o navegador expõe a credencial
- o backend armazena a chave publica e valida o desafio

Na POC atual, a interface de cadastro e ativacao biometrica ja esta pronta para conectar com uma implementacao completa de WebAuthn.
