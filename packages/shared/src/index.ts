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
