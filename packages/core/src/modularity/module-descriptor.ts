import { AbpException } from "../exception-handling/exceptions.js";
import { type AbpModule, type ModuleClass, getDependedModules, isAbpModule } from "./abp-module.js";

/** Port of `IAbpModuleDescriptor`. */
export interface IAbpModuleDescriptor {
  readonly type: ModuleClass;
  readonly instance: AbpModule;
  readonly dependencies: readonly IAbpModuleDescriptor[];
  readonly isLoadedAsPlugIn: boolean;
}

export class AbpModuleDescriptor implements IAbpModuleDescriptor {
  private readonly deps: IAbpModuleDescriptor[] = [];
  constructor(
    readonly type: ModuleClass,
    readonly instance: AbpModule,
    readonly isLoadedAsPlugIn = false,
  ) {}
  get dependencies(): readonly IAbpModuleDescriptor[] {
    return this.deps;
  }
  addDependency(descriptor: IAbpModuleDescriptor): void {
    if (!this.deps.includes(descriptor)) this.deps.push(descriptor);
  }
}

/**
 * Port of `ModuleLoader`: discovers the module graph from the startup module and returns
 * it sorted so that every module comes after all of its dependencies.
 */
export class ModuleLoader {
  loadModules(startupModuleType: ModuleClass, plugInModules: readonly ModuleClass[] = []): readonly IAbpModuleDescriptor[] {
    if (!isAbpModule(startupModuleType)) throw new AbpException(`Given type is not an ABP module: ${describeType(startupModuleType)}`);
    const descriptors = new Map<ModuleClass, AbpModuleDescriptor>();
    this.fill(startupModuleType, descriptors, false);
    for (const plugIn of plugInModules) this.fill(plugIn, descriptors, true);
    for (const d of descriptors.values()) {
      for (const dep of getDependedModules(d.type)) d.addDependency(descriptors.get(dep)!);
    }
    return this.sortByDependency([...descriptors.values()], descriptors.get(startupModuleType)!);
  }

  private fill(type: ModuleClass, into: Map<ModuleClass, AbpModuleDescriptor>, plugIn: boolean): void {
    if (into.has(type)) return;
    if (!isAbpModule(type)) throw new AbpException(`Given type is not an ABP module: ${describeType(type)}`);
    into.set(type, new AbpModuleDescriptor(type, new type(), plugIn));
    for (const dep of getDependedModules(type)) this.fill(dep, into, plugIn);
  }

  private sortByDependency(all: AbpModuleDescriptor[], startup: AbpModuleDescriptor): IAbpModuleDescriptor[] {
    const sorted: IAbpModuleDescriptor[] = [];
    const visiting = new Set<IAbpModuleDescriptor>();
    const visited = new Set<IAbpModuleDescriptor>();
    const visit = (d: IAbpModuleDescriptor, path: string[]) => {
      if (visited.has(d)) return;
      if (visiting.has(d)) throw new AbpException(`Circular module dependency: ${[...path, d.type.name].join(" -> ")}`);
      visiting.add(d);
      for (const dep of d.dependencies) visit(dep, [...path, d.type.name]);
      visiting.delete(d);
      visited.add(d);
      sorted.push(d);
    };
    for (const d of all) visit(d, []);
    // Startup module must be last (ABP: MoveItem(startupModule, list.Count - 1)).
    const idx = sorted.indexOf(startup);
    if (idx >= 0 && idx !== sorted.length - 1) {
      sorted.splice(idx, 1);
      sorted.push(startup);
    }
    return sorted;
  }
}

function describeType(type: unknown): string {
  return typeof type === "function" ? type.name : String(type);
}
