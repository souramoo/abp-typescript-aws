import { AbpCrossCuttingConcerns, AbpInterceptor, AppliedCrossCuttingConcerns, IRootServiceProvider, Transient, forkAmbientScope, getMethodNames, type Class, type IAbpMethodInvocation, type IOnServiceRegisteredContext, type IServiceProvider } from "@abp/core";
import { ICurrentUser } from "@abp/security";
import { IUnitOfWorkManager } from "@abp/uow";
import { AbpAuditingOptions } from "./abp-auditing-options.js";
import type { AuditLogActionInfo, AuditLogInfo, IAuditLogScope } from "./audit-log-info.js";
import { IAuditingHelper, shouldAuditTypeByDefaultOrNull } from "./auditing-helper.js";
import { IAuditingManager } from "./auditing-manager.js";
import { AuditedMetadata } from "./contracts.js";

/**
 * Port of `AuditingInterceptor`. When it begins the audit scope itself, the intercepted call runs in a forked
 * ambient context so the scope never leaks to the caller's async flow.
 */
@Transient()
export class AuditingInterceptor extends AbpInterceptor {
  static readonly inject = [IRootServiceProvider] as const;

  constructor(private readonly rootServiceProvider: IServiceProvider) {
    super();
  }

  async intercept(invocation: IAbpMethodInvocation): Promise<void> {
    const serviceScope = this.rootServiceProvider.createScope();
    try {
      const auditingHelper = serviceScope.serviceProvider.getRequired(IAuditingHelper);
      const auditingOptions = serviceScope.serviceProvider.getOptions(AbpAuditingOptions);

      if (!this.shouldIntercept(invocation, auditingOptions, auditingHelper)) {
        await invocation.proceed();
        return;
      }

      const auditingManager = serviceScope.serviceProvider.getRequired(IAuditingManager);
      const current = auditingManager.current;
      if (current) {
        await proceedByLogging(invocation, auditingOptions, auditingHelper, current);
        return;
      }

      const currentUser = serviceScope.serviceProvider.getRequired(ICurrentUser);
      const unitOfWorkManager = serviceScope.serviceProvider.getRequired(IUnitOfWorkManager);
      await forkAmbientScope(() => this.processWithNewAuditingScope(invocation, auditingOptions, currentUser, auditingManager, auditingHelper, unitOfWorkManager));
    } finally {
      await serviceScope.dispose();
    }
  }

  protected shouldIntercept(invocation: IAbpMethodInvocation, options: AbpAuditingOptions, auditingHelper: IAuditingHelper): boolean {
    if (!options.isEnabled) return false;
    if (AppliedCrossCuttingConcerns.isApplied(invocation.targetObject, AbpCrossCuttingConcerns.Auditing)) return false;
    return auditingHelper.shouldSaveAudit(invocation.targetType, invocation.method, false, options.isEnabledForIntegrationServices);
  }

  private async processWithNewAuditingScope(invocation: IAbpMethodInvocation, options: AbpAuditingOptions, currentUser: ICurrentUser, auditingManager: IAuditingManager, auditingHelper: IAuditingHelper, unitOfWorkManager: IUnitOfWorkManager): Promise<void> {
    let hasError = false;
    const saveHandle = auditingManager.beginScope();
    try {
      const scope = auditingManager.current!;
      try {
        await proceedByLogging(invocation, options, auditingHelper, scope);
        if (scope.log.exceptions.length > 0) hasError = true;
      } catch (e) {
        hasError = true;
        throw e;
      } finally {
        if (await this.shouldWriteAuditLog(invocation, scope.log, options, currentUser, hasError)) {
          const currentUow = unitOfWorkManager.current;
          if (currentUow) {
            try {
              await currentUow.saveChanges();
            } catch (e) {
              if (!scope.log.exceptions.includes(e)) scope.log.exceptions.push(e);
            }
          }
          await saveHandle.save();
        }
      }
    } finally {
      saveHandle.dispose();
    }
  }

  private async shouldWriteAuditLog(invocation: IAbpMethodInvocation, auditLogInfo: AuditLogInfo, options: AbpAuditingOptions, currentUser: ICurrentUser, hasError: boolean): Promise<boolean> {
    for (const selector of options.alwaysLogSelectors) {
      if (await selector(auditLogInfo)) return true;
    }
    if (options.alwaysLogOnException && hasError) return true;
    if (!options.isEnabledForAnonymousUsers && !currentUser.isAuthenticated) return false;

    const httpMethod = auditLogInfo.httpMethod?.toLowerCase();
    if (!options.isEnabledForGetRequests && (httpMethod === "get" || httpMethod === "head" || httpMethod === "query" || invocation.method.toLowerCase().startsWith("get"))) return false;
    return true;
  }
}

async function proceedByLogging(invocation: IAbpMethodInvocation, options: AbpAuditingOptions, auditingHelper: IAuditingHelper, auditLogScope: IAuditLogScope): Promise<void> {
  const auditLog = auditLogScope.log;
  let auditLogAction: AuditLogActionInfo | undefined;
  if (!options.disableLogActionInfo) {
    auditLogAction = auditingHelper.createAuditLogAction(auditLog, invocation.targetType, invocation.method, invocation.args);
  }

  const startedAt = performance.now();
  try {
    await invocation.proceed();
  } catch (e) {
    auditLog.exceptions.push(e);
    throw e;
  } finally {
    if (auditLogAction) {
      auditLogAction.executionDuration = Math.round(performance.now() - startedAt);
      auditLog.actions.push(auditLogAction);
    }
  }
}

/** Port of `AuditingInterceptorRegistrar`. */
export const AuditingInterceptorRegistrar = {
  registerIfNeeded(context: IOnServiceRegisteredContext): void {
    if (AuditingInterceptorRegistrar.shouldIntercept(context.implementationType)) context.interceptors.tryAdd(AuditingInterceptor);
  },

  shouldIntercept(type: Class): boolean {
    if (shouldAuditTypeByDefaultOrNull(type, true) === true) return true;
    return getMethodNames(type).some((method) => AuditedMetadata.get(type, method) !== undefined);
  },

  shouldAuditTypeByDefaultOrNull,
};
