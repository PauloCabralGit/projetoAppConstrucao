// URL base da API por ambiente. Produção usa o fallback; para staging/sandbox,
// defina EXPO_PUBLIC_API_URL (ex.: num arquivo .env) antes de buildar.
// IMPORTANTE: inclua o sufixo /v1 no valor (igual ao fallback).
export const API_BASE =
  process.env.EXPO_PUBLIC_API_URL ?? 'https://construconnect-api.orionsystem.workers.dev/v1';
