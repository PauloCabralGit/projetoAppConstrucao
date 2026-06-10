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

// Formato de erro padronizado da API.
// Durante a transição, a API faz dual-write: { error: {...}, message } —
// o `message` no topo é legado e será removido após os apps migrarem.
export type ApiErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "VALIDATION"
  | "PLAN_LIMIT_REACHED"
  | "RATE_LIMITED"
  | "INTERNAL";

export interface ApiError {
  error: { code: ApiErrorCode; message: string; details?: unknown };
}
