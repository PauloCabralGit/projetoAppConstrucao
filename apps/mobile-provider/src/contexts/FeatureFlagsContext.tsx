import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

import { API_BASE } from '@/lib/config';

export type Flags = {
  maintenance_mode: boolean;
  new_registrations: boolean;
  emergency_requests: boolean;
  provider_bidding: boolean;
  pix_payments: boolean;
  cash_payments: boolean;
  chat: boolean;
  push_notifications: boolean;
  ratings: boolean;
  formal_complaints: boolean;
  provider_tracking: boolean;
};

const DEFAULTS: Flags = {
  maintenance_mode: false,
  new_registrations: true,
  emergency_requests: true,
  provider_bidding: true,
  pix_payments: true,
  cash_payments: true,
  chat: true,
  push_notifications: true,
  ratings: true,
  formal_complaints: true,
  provider_tracking: true,
};

const FeatureFlagsContext = createContext<Flags>(DEFAULTS);

export function FeatureFlagsProvider({ children }: { children: ReactNode }) {
  const [flags, setFlags] = useState<Flags>(DEFAULTS);

  useEffect(() => {
    fetch(`${API_BASE}/feature-flags`)
      .then(r => r.json())
      .then(data => setFlags({ ...DEFAULTS, ...data }))
      .catch(() => {});
  }, []);

  return (
    <FeatureFlagsContext.Provider value={flags}>
      {children}
    </FeatureFlagsContext.Provider>
  );
}

export function useFlags(): Flags {
  return useContext(FeatureFlagsContext);
}
