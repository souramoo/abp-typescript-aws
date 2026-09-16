import { createToken, type Guid } from "@abp/core";
import type { IBasicRepository } from "@abp/ddd-domain";
import type { Setting } from "./setting.js";
import type { SettingDefinitionRecord } from "./setting-definition-record.js";

/**
 * Port of `ISettingRepository`. The `FindAsync`/`GetListAsync` overloads of .NET keep their names next to the
 * `IBasicRepository` members and are told apart by their arguments (a provider name is a string, never a boolean).
 */
export interface ISettingRepository extends IBasicRepository<Setting, Guid> {
  find(id: Guid, includeDetails?: boolean, signal?: AbortSignal): Promise<Setting | undefined>;
  find(name: string, providerName: string | undefined, providerKey: string | undefined, signal?: AbortSignal): Promise<Setting | undefined>;
  getList(includeDetails?: boolean, signal?: AbortSignal): Promise<Setting[]>;
  getList(providerName: string | undefined, providerKey: string | undefined, signal?: AbortSignal): Promise<Setting[]>;
  getList(names: readonly string[], providerName: string | undefined, providerKey: string | undefined, signal?: AbortSignal): Promise<Setting[]>;
}
export const ISettingRepository = createToken<ISettingRepository>("ISettingRepository");

/** Port of `ISettingDefinitionRecordRepository`. */
export interface ISettingDefinitionRecordRepository extends IBasicRepository<SettingDefinitionRecord, Guid> {
  findByName(name: string, signal?: AbortSignal): Promise<SettingDefinitionRecord | undefined>;
}
export const ISettingDefinitionRecordRepository = createToken<ISettingDefinitionRecordRepository>("ISettingDefinitionRecordRepository");

/** The argument forms of the overloaded `ISettingRepository` members, shared by the DynamoDB and memory implementations. */
export type SettingFindArgs = [idOrPredicate: unknown, includeDetailsOrProviderName?: unknown, signalOrProviderKey?: unknown, signal?: AbortSignal];
export type SettingGetListArgs = [first?: unknown, second?: unknown, third?: unknown, fourth?: AbortSignal];

export interface SettingProviderQuery {
  readonly names: readonly string[] | undefined;
  readonly providerName: string | undefined;
  readonly providerKey: string | undefined;
  readonly signal: AbortSignal | undefined;
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

/** Recognizes the `find(name, providerName, providerKey)` overload. */
export function parseSettingFindArgs(args: SettingFindArgs): { readonly name: string; readonly providerName: string | undefined; readonly providerKey: string | undefined; readonly signal: AbortSignal | undefined } | undefined {
  const [first, second, third, fourth] = args;
  if (typeof first !== "string" || args.length < 3 || !isOptionalString(second) || !isOptionalString(third)) return undefined;
  return { name: first, providerName: second, providerKey: third, signal: fourth };
}

/** Recognizes the `getList(providerName, providerKey)` and `getList(names, providerName, providerKey)` overloads. */
export function parseSettingGetListArgs(args: SettingGetListArgs): SettingProviderQuery | undefined {
  const [first, second, third, fourth] = args;
  if (Array.isArray(first)) {
    return { names: first as readonly string[], providerName: isOptionalString(second) ? second : undefined, providerKey: isOptionalString(third) ? third : undefined, signal: fourth };
  }
  if (!isOptionalString(first) || args.length < 2 || !isOptionalString(second)) return undefined;
  return { names: undefined, providerName: first, providerKey: second, signal: third instanceof AbortSignal ? third : undefined };
}
