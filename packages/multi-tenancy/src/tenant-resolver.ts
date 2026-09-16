import { Check, ILoggerFactory, IServiceProviderToken, Singleton, Transient, optionsToken, type ILogger, type IOptions, type IServiceProvider } from "@abp/core";
import { ICurrentUser } from "@abp/security";
import { AbpTenantResolveOptions, ITenantResolveResultAccessor, ITenantResolver, TenantResolveContext, TenantResolveContributorBase, TenantResolveResult, TenantResolverNames, type ITenantResolveContext } from "@abp/multi-tenancy-abstractions";

/** Port of `TenantResolver`: runs the `AbpTenantResolveOptions.tenantResolvers` chain inside a service scope. */
@Transient(ITenantResolver)
export class TenantResolver implements ITenantResolver {
  static readonly inject = [optionsToken(AbpTenantResolveOptions), IServiceProviderToken, ILoggerFactory] as const;
  protected readonly options: AbpTenantResolveOptions;
  protected readonly logger: ILogger;

  constructor(
    options: IOptions<AbpTenantResolveOptions>,
    protected readonly serviceProvider: IServiceProvider,
    loggerFactory: ILoggerFactory,
  ) {
    this.options = options.value;
    this.logger = loggerFactory.createLogger(TenantResolver.name);
  }

  async resolveTenantIdOrName(): Promise<TenantResolveResult> {
    const result = new TenantResolveResult();
    this.logger.debug("Starting resolving tenant...");

    const scope = this.serviceProvider.createScope();
    try {
      const context = new TenantResolveContext(scope.serviceProvider);
      for (const tenantResolver of this.options.tenantResolvers) {
        this.logger.debug(`Trying to resolve tenant through '${tenantResolver.name}'...`);
        await tenantResolver.resolve(context);
        result.appliedResolvers.push(tenantResolver.name);
        if (context.hasResolvedTenantOrHost()) {
          result.tenantIdOrName = context.tenantIdOrName;
          this.logger.debug(`Tenant resolved by '${tenantResolver.name}' as '${result.tenantIdOrName ?? "Host"}'.`);
          break;
        }
      }
    } finally {
      await scope.dispose();
    }

    if (!result.tenantIdOrName && this.options.fallbackTenant?.trim()) {
      result.tenantIdOrName = this.options.fallbackTenant;
      result.appliedResolvers.push(TenantResolverNames.fallbackTenant);
      this.logger.debug(`No tenant resolved. Using fallback tenant as '${result.tenantIdOrName}'.`);
    } else if (!result.tenantIdOrName) {
      this.logger.debug("No tenant resolved.");
    }

    return result;
  }
}

/** Port of `ActionTenantResolveContributor`. */
export class ActionTenantResolveContributor extends TenantResolveContributorBase {
  static readonly ContributorName = "Action";
  readonly name = ActionTenantResolveContributor.ContributorName;

  constructor(private readonly resolveAction: (context: ITenantResolveContext) => void | Promise<void>) {
    super();
    Check.notNull(resolveAction, "resolveAction");
  }

  async resolve(context: ITenantResolveContext): Promise<void> {
    await this.resolveAction(context);
  }
}

/** Port of `CurrentUserTenantResolveContributor`: an authenticated user's tenant claim decides the tenant (or host). */
export class CurrentUserTenantResolveContributor extends TenantResolveContributorBase {
  static readonly ContributorName = "CurrentUser";
  readonly name = CurrentUserTenantResolveContributor.ContributorName;

  async resolve(context: ITenantResolveContext): Promise<void> {
    const currentUser = context.serviceProvider.getRequired(ICurrentUser);
    if (currentUser.isAuthenticated) {
      context.handled = true;
      context.tenantIdOrName = currentUser.tenantId;
    }
  }
}

/** Port of `NullTenantResolveResultAccessor` (HTTP adapters replace it with a request-scoped accessor). */
@Singleton(ITenantResolveResultAccessor)
export class NullTenantResolveResultAccessor implements ITenantResolveResultAccessor {
  get result(): TenantResolveResult | undefined {
    return undefined;
  }
  set result(_value: TenantResolveResult | undefined) {}
}
