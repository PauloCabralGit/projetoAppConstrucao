// ─────────────────────────────────────────────────────────────────────────────
// MOCKS da Fatia 4 (F4): fluxo de pagamento com cartão SEM rede real.
// Tudo aqui resolve em memória, com delays artificiais para exercitar loading.
//
// FATIA 5 (integração real) trocará estas funções por chamadas autenticadas:
//   - fetchSavedCardsMock      → GET  /v1/cards            (authHeaders)
//   - generateInstallmentsMock → GET  /v1/installments     (authHeaders, amount + bin)
//   - payCardMock              → POST /v1/.../create-card-payment
//                                 (authHeaders + idempotency_key + token MP do device)
// A tokenização (createCardToken do Mercado Pago) acontecerá no passo de REVISÃO,
// imediatamente antes do create-card-payment. PAN/CVV nunca saem do device.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  SavedCard,
  InstallmentOption,
  CardPaymentResult,
} from '@construconnect/shared';

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ── Cartões salvos de exemplo (2 cartões, 1 preferido) ───────────────────────
export const MOCK_SAVED_CARDS: SavedCard[] = [
  {
    id: 'card_mock_visa_4242',
    brand: 'visa',
    last4: '4242',
    expMonth: 12,
    expYear: 2029,
    cardholderName: 'MARIA S OLIVEIRA',
    isDefault: true,
  },
  {
    id: 'card_mock_master_5512',
    brand: 'mastercard',
    last4: '5512',
    expMonth: 3,
    expYear: 2028,
    cardholderName: 'MARIA S OLIVEIRA',
    isDefault: false,
  },
];

/**
 * F4: simula GET /v1/cards. Aceita override para exercitar estados:
 *   'ok'    → 2 cartões salvos
 *   'empty' → nenhum cartão (estado vazio)
 *   'error' → rejeita (estado de erro)
 * FATIA 5: substituir por fetch real com authHeaders.
 */
export async function fetchSavedCardsMock(
  scenario: 'ok' | 'empty' | 'error' = 'ok'
): Promise<SavedCard[]> {
  await delay(700);
  if (scenario === 'error') throw new Error('mock_cards_error');
  if (scenario === 'empty') return [];
  return MOCK_SAVED_CARDS;
}

/**
 * F4: gera opções de parcelamento (crédito). 1x sem juros + 3x/6x com juros fake.
 * FATIA 5: substituir por GET /v1/installments (juros reais do emissor via MP).
 */
export async function generateInstallmentsMock(amount: number): Promise<InstallmentOption[]> {
  await delay(600);
  const plans: Array<{ n: number; rate: number }> = [
    { n: 1, rate: 0 },       // sem juros
    { n: 3, rate: 0.0499 },  // juros fake
    { n: 6, rate: 0.0899 },  // juros fake
  ];
  return plans.map(({ n, rate }) => {
    const totalAmount = Math.round(amount * (1 + rate) * 100) / 100;
    const installmentAmount = Math.round((totalAmount / n) * 100) / 100;
    return {
      installments: n,
      installmentAmount,
      totalAmount,
      labels: [rate === 0 ? 'sem juros' : `com juros (${(rate * 100).toFixed(2)}%)`],
    };
  });
}

export type PayOutcome = 'approved' | 'rejected' | 'error';

export interface PayCardMockParams {
  amount: number;
  installments: number;
  outcome: PayOutcome;
}

/**
 * F4: simula a cobrança. Resolve aprovado/recusado ou rejeita (erro 503/offline)
 * conforme `outcome`, para exercitar os 3 finais da tela de Resultado.
 * FATIA 5: substituir por POST create-card-payment com token MP + idempotency_key.
 */
export async function payCardMock(params: PayCardMockParams): Promise<CardPaymentResult> {
  await delay(1500);
  if (params.outcome === 'error') {
    // Simula indisponibilidade (503) / offline → cai no catch da tela.
    throw new Error('mock_payment_unavailable');
  }
  const platformFee = Math.round(params.amount * 0.05 * 100) / 100;
  const mpFee = Math.round(params.amount * 0.0399 * 100) / 100;
  return {
    status: params.outcome === 'approved' ? 'approved' : 'rejected',
    statusDetail: params.outcome === 'approved' ? 'accredited' : 'cc_rejected_other_reason',
    mpPaymentId: `mock_${Date.now()}`,
    amount: params.amount,
    platformFee,
    mpFee,
    providerAmount: Math.round((params.amount - platformFee - mpFee) * 100) / 100,
    installments: params.installments,
  };
}
