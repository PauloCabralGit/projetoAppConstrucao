import { supabase } from './supabase';

/**
 * Monta os headers de autenticação para chamadas à API.
 *
 * A API (Hono) exige `Authorization: Bearer <jwt>` em quase todas as rotas
 * `/v1/*` (fora as públicas como /register, /feature-flags, /providers).
 * Sem isso o middleware responde 401 antes de chegar no handler.
 *
 * Use sempre que fizer fetch para um endpoint autenticado:
 *   await fetch(url, { method, headers: await authHeaders({ 'Content-Type': 'application/json' }), body });
 */
export async function authHeaders(
  extra: Record<string, string> = {},
): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  return {
    ...extra,
    ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
  };
}
