import { AbpAmbientKeys, AbpException, AmbientScopeProvider, IAmbientScopeProvider, Singleton, Transient, createToken, type Guid } from "@abp/core";
import { BasicTenantInfo } from "./basic-tenant-info.js";
import { MultiTenancySides } from "./multi-tenancy-consts.js";

/** Port of `ICurrentTenant`. */
export interface ICurrentTenant {
  readonly isAvailable: boolean;
  readonly id: Guid | undefined;
  readonly name: string | undefined;
  /** Disposable style (`using`): the tenant stays current for the rest of the async flow until disposed. */
  change(id: Guid | null | undefined, name?: string | null): Disposable;
  /** Callback style: the tenant is current only inside `fn` (safe across `await` boundaries). */
  run<R>(id: Guid | null | undefined, name: string | null | undefined, fn: () => R): R;
}
export const ICurrentTenant = createToken<ICurrentTenant>("ICurrentTenant");

/**
 * Port of `ICurrentTenantAccessor`. A `current` of undefined means nothing was set explicitly;
 * a `BasicTenantInfo` with undefined `tenantId` means the host was set explicitly.
 * `run` is an addition so `ICurrentTenant.run` can fork the ambient context.
 */
export interface ICurrentTenantAccessor {
  current: BasicTenantInfo | undefined;
  run<R>(current: BasicTenantInfo | undefined, fn: () => R): R;
}
export const ICurrentTenantAccessor = createToken<ICurrentTenantAccessor>("ICurrentTenantAccessor");

/** Port of `AsyncLocalCurrentTenantAccessor` on top of `AmbientScopeProvider` (`AbpAmbientKeys.currentTenant`). */
@Singleton(ICurrentTenantAccessor)
export class AsyncLocalCurrentTenantAccessor implements ICurrentTenantAccessor {
  static readonly inject = [IAmbientScopeProvider] as const;
  static readonly instance = new AsyncLocalCurrentTenantAccessor(new AmbientScopeProvider<BasicTenantInfo>());

  constructor(private readonly ambientScopeProvider: IAmbientScopeProvider<BasicTenantInfo>) {}

  get current(): BasicTenantInfo | undefined {
    return this.ambientScopeProvider.getValue(AbpAmbientKeys.currentTenant);
  }

  set current(value: BasicTenantInfo | undefined) {
    this.ambientScopeProvider.beginScope(AbpAmbientKeys.currentTenant, value);
  }

  run<R>(current: BasicTenantInfo | undefined, fn: () => R): R {
    return this.ambientScopeProvider.run(AbpAmbientKeys.currentTenant, current, fn);
  }
}

/** Port of `CurrentTenant`. */
@Transient(ICurrentTenant)
export class CurrentTenant implements ICurrentTenant {
  static readonly inject = [ICurrentTenantAccessor] as const;

  constructor(private readonly currentTenantAccessor: ICurrentTenantAccessor) {}

  get isAvailable(): boolean {
    return this.id !== undefined;
  }

  get id(): Guid | undefined {
    return this.currentTenantAccessor.current?.tenantId;
  }

  get name(): string | undefined {
    return this.currentTenantAccessor.current?.name;
  }

  change(id: Guid | null | undefined, name?: string | null): Disposable {
    const parentScope = this.currentTenantAccessor.current;
    this.currentTenantAccessor.current = new BasicTenantInfo(id ?? undefined, name ?? undefined);
    let disposed = false;
    return {
      [Symbol.dispose]: () => {
        if (disposed) return;
        disposed = true;
        this.currentTenantAccessor.current = parentScope;
      },
    };
  }

  run<R>(id: Guid | null | undefined, name: string | null | undefined, fn: () => R): R {
    return this.currentTenantAccessor.run(new BasicTenantInfo(id ?? undefined, name ?? undefined), fn);
  }
}

/* Port of `CurrentTenantExtensions`. */

export function getCurrentTenantId(currentTenant: ICurrentTenant): Guid {
  if (currentTenant.id === undefined) throw new AbpException("Current Tenant Id is not available!");
  return currentTenant.id;
}

export function getMultiTenancySide(currentTenant: ICurrentTenant): MultiTenancySides {
  return currentTenant.id !== undefined ? MultiTenancySides.Tenant : MultiTenancySides.Host;
}
