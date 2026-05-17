import type { DashboardMetric, ProviderProfile, ServiceRequest } from "@construconnect/shared";

export const providerProfiles: ProviderProfile[] = [
  {
    id: "p1",
    name: "Marcos Silva",
    role: "builder",
    city: "Sao Paulo, SP",
    rating: 4.9,
    completedJobs: 138,
    priceFrom: 180,
    availability: "available",
    bio: "Pedreiro com foco em reformas rapidas, contrapiso, reboco e pequenos acabamentos.",
    skills: [
      { id: "s1", label: "Reforma rapida" },
      { id: "s2", label: "Alvenaria" },
      { id: "s3", label: "Piso" }
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
    bio: "Empreiteiro para obra residencial, equipes por etapa e cronograma semanal.",
    skills: [
      { id: "s4", label: "Empreitada" },
      { id: "s5", label: "Equipe completa" },
      { id: "s6", label: "Cronograma" }
    ]
  },
  {
    id: "p3",
    name: "Joao Acabamentos",
    role: "builder",
    city: "Guarulhos, SP",
    rating: 4.7,
    completedJobs: 89,
    priceFrom: 220,
    availability: "available",
    bio: "Especialista em porcelanato, pintura final e acabamento fino para apartamentos.",
    skills: [
      { id: "s7", label: "Porcelanato" },
      { id: "s8", label: "Pintura" },
      { id: "s9", label: "Acabamento fino" }
    ]
  }
];

export const serviceRequests: ServiceRequest[] = [
  {
    id: "r1",
    clientId: "c1",
    providerId: "p1",
    category: "Reboco de parede",
    description: "Sala e corredor com umidade tratada, pronto para acabamento.",
    city: "Sao Paulo, SP",
    budgetMin: 500,
    budgetMax: 1200,
    scheduledDate: "2026-05-20",
    status: "accepted"
  },
  {
    id: "r2",
    clientId: "c1",
    providerId: "p2",
    category: "Reforma de banheiro",
    description: "Troca de piso, nicho, impermeabilizacao e instalacao de box.",
    city: "Santo Andre, SP",
    budgetMin: 4000,
    budgetMax: 8500,
    scheduledDate: "2026-05-28",
    status: "requested"
  }
];

export const dashboardMetrics: DashboardMetric[] = [
  {
    label: "Pedidos em aberto",
    value: "24",
    trend: "+12% na ultima semana"
  },
  {
    label: "Prestadores validados",
    value: "318",
    trend: "78 com biometria ativa"
  },
  {
    label: "Tempo medio de aceite",
    value: "14 min",
    trend: "-3 min comparado ao mes anterior"
  }
];
