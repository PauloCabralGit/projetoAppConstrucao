// Utilitários PUROS para o fluxo de pagamento com cartão.
// Sem efeitos colaterais, sem rede — seguros para reuso na Fatia 5 (integração real).
// PCI: estes helpers só formatam/validam no device. PAN/CVV NUNCA trafegam ao backend;
// na Fatia 5 o número do cartão vira token via createCardToken (Mercado Pago) no device.

export type CardBrand = 'visa' | 'mastercard' | 'amex' | 'elo' | 'unknown';

export interface CardFieldErrors {
  number?: string;
  expiry?: string;
  cvv?: string;
  name?: string;
  cpf?: string;
}

const ONLY_DIGITS = /\D+/g;

export function onlyDigits(value: string): string {
  return value.replace(ONLY_DIGITS, '');
}

// ── Bandeira ────────────────────────────────────────────────────────────────
export function detectBrand(rawNumber: string): CardBrand {
  const n = onlyDigits(rawNumber);
  if (/^4/.test(n)) return 'visa';
  if (/^3[47]/.test(n)) return 'amex';
  if (/^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/.test(n)) return 'mastercard';
  // Elo: subconjunto representativo de BINs (suficiente para o mock).
  if (/^(4011|4312|4389|4514|4576|5041|5067|509|6277|6362|6363|650|651|655)/.test(n)) return 'elo';
  return 'unknown';
}

export const BRAND_LABEL: Record<CardBrand, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'Amex',
  elo: 'Elo',
  unknown: 'Cartão',
};

// Ionicons disponível no projeto; Ionicons não tem ícones de bandeira específicos,
// então usamos 'card' como genérico. A bandeira textual cobre o "não depender só de cor".
export function brandIcon(_brand: CardBrand): 'card' {
  return 'card';
}

function brandMaxDigits(brand: CardBrand): number {
  return brand === 'amex' ? 15 : 16;
}

function brandCvvLength(brand: CardBrand): number {
  return brand === 'amex' ? 4 : 3;
}

// ── Máscaras ──────────────────────────────────────────────────────────────
export function formatCardNumber(raw: string): string {
  const brand = detectBrand(raw);
  const n = onlyDigits(raw).slice(0, brandMaxDigits(brand));
  if (brand === 'amex') {
    // 4-6-5
    return n.replace(/^(\d{1,4})(\d{1,6})?(\d{1,5})?$/, (_m, a, b, c) =>
      [a, b, c].filter(Boolean).join(' ')
    );
  }
  return n.replace(/(\d{4})(?=\d)/g, '$1 ').trim();
}

export function formatExpiry(raw: string): string {
  const n = onlyDigits(raw).slice(0, 4);
  if (n.length <= 2) return n;
  return `${n.slice(0, 2)}/${n.slice(2)}`;
}

export function formatCpf(raw: string): string {
  const n = onlyDigits(raw).slice(0, 11);
  return n
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2');
}

export function formatBRL(amount: number): string {
  return `R$ ${amount.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── Validações ──────────────────────────────────────────────────────────────
export function luhnValid(rawNumber: string): boolean {
  const n = onlyDigits(rawNumber);
  if (n.length < 13) return false;
  let sum = 0;
  let double = false;
  for (let i = n.length - 1; i >= 0; i--) {
    let digit = Number(n[i]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

export function expiryValid(raw: string): boolean {
  const n = onlyDigits(raw);
  if (n.length !== 4) return false;
  const month = Number(n.slice(0, 2));
  const year = 2000 + Number(n.slice(2));
  if (month < 1 || month > 12) return false;
  const now = new Date();
  const lastDay = new Date(year, month, 0, 23, 59, 59); // fim do mês de validade
  return lastDay >= now;
}

export function cvvValid(raw: string, brand: CardBrand): boolean {
  return onlyDigits(raw).length === brandCvvLength(brand);
}

export function cpfValid(raw: string): boolean {
  const n = onlyDigits(raw);
  if (n.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(n)) return false; // todos iguais
  const calcDigit = (slice: string, factorStart: number): number => {
    let total = 0;
    for (let i = 0; i < slice.length; i++) {
      total += Number(slice[i]) * (factorStart - i);
    }
    const rest = (total * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  const d1 = calcDigit(n.slice(0, 9), 10);
  const d2 = calcDigit(n.slice(0, 10), 11);
  return d1 === Number(n[9]) && d2 === Number(n[10]);
}

export function nameValid(raw: string): boolean {
  return raw.trim().length >= 3 && raw.trim().includes(' ');
}

// ── Mensagens amigáveis de recusa (status_detail do Mercado Pago) ────────────
const STATUS_DETAIL_MESSAGES: Record<string, string> = {
  cc_rejected_insufficient_amount: 'Saldo ou limite insuficiente neste cartão.',
  cc_rejected_bad_filled_security_code: 'CVV incorreto. Confira o código de segurança.',
  cc_rejected_bad_filled_date: 'Data de validade incorreta.',
  cc_rejected_bad_filled_card_number: 'Número do cartão incorreto.',
  cc_rejected_bad_filled_other: 'Dados do cartão incorretos. Revise e tente de novo.',
  cc_rejected_high_risk: 'Pagamento recusado por segurança. Tente outro cartão.',
  cc_rejected_call_for_authorize: 'Autorize esta compra com seu banco e tente de novo.',
  cc_rejected_card_disabled: 'Cartão desabilitado. Ligue para o banco emissor.',
  cc_rejected_duplicated_payment: 'Este pagamento parece duplicado. Verifique antes de repetir.',
  cc_rejected_card_error: 'Não foi possível processar o cartão. Tente novamente.',
  cc_rejected_max_attempts: 'Muitas tentativas. Tente outro cartão.',
  cc_rejected_blacklist: 'Cartão não autorizado. Use outro cartão.',
  card_token_invalid: 'Não conseguimos validar os dados do cartão. Revise e tente de novo.',
};

export function statusDetailMessage(detail?: string | null): string {
  if (!detail) return 'Não conseguimos aprovar a cobrança neste cartão. Tente outro cartão.';
  return (
    STATUS_DETAIL_MESSAGES[detail] ??
    'Não conseguimos aprovar a cobrança neste cartão. Tente outro cartão.'
  );
}

export { brandCvvLength, brandMaxDigits };
