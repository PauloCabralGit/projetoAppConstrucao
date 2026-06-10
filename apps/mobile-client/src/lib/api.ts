// ─────────────────────────────────────────────────────────────────────────────
// Camada de rede do fluxo de pagamento com cartão (Fatia 5 — integração real).
//
// PCI: PAN/CVV NUNCA trafegam ao nosso backend. O número/CVV são trocados por um
// token de uso único no próprio device, chamando o Mercado Pago direto com a
// public key (tokenizeNewCard / tokenizeSavedCard). Só o token vai ao backend.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  SavedCard,
  InstallmentsResponse,
  CardPaymentRequest,
  CardPaymentResult,
} from '@construconnect/shared';
import { supabase } from './supabase';

export const API_BASE = 'https://construconnect-api.orionsystem.workers.dev/v1';

/** Falha de sessão/permissão (sem login ou 401 do backend). */
export class AuthError extends Error {
  constructor(message = 'unauthorized') {
    super(message);
    this.name = 'AuthError';
  }
}

/** Cartão recusado já na tokenização do MP (dados inválidos no device). */
export class CardTokenError extends Error {
  constructor(message = 'card_token_invalid') {
    super(message);
    this.name = 'CardTokenError';
  }
}

// ── Auth / sessão ────────────────────────────────────────────────────────────
export async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new AuthError('no_session');
  return { Authorization: `Bearer ${session.access_token}` };
}

/** E-mail do pagador (payer_email) a partir da sessão Supabase. */
export async function getPayerEmail(): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  return user?.email ?? '';
}

// ── UUID (idempotency_key) ───────────────────────────────────────────────────
// expo-crypto não está instalado neste app; usamos crypto.randomUUID quando
// disponível (Hermes recente) e caímos em um v4 baseado em Math.random — robusto
// o suficiente para deduplicar uma tentativa de cobrança.
export function randomUUID(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ── Public key do Mercado Pago (cache em memória) ────────────────────────────
let cachedPublicKey: string | null = null;

export async function getMpPublicKey(): Promise<string> {
  if (cachedPublicKey) return cachedPublicKey;
  const res = await fetch(`${API_BASE}/mp-public-key`);
  if (!res.ok) throw new Error('mp_public_key_unavailable');
  const data = (await res.json()) as { publicKey?: string };
  if (!data.publicKey) throw new Error('mp_public_key_missing');
  cachedPublicKey = data.publicKey;
  return cachedPublicKey;
}

// ── Cartões salvos ───────────────────────────────────────────────────────────
export async function fetchSavedCards(): Promise<SavedCard[]> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/cards`, { headers });
  if (res.status === 401) throw new AuthError('unauthorized');
  if (!res.ok) throw new Error('cards_failed');
  const data = (await res.json()) as { cards?: SavedCard[] };
  return data.cards ?? [];
}

export async function deleteSavedCard(id: string): Promise<void> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/cards/${id}`, { method: 'DELETE', headers });
  if (res.status === 401) throw new AuthError('unauthorized');
  if (!res.ok) throw new Error('card_delete_failed');
}

export async function setDefaultCard(id: string): Promise<void> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/cards/${id}/default`, { method: 'PATCH', headers });
  if (res.status === 401) throw new AuthError('unauthorized');
  if (!res.ok) throw new Error('card_default_failed');
}

// ── Parcelas (juros reais do emissor via MP) ─────────────────────────────────
// Cartão novo → bin (6 primeiros do PAN); cartão salvo → payment_method_id (bandeira).
export async function fetchInstallments(
  requestId: string,
  query: { bin?: string; paymentMethodId?: string }
): Promise<InstallmentsResponse> {
  const headers = await authHeaders();
  const params = new URLSearchParams();
  if (query.bin) params.set('bin', query.bin);
  if (query.paymentMethodId) params.set('payment_method_id', query.paymentMethodId);
  const res = await fetch(
    `${API_BASE}/service-requests/${requestId}/installments?${params.toString()}`,
    { headers }
  );
  if (res.status === 401) throw new AuthError('unauthorized');
  if (!res.ok) throw new Error('installments_failed');
  return (await res.json()) as InstallmentsResponse;
}

// ── Tokenização no device (PCI) ──────────────────────────────────────────────
interface NewCardTokenInput {
  number: string;        // só dígitos
  securityCode: string;  // só dígitos
  expMonth: number;
  expYear: number;       // 4 dígitos
  name: string;
  cpf: string;           // só dígitos
}

interface MpTokenResponse {
  id: string;
  first_six_digits?: string;
  last_four_digits?: string;
}

export async function tokenizeNewCard(pk: string, card: NewCardTokenInput): Promise<string> {
  const res = await fetch(`https://api.mercadopago.com/v1/card_tokens?public_key=${pk}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      card_number: card.number,
      security_code: card.securityCode,
      expiration_month: card.expMonth,
      expiration_year: card.expYear,
      cardholder: {
        name: card.name,
        identification: { type: 'CPF', number: card.cpf },
      },
    }),
  });
  if (!res.ok) throw new CardTokenError();
  const data = (await res.json()) as MpTokenResponse;
  if (!data.id) throw new CardTokenError();
  return data.id;
}

export async function tokenizeSavedCard(
  pk: string,
  cardId: string,
  securityCode: string
): Promise<string> {
  const res = await fetch(`https://api.mercadopago.com/v1/card_tokens?public_key=${pk}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ card_id: cardId, security_code: securityCode }),
  });
  if (!res.ok) throw new CardTokenError();
  const data = (await res.json()) as MpTokenResponse;
  if (!data.id) throw new CardTokenError();
  return data.id;
}

// ── Cobrança ─────────────────────────────────────────────────────────────────
export type ChargeOutcome =
  | { kind: 'approved'; result: CardPaymentResult }
  | { kind: 'rejected'; result: CardPaymentResult | null; statusDetail: string }
  | { kind: 'token_expired' }
  | { kind: 'unavailable' };

export async function createCardPayment(
  requestId: string,
  body: CardPaymentRequest
): Promise<ChargeOutcome> {
  let res: Response;
  try {
    const headers = await authHeaders();
    res = await fetch(`${API_BASE}/service-requests/${requestId}/create-card-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  } catch {
    // offline / DNS / timeout
    return { kind: 'unavailable' };
  }

  if (res.status === 503) return { kind: 'unavailable' };

  type ChargeBody = Partial<CardPaymentResult> & { message?: string };
  let data: ChargeBody | null = null;
  try {
    data = (await res.json()) as ChargeBody;
  } catch {
    data = null;
  }

  // Recusa de negócio do MP: HTTP 402 com statusDetail.
  if (res.status === 402) {
    return {
      kind: 'rejected',
      result: (data as CardPaymentResult | null) ?? null,
      statusDetail: data?.statusDetail ?? 'cc_rejected_other_reason',
    };
  }

  // Token de uso único expirado/já consumido → re-tokenizar.
  if (res.status === 400) {
    const detail = String(data?.statusDetail ?? data?.message ?? '').toLowerCase();
    if (detail.includes('token')) return { kind: 'token_expired' };
    return { kind: 'rejected', result: null, statusDetail: data?.statusDetail ?? 'invalid_request' };
  }

  if (!res.ok || !data) return { kind: 'unavailable' };

  const result = data as CardPaymentResult;
  if (
    result.status === 'approved' ||
    result.status === 'authorized' ||
    result.status === 'in_process'
  ) {
    return { kind: 'approved', result };
  }
  return {
    kind: 'rejected',
    result,
    statusDetail: result.statusDetail ?? 'cc_rejected_other_reason',
  };
}
