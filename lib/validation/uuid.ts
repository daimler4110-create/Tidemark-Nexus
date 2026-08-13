import { z } from "zod";

const blankToNull = (value: unknown) => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
};

const trimText = (value: unknown) => typeof value === "string" ? value.trim() : value;

export const isUuid = (value: unknown): value is string =>
  typeof value === "string" && z.string().uuid().safeParse(value).success;

/**
 * Accepts browser form blanks as null before UUID validation. Invalid nonblank
 * values are deliberately retained so Zod can return a field-specific error.
 */
export const optionalUuid = (field: string) => z.preprocess(
  blankToNull,
  z.string({ invalid_type_error: `${field} must be a selected record.` })
    .uuid(`${field} must be a valid UUID from an authorized record.`)
    .nullable()
    .optional(),
);

export const requiredUuid = (field: string) => z.preprocess(
  trimText,
  z.string({ required_error: `${field} is required.`, invalid_type_error: `${field} must be a selected record.` })
    .min(1, `${field} is required.`)
    .uuid(`${field} must be a valid UUID from an authorized record.`),
);

export function readableFieldName(path: PropertyKey[]) {
  const key = path.find((part): part is string => typeof part === "string");
  return key ? key.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Input";
}

export function zodInputError(error: z.ZodError) {
  const issue = error.issues[0];
  if (!issue) return "Invalid input.";
  return `${readableFieldName(issue.path)}: ${issue.message}`;
}
