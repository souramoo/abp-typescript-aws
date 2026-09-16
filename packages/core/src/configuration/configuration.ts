import { createToken } from "../dependency-injection/service-token.js";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Port of `IConfiguration`. Keys are `:`-separated paths and case-insensitive
 * (`"Abp:Auditing:IsEnabled"`), exactly like .NET configuration.
 */
export interface IConfiguration {
  get(key: string): string | undefined;
  getSection(key: string): IConfiguration;
  getChildren(): IConfiguration[];
  readonly path: string;
  readonly key: string;
  readonly value: string | undefined;
  exists(): boolean;
  /** Binds the section to a plain object (numbers/booleans parsed when possible). */
  toObject<T = Record<string, unknown>>(): T;
}

export const IConfiguration = createToken<IConfiguration>("IConfiguration");

type FlatMap = Map<string, string>;

function normalize(key: string): string {
  return key.replace(/__/g, ":").toLowerCase();
}

function flatten(obj: unknown, prefix: string, into: FlatMap): void {
  if (obj === null || obj === undefined) return;
  if (typeof obj !== "object") {
    into.set(normalize(prefix), String(obj));
    return;
  }
  if (Array.isArray(obj)) {
    obj.forEach((item, i) => flatten(item, prefix ? `${prefix}:${i}` : String(i), into));
    return;
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    flatten(v, prefix ? `${prefix}:${k}` : k, into);
  }
}

function parseScalar(value: string): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value.trim() !== "" && !Number.isNaN(Number(value))) return Number(value);
  return value;
}

export class Configuration implements IConfiguration {
  constructor(
    private readonly data: FlatMap,
    private readonly originalKeys: Map<string, string>,
    readonly path: string = "",
  ) {}

  /** Last segment of the path, in the casing it was declared with (falls back to the requested casing). */
  get key(): string {
    const original = this.originalKeys.get(normalize(this.path));
    const source = original ?? this.path;
    const i = source.lastIndexOf(":");
    return i < 0 ? source : source.slice(i + 1);
  }

  get value(): string | undefined {
    return this.path ? this.data.get(normalize(this.path)) : undefined;
  }

  get(key: string): string | undefined {
    return this.data.get(normalize(this.fullKey(key)));
  }

  getSection(key: string): IConfiguration {
    return new Configuration(this.data, this.originalKeys, this.fullKey(key));
  }

  exists(): boolean {
    const prefix = normalize(this.path);
    if (!prefix) return this.data.size > 0;
    for (const k of this.data.keys()) if (k === prefix || k.startsWith(prefix + ":")) return true;
    return false;
  }

  getChildren(): IConfiguration[] {
    const prefix = this.path ? normalize(this.path) + ":" : "";
    const names = new Map<string, string>();
    for (const k of this.data.keys()) {
      if (!k.startsWith(prefix)) continue;
      const rest = k.slice(prefix.length);
      const first = rest.split(":")[0];
      if (!first || names.has(first)) continue;
      const original = this.originalKeys.get(k)?.slice(prefix.length).split(":")[0];
      names.set(first, original ?? first);
    }
    return [...names.values()].map((n) => this.getSection(n));
  }

  toObject<T = Record<string, unknown>>(): T {
    const prefix = this.path ? normalize(this.path) + ":" : "";
    const result: Record<string, unknown> = {};
    for (const [k, v] of this.data) {
      if (!k.startsWith(prefix)) continue;
      const parts = (this.originalKeys.get(k) ?? k).slice(prefix.length).split(":");
      let cursor = result;
      for (let i = 0; i < parts.length - 1; i++) {
        const p = parts[i]!;
        const next = cursor[p];
        if (typeof next !== "object" || next === null) cursor[p] = {};
        cursor = cursor[p] as Record<string, unknown>;
      }
      cursor[parts[parts.length - 1]!] = parseScalar(v);
    }
    return arrayify(result) as T;
  }

  private fullKey(key: string): string {
    return this.path ? `${this.path}:${key}` : key;
  }
}

function arrayify(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj);
  for (const k of keys) obj[k] = arrayify(obj[k]);
  if (keys.length > 0 && keys.every((k, i) => k === String(i))) return keys.map((k) => obj[k]);
  return obj;
}

export interface ConfigurationBuilderOptions {
  /** Directory to look for `appsettings.json` and `appsettings.{env}.json`. */
  basePath?: string;
  fileName?: string;
  environmentName?: string;
  /** Prefix filter for environment variables (`""` = all). */
  environmentVariablesPrefix?: string;
}

/** Port of `ConfigurationBuilder` with the sources ABP adds by default: JSON files, env vars, in-memory. */
export class ConfigurationBuilder {
  private readonly data: FlatMap = new Map();
  private readonly originalKeys = new Map<string, string>();

  addInMemory(values: Record<string, unknown>): this {
    const flat: FlatMap = new Map();
    flatten(values, "", flat);
    this.merge(flat, values);
    return this;
  }

  addJsonFile(path: string, optional = true): this {
    if (!existsSync(path)) {
      if (optional) return this;
      throw new Error(`Configuration file not found: ${path}`);
    }
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    return this.addInMemory(parsed);
  }

  addEnvironmentVariables(prefix = ""): this {
    const flat: FlatMap = new Map();
    for (const [k, v] of Object.entries(process.env)) {
      if (v === undefined) continue;
      if (prefix && !k.startsWith(prefix)) continue;
      const key = k.slice(prefix.length);
      flat.set(normalize(key), v);
      this.originalKeys.set(normalize(key), key.replace(/__/g, ":"));
    }
    for (const [k, v] of flat) this.data.set(k, v);
    return this;
  }

  addDefaults(options: ConfigurationBuilderOptions = {}): this {
    const base = options.basePath ?? process.cwd();
    const name = options.fileName ?? "appsettings";
    const env = options.environmentName ?? process.env["ABP_ENVIRONMENT"] ?? process.env["NODE_ENV"] ?? "Production";
    this.addJsonFile(resolve(base, `${name}.json`));
    this.addJsonFile(resolve(base, `${name}.${env}.json`));
    this.addJsonFile(resolve(base, `${name}.secrets.json`));
    this.addEnvironmentVariables(options.environmentVariablesPrefix ?? "");
    return this;
  }

  build(): IConfiguration {
    return new Configuration(new Map(this.data), new Map(this.originalKeys));
  }

  private merge(flat: FlatMap, source: Record<string, unknown>): void {
    const originals: FlatMap = new Map();
    flatten(source, "", originals);
    for (const [k, v] of flat) this.data.set(k, v);
    collectOriginalKeys(source, "", this.originalKeys);
  }
}

function collectOriginalKeys(obj: unknown, prefix: string, into: Map<string, string>): void {
  if (obj === null || typeof obj !== "object") {
    if (prefix) into.set(normalize(prefix), prefix);
    return;
  }
  if (Array.isArray(obj)) {
    obj.forEach((item, i) => collectOriginalKeys(item, prefix ? `${prefix}:${i}` : String(i), into));
    return;
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) collectOriginalKeys(v, prefix ? `${prefix}:${k}` : k, into);
}

export function configurationValue<T>(configuration: IConfiguration, key: string, defaultValue: T): T {
  const raw = configuration.get(key);
  if (raw === undefined) return defaultValue;
  return parseScalar(raw) as T;
}
