export type CredentialExpiryState = "active" | "expiring_soon" | "expired" | "undated";
export function credentialExpiryState(expirationDate: string | null, leadTimeDays: number | null, today = new Date()): CredentialExpiryState {
  if (!expirationDate) return "undated";
  const days = Math.floor((Date.parse(`${expirationDate}T00:00:00Z`) - Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())) / 86_400_000);
  if (days < 0) return "expired";
  if (leadTimeDays !== null && days <= leadTimeDays) return "expiring_soon";
  return "active";
}
