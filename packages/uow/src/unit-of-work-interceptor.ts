import { AbpInterceptor, IRootServiceProvider, Singleton, Transient, createToken, optionsToken, type IAbpMethodInvocation, type IOnServiceRegisteredContext, type IServiceProvider } from "@abp/core";
import { IAmbientUnitOfWork } from "./ambient-unit-of-work.js";
import { AbpUnitOfWorkDefaultOptions, AbpUnitOfWorkOptions } from "./options.js";
import { UnitOfWorkReservationName } from "./unit-of-work.js";
import { UnitOfWorkHelper, applyUnitOfWorkAttribute, type UnitOfWorkAttributeOptions } from "./unit-of-work-attribute.js";
import { IUnitOfWorkManager } from "./unit-of-work-manager.js";

/** Port of `IUnitOfWorkTransactionBehaviourProvider`. */
export interface IUnitOfWorkTransactionBehaviourProvider {
  readonly isTransactional: boolean | undefined;
}
export const IUnitOfWorkTransactionBehaviourProvider = createToken<IUnitOfWorkTransactionBehaviourProvider>("IUnitOfWorkTransactionBehaviourProvider");

@Singleton(IUnitOfWorkTransactionBehaviourProvider)
export class NullUnitOfWorkTransactionBehaviourProvider implements IUnitOfWorkTransactionBehaviourProvider {
  readonly isTransactional = undefined;
}

/**
 * Port of `UnitOfWorkInterceptor`. The intercepted call runs in a forked ambient context so the
 * unit of work it begins never leaks to the caller's async flow.
 */
@Transient()
export class UnitOfWorkInterceptor extends AbpInterceptor {
  static readonly inject = [IRootServiceProvider, IAmbientUnitOfWork] as const;

  constructor(
    private readonly rootServiceProvider: IServiceProvider,
    private readonly ambientUnitOfWork: IAmbientUnitOfWork,
  ) {
    super();
  }

  async intercept(invocation: IAbpMethodInvocation): Promise<void> {
    const { isUnitOfWork, attribute } = UnitOfWorkHelper.isUnitOfWorkMethod(invocation.targetType, invocation.method);
    if (!isUnitOfWork) {
      await invocation.proceed();
      return;
    }

    await this.ambientUnitOfWork.fork(async () => {
      const scope = this.rootServiceProvider.createScope();
      try {
        const options = this.createOptions(scope.serviceProvider, invocation, attribute);
        const unitOfWorkManager = scope.serviceProvider.getRequired(IUnitOfWorkManager);

        if (unitOfWorkManager.tryBeginReserved(UnitOfWorkReservationName, options)) {
          await invocation.proceed();
          await unitOfWorkManager.current?.saveChanges();
          return;
        }

        const uow = unitOfWorkManager.begin(options);
        try {
          await invocation.proceed();
          await uow.complete();
        } finally {
          await uow.dispose();
        }
      } finally {
        await scope.dispose();
      }
    });
  }

  private createOptions(serviceProvider: IServiceProvider, invocation: IAbpMethodInvocation, attribute: UnitOfWorkAttributeOptions | undefined): AbpUnitOfWorkOptions {
    const options = new AbpUnitOfWorkOptions();
    if (attribute) applyUnitOfWorkAttribute(attribute, options);

    if (attribute?.isTransactional === undefined) {
      const defaultOptions = serviceProvider.getRequired(optionsToken(AbpUnitOfWorkDefaultOptions)).value;
      const behaviourProvider = serviceProvider.get(IUnitOfWorkTransactionBehaviourProvider);
      options.isTransactional = defaultOptions.calculateIsTransactional(behaviourProvider?.isTransactional ?? !invocation.method.toLowerCase().startsWith("get"));
    }
    return options;
  }
}

/** Port of `UnitOfWorkInterceptorRegistrar`. */
export const UnitOfWorkInterceptorRegistrar = {
  registerIfNeeded(context: IOnServiceRegisteredContext): void {
    if (UnitOfWorkHelper.isUnitOfWorkType(context.implementationType)) context.interceptors.tryAdd(UnitOfWorkInterceptor);
  },
};
