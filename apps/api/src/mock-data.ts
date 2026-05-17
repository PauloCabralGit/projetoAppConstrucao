import type { ProviderProfile, RegistrationPayload, ServiceRequest } from "@construconnect/shared";

export const providers: ProviderProfile[] = [
  {
    id: "p1",
    name: "Marcos Silva",
    role: "builder",
    city: "Sao Paulo, SP",
    rating: 4.9,
    completedJobs: 138,
    priceFrom: 180,
    availability: "available",
    bio: "Pedreiro para pequenas reformas, contrapiso e acabamento.",
    skills: [
      { id: "s1", label: "Alvenaria" },
      { id: "s2", label: "Reboco" }
    ]
  },
  {
    id: "p2",
    name: "Constrular ABC",
    role: "contractor",
    city: "Santo Andre, SP",
    rating: 4.8,
    completedJobs: 57,
    priceFrom: 1500,
    availability: "busy",
    bio: "Empreiteiro com equipe para reformas completas.",
    skills: [
      { id: "s3", label: "Equipe completa" },
      { id: "s4", label: "Gestao de obra" }
    ]
  }
];

export const requests: ServiceRequest[] = [
  {
    id: "r1",
    clientId: "c1",
    providerId: "p1",
    category: "Piso e contrapiso",
    description: "Nivelar quintal e assentar piso drenante.",
    city: "Sao Paulo, SP",
    budgetMin: 1200,
    budgetMax: 2800,
    scheduledDate: "2026-05-21",
    status: "accepted"
  }
];

export const registrations: RegistrationPayload[] = [];
