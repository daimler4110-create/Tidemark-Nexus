export type InvoicePayment = { amount: number; status: "pending" | "succeeded" | "failed" | "void"; archivedAt?: string | null };

export function successfulPaymentTotal(payments: InvoicePayment[]): number {
  return payments.filter((payment) => payment.status === "succeeded" && !payment.archivedAt).reduce((total, payment) => total + payment.amount, 0);
}

export function invoiceBalanceDue(total: number, payments: InvoicePayment[]): number {
  return Math.max(0, total - successfulPaymentTotal(payments));
}

export type AgingBucket = "current" | "1_30" | "31_60" | "61_90" | "90_plus" | "settled";
export function agingBucket(balanceDue: number, dueDate: string | null, today = new Date()): AgingBucket {
  if (balanceDue <= 0) return "settled";
  if (!dueDate) return "current";
  const days = Math.floor((Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) - Date.parse(`${dueDate}T00:00:00Z`)) / 86_400_000);
  if (days <= 0) return "current";
  if (days <= 30) return "1_30";
  if (days <= 60) return "31_60";
  if (days <= 90) return "61_90";
  return "90_plus";
}
