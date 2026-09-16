import { AbpException, Transient, createToken, optionsToken, type Class, type IOptions } from "@abp/core";
import { IJsonSerializer } from "@abp/json";
import { AbpAuditingOptions } from "./abp-auditing-options.js";
import { DisableAuditingMetadata } from "./contracts.js";

/** Port of `IAuditSerializer`. */
export interface IAuditSerializer {
  serialize(obj: unknown): string;
}
export const IAuditSerializer = createToken<IAuditSerializer>("IAuditSerializer");

export function isInstanceOfAny(value: unknown, types: readonly Class[]): boolean {
  return typeof value === "object" && value !== null && types.some((t) => value instanceof t);
}

/**
 * Port of `JsonAuditSerializer`: serializes with `IJsonSerializer` after dropping members marked `@DisableAuditing()`,
 * every member of classes marked `@DisableAuditing()` and values of `AbpAuditingOptions.ignoredTypes`.
 */
@Transient(IAuditSerializer)
export class JsonAuditSerializer implements IAuditSerializer {
  static readonly inject = [optionsToken(AbpAuditingOptions), IJsonSerializer] as const;
  protected readonly options: AbpAuditingOptions;

  constructor(
    options: IOptions<AbpAuditingOptions>,
    protected readonly jsonSerializer: IJsonSerializer,
  ) {
    this.options = options.value;
  }

  serialize(obj: unknown): string {
    return this.jsonSerializer.serialize(this.sanitize(obj, new Set()));
  }

  protected sanitize(value: unknown, ancestors: Set<object>): unknown {
    if (value === null || typeof value !== "object") return value;
    if (value instanceof Date) return value;
    if (isInstanceOfAny(value, this.options.ignoredTypes)) return null;
    if (ancestors.has(value)) throw new AbpException("Converting circular structure to JSON.");
    ancestors.add(value);
    try {
      if (Array.isArray(value)) return value.map((item) => this.sanitize(item, ancestors));
      if (value instanceof Set) return [...value].map((item) => this.sanitize(item, ancestors));
      if (value instanceof Map) {
        const result: Record<string, unknown> = {};
        for (const [k, v] of value) result[String(k)] = this.sanitize(v, ancestors);
        return result;
      }
      const type = value.constructor as Class | undefined;
      const hasType = typeof type === "function" && type !== Object;
      if (hasType && DisableAuditingMetadata.getForClass(type) !== undefined) return {};
      const result: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) {
        if (typeof item === "function") continue;
        if (hasType && DisableAuditingMetadata.get(type, key) !== undefined) continue;
        if (isInstanceOfAny(item, this.options.ignoredTypes)) continue;
        result[key] = this.sanitize(item, ancestors);
      }
      return result;
    } finally {
      ancestors.delete(value);
    }
  }
}
