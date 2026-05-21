// In-memory store for jobs rejected by the provider this session.
// Modules are cached for the app lifetime, so this persists across navigation.
export const rejectedJobIds = new Set<string>();
