export type DisplayRow = Record<string, unknown>;

export const humanName = (row: DisplayRow | undefined) => {
  if (!row) return null;
  const displayName = typeof row.display_name === "string" && row.display_name.trim() ? row.display_name.trim() : null;
  if (displayName) return displayName;
  const name = typeof row.name === "string" && row.name.trim() ? row.name.trim() : null;
  if (name) return name;
  const parts = [row.first_name, row.middle_name, row.last_name].filter((part): part is string => typeof part === "string" && part.trim().length > 0);
  return parts.length > 0 ? parts.join(" ") : null;
};

export const displayNameFor = (resource: string, row: DisplayRow, related: Record<string, DisplayRow> = {}) => {
  if (resource === "credentials") {
    const holder = typeof row.holder_display_name === "string" ? row.holder_display_name : humanName(related[String(row.provider_id ?? "")]) ?? humanName(related[String(row.clinician_id ?? "")]);
    const credential = typeof row.credential_type === "string" ? row.credential_type : "Credential";
    return holder ? `${holder} — ${credential}` : credential;
  }
  if (resource === "payments") return typeof row.reference === "string" && row.reference.trim() ? row.reference : row.payment_date ? `Payment on ${String(row.payment_date)}` : "Payment";
  if (resource === "payroll" && row.start_date && row.end_date) return `${String(row.start_date)} – ${String(row.end_date)}`;
  return humanName(row) ?? (typeof row.invoice_number === "string" ? row.invoice_number : null) ?? (typeof row.description === "string" ? row.description : null) ?? (typeof row.credential_type === "string" ? row.credential_type : null) ?? "Unnamed record";
};
