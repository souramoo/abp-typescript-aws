import { IAmbientScopeProvider, Transient, optionsToken, type IOptions } from "@abp/core";
import { randomUUID } from "node:crypto";
import { CorrelationIdAmbientKey, type AbpHttpContext } from "../http-context.js";
import { AbpMiddlewareBase, type RequestDelegate } from "./pipeline.js";

/** Port of `AbpCorrelationIdOptions`. */
export class AbpCorrelationIdOptions {
  httpHeaderName = "X-Correlation-Id";
  setResponseHeader = true;
}

/**
 * Port of `AbpCorrelationIdMiddleware`. The id is stored in the ambient slot `Abp.Tracing.CorrelationId`, the
 * same one `@abp/event-bus`'s `DefaultCorrelationIdProvider` reads, without a package dependency.
 */
@Transient()
export class AbpCorrelationIdMiddleware extends AbpMiddlewareBase {
  static readonly inject = [optionsToken(AbpCorrelationIdOptions), IAmbientScopeProvider] as const;
  private readonly options: AbpCorrelationIdOptions;

  constructor(
    options: IOptions<AbpCorrelationIdOptions>,
    private readonly ambientScopeProvider: IAmbientScopeProvider<string>,
  ) {
    super();
    this.options = options.value;
  }

  override async invoke(context: AbpHttpContext, next: RequestDelegate): Promise<void> {
    const correlationId = this.getCorrelationIdFromRequest(context);
    context.correlationId = correlationId;
    this.checkAndSetCorrelationIdOnResponse(context, correlationId);
    await this.ambientScopeProvider.run(CorrelationIdAmbientKey, correlationId, () => next(context));
  }

  protected getCorrelationIdFromRequest(context: AbpHttpContext): string {
    let correlationId = context.request.headers.get(this.options.httpHeaderName);
    if (!correlationId) {
      correlationId = randomUUID().replace(/-/g, "");
      context.request.headers.set(this.options.httpHeaderName, correlationId);
    }
    return correlationId;
  }

  protected checkAndSetCorrelationIdOnResponse(context: AbpHttpContext, correlationId: string): void {
    if (!this.options.setResponseHeader) return;
    context.response.headers.tryAdd(this.options.httpHeaderName, correlationId);
  }
}
