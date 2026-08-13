export type PayrollStatus = "draft" | "review" | "approved" | "finalized" | "paid";
const transitions: Record<PayrollStatus, PayrollStatus[]> = { draft: ["review"], review: ["approved"], approved: ["finalized"], finalized: ["paid"], paid: [] };
export const canTransitionPayroll = (from: PayrollStatus, to: PayrollStatus) => transitions[from].includes(to);
export const isPayrollLocked = (status: PayrollStatus) => status === "finalized" || status === "paid";
