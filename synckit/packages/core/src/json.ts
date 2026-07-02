import { z } from "zod";

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

/** JSON value whose serialized size must not exceed `maxBytes`. */
export function boundedJson(maxBytes: number): z.ZodType<JsonValue> {
  return jsonValueSchema.refine(
    (value) => new TextEncoder().encode(JSON.stringify(value)).length <= maxBytes,
    { message: `payload exceeds ${maxBytes} bytes` },
  );
}
