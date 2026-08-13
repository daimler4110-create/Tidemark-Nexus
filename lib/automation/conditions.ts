export type Condition = { field: string; operator: "equals" | "not_equals" | "contains" | "is_empty" | "is_not_empty" | "before_date" | "after_date" | "within_days" | "greater_than" | "less_than"; value?: string | number | boolean | null };

const valueAt = (payload: Record<string, unknown>, path: string): unknown => path.split(".").reduce<unknown>((value, key) => value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>)[key] : undefined, payload);
const empty = (value: unknown) => value == null || value === "" || Array.isArray(value) && value.length === 0;
const date = (value: unknown) => typeof value === "string" ? Date.parse(value.includes("T") ? value : `${value}T00:00:00Z`) : Number.NaN;

/** Executes only the fixed declarative condition vocabulary; never user code. */
export function conditionsMatch(conditions: Condition[], payload: Record<string, unknown>, now = new Date()) {
  return conditions.every((condition) => {
    const actual = valueAt(payload, condition.field); const expected = condition.value;
    switch (condition.operator) {
      case "equals": return String(actual ?? "") === String(expected ?? "");
      case "not_equals": return String(actual ?? "") !== String(expected ?? "");
      case "contains": return String(actual ?? "").toLowerCase().includes(String(expected ?? "").toLowerCase());
      case "is_empty": return empty(actual);
      case "is_not_empty": return !empty(actual);
      case "greater_than": return Number(actual) > Number(expected);
      case "less_than": return Number(actual) < Number(expected);
      case "before_date": return date(actual) < date(expected);
      case "after_date": return date(actual) > date(expected);
      case "within_days": { const at = date(actual); const days = Number(expected); return !Number.isNaN(at) && at >= Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) && at <= Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days); }
    }
  });
}
