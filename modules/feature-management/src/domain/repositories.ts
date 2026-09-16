import { createToken, type Guid } from "@abp/core";
import type { IBasicRepository } from "@abp/ddd-domain";
import type { FeatureDefinitionRecord, FeatureGroupDefinitionRecord } from "./feature-definition-records.js";
import type { FeatureValue } from "./feature-value.js";

/**
 * Port of `IFeatureValueRepository`. The `FindAsync`/`GetListAsync`/`DeleteAsync` overloads of .NET keep their
 * names next to the `IBasicRepository` members and are told apart by their arguments.
 */
export interface IFeatureValueRepository extends IBasicRepository<FeatureValue, Guid> {
  find(id: Guid, includeDetails?: boolean, signal?: AbortSignal): Promise<FeatureValue | undefined>;
  find(name: string, providerName: string | undefined, providerKey: string | undefined, signal?: AbortSignal): Promise<FeatureValue | undefined>;
  findAll(name: string, providerName: string | undefined, providerKey: string | undefined, signal?: AbortSignal): Promise<FeatureValue[]>;
  getList(includeDetails?: boolean, signal?: AbortSignal): Promise<FeatureValue[]>;
  getList(providerName: string | undefined, providerKey: string | undefined, signal?: AbortSignal): Promise<FeatureValue[]>;
  delete(entity: FeatureValue, autoSave?: boolean, signal?: AbortSignal): Promise<void>;
  /** Port of `DeleteAsync(providerName, providerKey)`: deletes every value of the provider/key pair directly. */
  delete(providerName: string, providerKey: string | undefined, signal?: AbortSignal): Promise<void>;
}
export const IFeatureValueRepository = createToken<IFeatureValueRepository>("IFeatureValueRepository");

/** Port of `IFeatureDefinitionRecordRepository`. */
export interface IFeatureDefinitionRecordRepository extends IBasicRepository<FeatureDefinitionRecord, Guid> {
  findByName(name: string, signal?: AbortSignal): Promise<FeatureDefinitionRecord | undefined>;
}
export const IFeatureDefinitionRecordRepository = createToken<IFeatureDefinitionRecordRepository>("IFeatureDefinitionRecordRepository");

/** Port of `IFeatureGroupDefinitionRecordRepository`. */
export type IFeatureGroupDefinitionRecordRepository = IBasicRepository<FeatureGroupDefinitionRecord, Guid>;
export const IFeatureGroupDefinitionRecordRepository = createToken<IFeatureGroupDefinitionRecordRepository>("IFeatureGroupDefinitionRecordRepository");

/** The argument forms of the overloaded `IFeatureValueRepository` members, shared by the DynamoDB and memory implementations. */
export type FeatureValueFindArgs = [idOrPredicate: unknown, includeDetailsOrProviderName?: unknown, signalOrProviderKey?: unknown, signal?: AbortSignal];
export type FeatureValueGetListArgs = [first?: unknown, second?: unknown, third?: AbortSignal];
export type FeatureValueDeleteArgs = [entityOrProviderName: unknown, autoSaveOrProviderKey?: unknown, signal?: AbortSignal];

export interface FeatureValueLookup {
  readonly name: string;
  readonly providerName: string | undefined;
  readonly providerKey: string | undefined;
  readonly signal: AbortSignal | undefined;
}

export interface FeatureValueProviderQuery {
  readonly providerName: string | undefined;
  readonly providerKey: string | undefined;
  readonly signal: AbortSignal | undefined;
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

/** Recognizes the `find(name, providerName, providerKey)` overload. */
export function parseFeatureValueFindArgs(args: FeatureValueFindArgs): FeatureValueLookup | undefined {
  const [first, second, third, fourth] = args;
  if (typeof first !== "string" || args.length < 3 || !isOptionalString(second) || !isOptionalString(third)) return undefined;
  return { name: first, providerName: second, providerKey: third, signal: fourth };
}

/** Recognizes the `getList(providerName, providerKey)` overload. */
export function parseFeatureValueGetListArgs(args: FeatureValueGetListArgs): FeatureValueProviderQuery | undefined {
  const [first, second, third] = args;
  if (!isOptionalString(first) || args.length < 2 || !isOptionalString(second)) return undefined;
  return { providerName: first, providerKey: second, signal: third };
}

/** Recognizes the `delete(providerName, providerKey)` overload. */
export function parseFeatureValueDeleteArgs(args: FeatureValueDeleteArgs): FeatureValueProviderQuery | undefined {
  const [first, second, third] = args;
  if (typeof first !== "string" || !isOptionalString(second)) return undefined;
  return { providerName: first, providerKey: second, signal: third };
}
