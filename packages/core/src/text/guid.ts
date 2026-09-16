import { randomUUID } from "node:crypto";

/** ABP uses `Guid` keys everywhere; in TypeScript a Guid is a lowercase UUID string. */
export type Guid = string;

export const Guid = {
  empty: "00000000-0000-0000-0000-000000000000" as Guid,
  newGuid(): Guid {
    return randomUUID();
  },
  isValid(value: unknown): value is Guid {
    return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  },
  parse(value: string): Guid {
    if (!Guid.isValid(value)) throw new Error(`'${value}' is not a valid Guid`);
    return value.toLowerCase();
  },
  equals(a: Guid | null | undefined, b: Guid | null | undefined): boolean {
    if (a == null || b == null) return a == b;
    return a.toLowerCase() === b.toLowerCase();
  },
};

export function randomString(length = 16): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += chars[b % chars.length];
  return out;
}
