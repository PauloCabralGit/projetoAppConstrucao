import { useState } from 'react';

const API_BASE = 'https://construconnect-api.orionsystem.workers.dev/v1';

interface RatingPayload {
  service_request_id: string;
  score: number;
  comment?: string;
}

interface RatingResponse {
  id: string;
  score: number;
  comment?: string;
  created_at: string;
}

export function useRating() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitRating = async (
    serviceRequestId: string,
    score: number,
    comment?: string
  ): Promise<RatingResponse> => {
    setLoading(true);
    setError(null);

    try {
      const payload: RatingPayload = {
        service_request_id: serviceRequestId,
        score,
        ...(comment && { comment }),
      };

      const response = await fetch(`${API_BASE}/ratings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage =
          errorData.error?.message ||
          errorData.message ||
          `HTTP ${response.status}: ${response.statusText}`;
        throw new Error(errorMessage);
      }

      const data = await response.json();
      return data;
    } catch (err) {
      const errorMsg = (err as Error).message || 'Erro desconhecido ao enviar avaliação';
      setError(errorMsg);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const clearError = () => setError(null);

  return {
    submitRating,
    loading,
    error,
    clearError,
  };
}
