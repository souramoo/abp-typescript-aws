import { AbpException, Check, type AbstractClass, type Class } from "@abp/core";

const featureNames = new WeakMap<AbstractClass, string>();

/** Port of `[GlobalFeatureName("X")]` on a `GlobalFeature` class. */
export function GlobalFeatureName(name: string) {
  Check.notNullOrWhiteSpace(name, "name");
  return (target: AbstractClass): void => {
    featureNames.set(target, name);
  };
}

/** Port of `GlobalFeatureNameAttribute.GetName(type)`. */
export function getGlobalFeatureName(type: AbstractClass): string {
  let current: unknown = Check.notNull(type, "type");
  while (typeof current === "function" && current !== Function.prototype) {
    const name = featureNames.get(current as AbstractClass);
    if (name !== undefined) return name;
    current = Object.getPrototypeOf(current);
  }
  throw new AbpException(`${type.name} should define the GlobalFeatureName attribute!`);
}

export type GlobalFeatureRef = string | AbstractClass;

function nameOf(feature: GlobalFeatureRef): string {
  return typeof feature === "string" ? feature : getGlobalFeatureName(feature);
}

/** Port of `GlobalFeatureManager`: process-wide singleton of enabled global (compile-time) features. */
export class GlobalFeatureManager {
  private static current: GlobalFeatureManager | undefined;

  static get instance(): GlobalFeatureManager {
    GlobalFeatureManager.current ??= new GlobalFeatureManager();
    return GlobalFeatureManager.current;
  }
  static set instance(value: GlobalFeatureManager) {
    GlobalFeatureManager.current = value;
  }

  /** A common dictionary to store arbitrary configurations. */
  readonly configuration = new Map<unknown, unknown>();
  readonly modules: GlobalModuleFeaturesDictionary;
  protected readonly enabledFeatures = new Set<string>();

  constructor() {
    this.modules = new GlobalModuleFeaturesDictionary(this);
  }

  isEnabled(feature: GlobalFeatureRef): boolean {
    return this.enabledFeatures.has(nameOf(feature));
  }

  enable(feature: GlobalFeatureRef): void {
    this.enabledFeatures.add(nameOf(feature));
  }

  disable(feature: GlobalFeatureRef): void {
    this.enabledFeatures.delete(nameOf(feature));
  }

  getEnabledFeatureNames(): string[] {
    return [...this.enabledFeatures];
  }
}

/** A `GlobalModuleFeatures` class with its module name (`static readonly moduleName`, falling back to the class name). */
export type GlobalModuleFeaturesClass<T extends GlobalModuleFeatures = GlobalModuleFeatures> = (new (featureManager: GlobalFeatureManager) => T) & { readonly moduleName?: string };

/**
 * Port of `GlobalModuleFeaturesDictionary`. .NET modules add extension methods such as `Modules.CmsKit()`; here
 * `configure(MyModuleFeatures, f => ...)` / `get(MyModuleFeatures)` create the module features on demand.
 */
export class GlobalModuleFeaturesDictionary extends Map<string, GlobalModuleFeatures> {
  constructor(readonly featureManager: GlobalFeatureManager) {
    super();
  }

  getOrAdd<T extends GlobalModuleFeatures>(name: string, factory: () => T): T {
    const existing = this.get(name);
    if (existing) return existing as T;
    const created = factory();
    this.set(name, created);
    return created;
  }

  getOrAddType<T extends GlobalModuleFeatures>(type: GlobalModuleFeaturesClass<T>): T {
    return this.getOrAdd(type.moduleName ?? type.name, () => new type(this.featureManager));
  }

  configure<T extends GlobalModuleFeatures>(type: GlobalModuleFeaturesClass<T>, action: (features: T) => void): this {
    action(this.getOrAddType(type));
    return this;
  }
}

/** Port of `GlobalFeatureDictionary`. */
export class GlobalFeatureDictionary extends Map<string, GlobalFeature> {}

/** Port of `GlobalModuleFeatures`: the features of one module; subclasses call `addFeature` in their constructor. */
export abstract class GlobalModuleFeatures {
  readonly featureManager: GlobalFeatureManager;
  protected readonly allFeatures = new GlobalFeatureDictionary();

  constructor(featureManager: GlobalFeatureManager) {
    this.featureManager = Check.notNull(featureManager, "featureManager");
  }

  enable(feature: GlobalFeatureRef): void {
    this.getFeature(feature).enable();
  }

  disable(feature: GlobalFeatureRef): void {
    this.getFeature(feature).disable();
  }

  setEnabled(feature: GlobalFeatureRef, isEnabled: boolean): void {
    this.getFeature(feature).setEnabled(isEnabled);
  }

  enableAll(): void {
    for (const feature of this.allFeatures.values()) feature.enable();
  }

  disableAll(): void {
    for (const feature of this.allFeatures.values()) feature.disable();
  }

  getFeature(feature: string): GlobalFeature;
  getFeature<T extends GlobalFeature>(feature: Class<T>): T;
  getFeature(feature: GlobalFeatureRef): GlobalFeature;
  getFeature(feature: GlobalFeatureRef): GlobalFeature {
    const name = nameOf(feature);
    const found = this.allFeatures.get(name);
    if (!found) throw new AbpException(`There is no feature defined by name '${name}'.`);
    return found;
  }

  getFeatures(): readonly GlobalFeature[] {
    return [...this.allFeatures.values()];
  }

  protected addFeature(feature: GlobalFeature): void {
    this.allFeatures.set(feature.featureName, feature);
  }
}

/** Port of `GlobalFeature`: subclasses are decorated with `@GlobalFeatureName("Module.Feature")`. */
export abstract class GlobalFeature {
  readonly module: GlobalModuleFeatures;
  readonly featureManager: GlobalFeatureManager;
  readonly featureName: string;

  constructor(module: GlobalModuleFeatures) {
    this.module = Check.notNull(module, "module");
    this.featureManager = module.featureManager;
    this.featureName = getGlobalFeatureName(this.constructor as AbstractClass);
  }

  get isEnabled(): boolean {
    return this.featureManager.isEnabled(this.featureName);
  }
  set isEnabled(value: boolean) {
    this.setEnabled(value);
  }

  enable(): void {
    this.featureManager.enable(this.featureName);
  }

  disable(): void {
    this.featureManager.disable(this.featureName);
  }

  setEnabled(isEnabled: boolean): void {
    if (isEnabled) this.enable();
    else this.disable();
  }
}
