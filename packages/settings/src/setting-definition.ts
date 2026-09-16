import { Check, FixedLocalizableString, addIfNotContains, createClassMarker, type AbstractClass, type ILocalizableString } from "@abp/core";

/** Port of `SettingDefinition`. */
export class SettingDefinition {
  readonly name: string;
  private displayNameValue!: ILocalizableString;
  description: ILocalizableString | undefined;
  defaultValue: string | undefined;
  /** Can clients see this setting and its value. Default: false. */
  isVisibleToClients: boolean;
  /** Allowed providers to get/set the value; empty means all providers. */
  readonly providers: string[] = [];
  /** Is this setting inherited from parent scopes. Default: true. */
  isInherited: boolean;
  readonly properties = new Map<string, unknown>();
  /** Is this setting stored encrypted in the data source. Default: false. */
  isEncrypted: boolean;

  constructor(name: string, defaultValue?: string, displayName?: ILocalizableString, description?: ILocalizableString, isVisibleToClients = false, isInherited = true, isEncrypted = false) {
    this.name = Check.notNull(name, "name");
    this.defaultValue = defaultValue;
    this.isVisibleToClients = isVisibleToClients;
    this.displayName = displayName ?? new FixedLocalizableString(name);
    this.description = description;
    this.isInherited = isInherited;
    this.isEncrypted = isEncrypted;
  }

  get displayName(): ILocalizableString {
    return this.displayNameValue;
  }
  set displayName(value: ILocalizableString) {
    this.displayNameValue = Check.notNull(value, "value");
  }

  withProperty(key: string, value: unknown): this {
    this.properties.set(key, value);
    return this;
  }

  withProviders(...providers: string[]): this {
    addIfNotContains(this.providers, ...providers);
    return this;
  }
}

/** Port of `ISettingDefinitionContext`. */
export interface ISettingDefinitionContext {
  getOrNull(name: string): SettingDefinition | undefined;
  getAll(): readonly SettingDefinition[];
  add(...definitions: SettingDefinition[]): void;
}

/** Port of `SettingDefinitionContext`. */
export class SettingDefinitionContext implements ISettingDefinitionContext {
  constructor(protected readonly settings: Map<string, SettingDefinition>) {}

  getOrNull(name: string): SettingDefinition | undefined {
    return this.settings.get(name);
  }

  getAll(): readonly SettingDefinition[] {
    return [...this.settings.values()];
  }

  add(...definitions: SettingDefinition[]): void {
    for (const definition of definitions) this.settings.set(definition.name, definition);
  }
}

/**
 * Port of `ISettingDefinitionProvider`. Implementations are discovered by the `ISettingDefinitionProvider` class
 * marker (subclasses of `SettingDefinitionProvider` carry it automatically; other classes use
 * `@ISettingDefinitionProvider()`) and added to `AbpSettingOptions.definitionProviders`.
 */
export interface ISettingDefinitionProvider {
  define(context: ISettingDefinitionContext): void;
}
export const ISettingDefinitionProvider = createClassMarker("ISettingDefinitionProvider");

/** Port of `SettingDefinitionProvider`. Concrete subclasses need their own `@Transient()`. */
export abstract class SettingDefinitionProvider implements ISettingDefinitionProvider {
  abstract define(context: ISettingDefinitionContext): void;
}
ISettingDefinitionProvider.mark(SettingDefinitionProvider as AbstractClass);
