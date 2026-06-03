// Store for jobs rejected by the provider.
// Kept in an in-memory Set (modules are cached for the app lifetime, so it
// persists across navigation) AND mirrored to expo-secure-store so rejected
// jobs stay hidden even after the app is reloaded or killed.
import * as SecureStore from 'expo-secure-store';

const STORAGE_KEY = 'rejected_job_ids';

export const rejectedJobIds = new Set<string>();

let hydrated = false;

/**
 * Loads the persisted rejected-job IDs into the in-memory Set.
 * Safe to call multiple times — only reads from storage once.
 */
export async function loadRejectedJobIds(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = await SecureStore.getItemAsync(STORAGE_KEY);
    if (raw) {
      const ids = JSON.parse(raw) as string[];
      ids.forEach((id) => rejectedJobIds.add(id));
    }
  } catch {
    // Ignore storage/parse errors — fall back to in-memory only.
  }
}

/**
 * Adds a job id to the rejected set and persists the updated set.
 */
export async function addRejectedJobId(id: string): Promise<void> {
  rejectedJobIds.add(id);
  try {
    await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify([...rejectedJobIds]));
  } catch {
    // Ignore storage errors — the in-memory Set still hides the job this session.
  }
}
