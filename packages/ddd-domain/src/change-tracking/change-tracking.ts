import { AbpInterceptor, IAmbientScopeProvider, Singleton, Transient, createMethodMetadata, createToken, getMethodNames, type Class, type IAbpMethodInvocation, type IOnServiceRegisteredContext } from "@abp/core";

const AmbientKey = "Abp.Domain.EntityChangeTracking";

/** Port of `IEntityChangeTrackingProvider`. */
export interface IEntityChangeTrackingProvider {
  readonly enabled: boolean | undefined;
  /** Disposable style (`using`). */
  change(enabled: boolean | undefined): Disposable;
  /** Callback style: the value applies only inside `fn`. */
  run<R>(enabled: boolean | undefined, fn: () => R): R;
}
export const IEntityChangeTrackingProvider = createToken<IEntityChangeTrackingProvider>("IEntityChangeTrackingProvider");

/** Port of `EntityChangeTrackingProvider` on top of `AmbientScopeProvider` instead of `AsyncLocal`. */
@Singleton(IEntityChangeTrackingProvider)
export class EntityChangeTrackingProvider implements IEntityChangeTrackingProvider {
  static readonly inject = [IAmbientScopeProvider] as const;

  constructor(private readonly ambientScopeProvider: IAmbientScopeProvider<boolean | undefined>) {}

  get enabled(): boolean | undefined {
    return this.ambientScopeProvider.getValue(AmbientKey);
  }

  change(enabled: boolean | undefined): Disposable {
    return this.ambientScopeProvider.beginScope(AmbientKey, enabled);
  }

  run<R>(enabled: boolean | undefined, fn: () => R): R {
    return this.ambientScopeProvider.run(AmbientKey, enabled, fn);
  }
}

/** Metadata store behind `@EnableEntityChangeTracking()` / `@DisableEntityChangeTracking()` (port of `EntityChangeTrackingAttribute`). */
export const EntityChangeTrackingMetadata = createMethodMetadata<boolean>("EntityChangeTracking");

type ClassOrMethodDecorator = (target: object, propertyKey?: string | symbol, descriptor?: PropertyDescriptor) => void;

function entityChangeTrackingDecorator(isEnabled: boolean): ClassOrMethodDecorator {
  return (target, propertyKey) => {
    if (propertyKey === undefined) EntityChangeTrackingMetadata.setForClass(target as Class, isEnabled);
    else EntityChangeTrackingMetadata(isEnabled)(target, propertyKey);
  };
}

/** Port of `[EnableEntityChangeTracking]` on a method or class. */
export function EnableEntityChangeTracking(): ClassOrMethodDecorator {
  return entityChangeTrackingDecorator(true);
}

/** Port of `[DisableEntityChangeTracking]` on a method or class. */
export function DisableEntityChangeTracking(): ClassOrMethodDecorator {
  return entityChangeTrackingDecorator(false);
}

/** Port of `ChangeTrackingHelper`. */
export const ChangeTrackingHelper = {
  isEntityChangeTrackingType(implementationType: Class): boolean {
    if (EntityChangeTrackingMetadata.getForClass(implementationType) !== undefined) return true;
    return getMethodNames(implementationType).some((m) => EntityChangeTrackingMetadata.get(implementationType, m) !== undefined);
  },
  /** The attribute of the method, or of its class, or undefined. */
  getEntityChangeTrackingOrNull(type: Class, method: string): boolean | undefined {
    return EntityChangeTrackingMetadata.get(type, method) ?? EntityChangeTrackingMetadata.getForClass(type);
  },
};

/** Port of `ChangeTrackingInterceptor`. */
@Transient()
export class ChangeTrackingInterceptor extends AbpInterceptor {
  static readonly inject = [IEntityChangeTrackingProvider] as const;

  constructor(private readonly entityChangeTrackingProvider: IEntityChangeTrackingProvider) {
    super();
  }

  async intercept(invocation: IAbpMethodInvocation): Promise<void> {
    const isEnabled = ChangeTrackingHelper.getEntityChangeTrackingOrNull(invocation.targetType, invocation.method);
    if (isEnabled === undefined) {
      await invocation.proceed();
      return;
    }
    await this.entityChangeTrackingProvider.run(isEnabled, () => invocation.proceed());
  }
}

/** Port of `ChangeTrackingInterceptorRegistrar`. */
export const ChangeTrackingInterceptorRegistrar = {
  registerIfNeeded(context: IOnServiceRegisteredContext): void {
    if (ChangeTrackingHelper.isEntityChangeTrackingType(context.implementationType)) context.interceptors.tryAdd(ChangeTrackingInterceptor);
  },
};
