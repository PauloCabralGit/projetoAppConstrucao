export type UserRole = "client" | "builder" | "contractor";

export type AvailabilityStatus = "available" | "busy" | "offline";

export interface SkillTag {
  id: string;
  label: string;
}

export interface ProviderProfile {
  id: string;
  name: string;
  role: "builder" | "contractor";
  city: string;
  rating: number;
  completedJobs: number;
  priceFrom: number;
  availability: AvailabilityStatus;
  skills: SkillTag[];
  bio: string;
}

export interface ClientProfile {
  id: string;
  name: string;
  city: string;
  phone: string;
}

export interface ServiceRequest {
  id: string;
  clientId: string;
  providerId?: string;
  category: string;
  description: string;
  city: string;
  budgetMin: number;
  budgetMax: number;
  scheduledDate: string;
  status: "draft" | "requested" | "accepted" | "in_progress" | "completed";
}

export interface RegistrationPayload {
  role: UserRole;
  fullName: string;
  email: string;
  password: string;
  phone: string;
  city: string;
  document?: string;
  specialties?: string;
  companyName?: string;
  acceptsEmergencyJobs?: boolean;
}

export interface DashboardMetric {
  label: string;
  value: string;
  trend: string;
}

// ── Pagamento com cartão (Mercado Pago) ──────────────────────────────────────
// Apenas referências não sensíveis (PCI: PAN/CVV nunca trafegam ao backend).
export interface SavedCard {
  id: string;
  brand: string | null;
  last4: string;
  expMonth: number;
  expYear: number;
  cardholderName: string | null;
  isDefault: boolean;
}

export interface InstallmentOption {
  installments: number;
  installmentAmount: number;
  totalAmount: number;
  labels: string[];
}

export interface InstallmentsResponse {
  paymentMethodId: string;
  issuerId: string;
  payerCosts: InstallmentOption[];
}

export interface CardPaymentRequest {
  token: string;
  installments: number;
  payment_method_id: string;
  issuer_id?: string;
  payer_email: string;
  payer_first_name?: string;
  payer_last_name?: string;
  payer_cpf?: string;
  /** Device fingerprint do MP (MP_DEVICE_SESSION_ID) → header X-meli-session-id. */
  device_id?: string;
  save_card?: boolean;
  idempotency_key: string;
}

export interface CardPaymentResult {
  status: string;
  statusDetail: string;
  mpPaymentId: string;
  amount: number;
  platformFee: number;
  mpFee: number;
  providerAmount: number;
  installments: number;
  /** Desafio 3DS, quando o emissor exige autenticação adicional. */
  threeDs?: { externalResourceUrl: string; creq: string };
}
