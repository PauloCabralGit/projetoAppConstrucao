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
  termsVersion?: string;
  termsAcceptedAt?: string;
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

// ── Propagandas (banners + patrocinados) ────────────────────────────────────

export type AdPlacement = 'home' | 'jobs';
export type AdTarget = 'client' | 'provider' | 'both';

export interface AdBanner {
  id: string;
  title: string;
  advertiser_name: string;
  image_url: string;
  link_url: string | null;
  target: AdTarget;
  placement: AdPlacement;
  priority: number;
}

export interface CreateAdRequest {
  title: string;
  advertiser_name: string;
  image_url: string;
  link_url?: string;
  target: AdTarget;
  placement: AdPlacement;
  active?: boolean;
  starts_at?: string;
  ends_at?: string;
  priority?: number;
}

export interface UpdateAdRequest extends Partial<CreateAdRequest> {}

export interface SponsoredProvider {
  id: string;
  provider_id: string;
  categories: string[];
  cities: string[];
  priority: number;
}

export interface CreateSponsoredProviderRequest {
  provider_id: string;
  categories: string[];
  cities: string[];
  active?: boolean;
  starts_at?: string;
  ends_at?: string;
  priority?: number;
  notes?: string;
}

export interface UpdateSponsoredProviderRequest extends Partial<CreateSponsoredProviderRequest> {}

// ── Telemedicina (parceria) ──────────────────────────────────────────────────

export interface TelemedicineConfigPublic {
  partner_name: string;
  partner_description: string;
  is_active: boolean;
}

export interface TelemedicineConfigAdmin extends TelemedicineConfigPublic {
  id: string;
  access_url: string;
  updated_at: string;
}

export interface TelemedicineConfigResponse extends TelemedicineConfigPublic {
  access_url?: string;
  verified: boolean;
}

export interface TelemedicineAccessLogPayload {
  user_role: 'client' | 'provider';
}

export interface TelemedicineReportEntry {
  dia: string;
  user_role: 'client' | 'provider';
  count: number;
}
