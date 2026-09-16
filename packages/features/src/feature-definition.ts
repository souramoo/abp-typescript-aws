import { AbpException, Check, FixedLocalizableString, createClassMarker, type AbstractClass, type ILocalizableString } from "@abp/core";
import { ToggleStringValueType, type IStringValueType } from "@abp/validation";

/** The optional arguments of `FeatureDefinition` / `AddFeature` / `CreateChild` (positional in .NET). */
export interface FeatureDefinitionInit {
  defaultValue?: string;
  displayName?: ILocalizableString;
  description?: ILocalizableString;
  /** Default: `ToggleStringValueType`. */
  valueType?: IStringValueType;
  /** Default: true. */
  isVisibleToClients?: boolean;
  /** Default: true. */
  isAvailableToHost?: boolean;
}

/** Port of `ICanCreateChildFeature`. */
export interface ICanCreateChildFeature {
  createChildFeature(name: string, init?: FeatureDefinitionInit): FeatureDefinition;
}

/** Port of `FeatureDefinition`. The `this[name]` indexer becomes `properties.get/set`. */
export class FeatureDefinition implements ICanCreateChildFeature {
  readonly name: string;
  private displayNameValue!: ILocalizableString;
  description: ILocalizableString | undefined;
  private parentDefinition: FeatureDefinition | undefined;
  private readonly childList: FeatureDefinition[] = [];
  defaultValue: string | undefined;
  isVisibleToClients: boolean;
  isAvailableToHost: boolean;
  readonly allowedProviders: string[] = [];
  readonly properties = new Map<string, unknown>();
  valueType: IStringValueType;

  constructor(name: string, init: FeatureDefinitionInit = {}) {
    this.name = Check.notNullOrWhiteSpace(name, "name");
    this.defaultValue = init.defaultValue;
    this.displayName = init.displayName ?? new FixedLocalizableString(name);
    this.description = init.description;
    this.valueType = init.valueType ?? new ToggleStringValueType();
    this.isVisibleToClients = init.isVisibleToClients ?? true;
    this.isAvailableToHost = init.isAvailableToHost ?? true;
  }

  get displayName(): ILocalizableString {
    return this.displayNameValue;
  }
  set displayName(value: ILocalizableString) {
    this.displayNameValue = Check.notNull(value, "value");
  }

  /** Parent of this feature, if one exists. If set, this feature can be enabled only if the parent is enabled. */
  get parent(): FeatureDefinition | undefined {
    return this.parentDefinition;
  }

  get children(): readonly FeatureDefinition[] {
    return [...this.childList];
  }

  withProperty(key: string, value: unknown): this {
    this.properties.set(key, value);
    return this;
  }

  withProviders(...providers: string[]): this {
    this.allowedProviders.push(...providers);
    return this;
  }

  createChild(name: string, init: FeatureDefinitionInit = {}): FeatureDefinition {
    const feature = new FeatureDefinition(name, init);
    feature.parentDefinition = this;
    this.childList.push(feature);
    return feature;
  }

  createChildFeature(name: string, init?: FeatureDefinitionInit): FeatureDefinition {
    return this.createChild(name, init);
  }

  removeChild(name: string): void {
    const index = this.childList.findIndex((f) => f.name === name);
    if (index < 0) throw new AbpException(`Could not find a feature named '${name}' in the Children of this feature '${this.name}'.`);
    this.childList[index]!.parentDefinition = undefined;
    this.childList.splice(index, 1);
  }

  toString(): string {
    return `[FeatureDefinition: ${this.name}]`;
  }
}

/** Port of `FeatureGroupDefinition`. */
export class FeatureGroupDefinition implements ICanCreateChildFeature {
  readonly properties = new Map<string, unknown>();
  private displayNameValue!: ILocalizableString;
  private readonly featureList: FeatureDefinition[] = [];

  constructor(
    readonly name: string,
    displayName?: ILocalizableString,
  ) {
    this.displayName = displayName ?? new FixedLocalizableString(name);
  }

  get displayName(): ILocalizableString {
    return this.displayNameValue;
  }
  set displayName(value: ILocalizableString) {
    this.displayNameValue = Check.notNull(value, "value");
  }

  get features(): readonly FeatureDefinition[] {
    return [...this.featureList];
  }

  addFeature(name: string, init?: FeatureDefinitionInit): FeatureDefinition {
    const feature = new FeatureDefinition(name, init);
    this.featureList.push(feature);
    return feature;
  }

  createChildFeature(name: string, init?: FeatureDefinitionInit): FeatureDefinition {
    return this.addFeature(name, init);
  }

  getFeaturesWithChildren(): FeatureDefinition[] {
    const features: FeatureDefinition[] = [];
    for (const feature of this.featureList) addFeatureRecursively(features, feature);
    return features;
  }

  withProperty(key: string, value: unknown): this {
    this.properties.set(key, value);
    return this;
  }

  toString(): string {
    return `[FeatureGroupDefinition ${this.name}]`;
  }
}

function addFeatureRecursively(into: FeatureDefinition[], feature: FeatureDefinition): void {
  into.push(feature);
  for (const child of feature.children) addFeatureRecursively(into, child);
}

/** Port of `IFeatureDefinitionContext`. */
export interface IFeatureDefinitionContext {
  addGroup(name: string, displayName?: ILocalizableString): FeatureGroupDefinition;
  getGroupOrNull(name: string): FeatureGroupDefinition | undefined;
  removeGroup(name: string): void;
}

/** Port of `FeatureDefinitionContext`. */
export class FeatureDefinitionContext implements IFeatureDefinitionContext {
  readonly groups = new Map<string, FeatureGroupDefinition>();

  addGroup(name: string, displayName?: ILocalizableString): FeatureGroupDefinition {
    Check.notNull(name, "name");
    if (this.groups.has(name)) throw new AbpException(`There is already an existing feature group with name: ${name}`);
    const group = new FeatureGroupDefinition(name, displayName);
    this.groups.set(name, group);
    return group;
  }

  getGroupOrNull(name: string): FeatureGroupDefinition | undefined {
    return this.groups.get(Check.notNull(name, "name"));
  }

  removeGroup(name: string): void {
    Check.notNull(name, "name");
    if (!this.groups.delete(name)) throw new AbpException(`Undefined feature group: '${name}'.`);
  }
}

/**
 * Port of `IFeatureDefinitionProvider`. Implementations are discovered by the `IFeatureDefinitionProvider` class
 * marker (subclasses of `FeatureDefinitionProvider` carry it automatically; other classes use
 * `@IFeatureDefinitionProvider()`) and added to `AbpFeatureOptions.definitionProviders`.
 */
export interface IFeatureDefinitionProvider {
  define(context: IFeatureDefinitionContext): void;
}
export const IFeatureDefinitionProvider = createClassMarker("IFeatureDefinitionProvider");

/** Port of `FeatureDefinitionProvider`. Concrete subclasses need their own `@Transient()`. */
export abstract class FeatureDefinitionProvider implements IFeatureDefinitionProvider {
  abstract define(context: IFeatureDefinitionContext): void;
}
IFeatureDefinitionProvider.mark(FeatureDefinitionProvider as AbstractClass);
