import { AbpAmbientKeys, IAmbientScopeProvider, Singleton, createToken } from "@abp/core";
import { Claim, ClaimsIdentity, ClaimsPrincipal } from "./claims.js";

/** Anything `ICurrentPrincipalAccessor.change` accepts (port of `CurrentPrincipalAccessorExtensions` overloads). */
export type PrincipalLike = ClaimsPrincipal | ClaimsIdentity | Claim | Iterable<Claim>;

export function toClaimsPrincipal(value: PrincipalLike): ClaimsPrincipal {
  if (value instanceof ClaimsPrincipal) return value;
  if (value instanceof ClaimsIdentity) return new ClaimsPrincipal(value);
  if (value instanceof Claim) return new ClaimsPrincipal(new ClaimsIdentity([value]));
  return new ClaimsPrincipal(new ClaimsIdentity(value));
}

/** Port of `ICurrentPrincipalAccessor`. */
export interface ICurrentPrincipalAccessor {
  readonly principal: ClaimsPrincipal;
  /** Disposable style (`using`): the principal stays current for the rest of the async flow until disposed. */
  change(principal: PrincipalLike): Disposable;
  /** Callback style: the principal is current only inside `fn` (safe across `await` boundaries). */
  run<R>(principal: PrincipalLike, fn: () => R): R;
}
export const ICurrentPrincipalAccessor = createToken<ICurrentPrincipalAccessor>("ICurrentPrincipalAccessor");

/** Port of `CurrentPrincipalAccessorBase` on top of `AmbientScopeProvider` instead of `AsyncLocal`. */
export abstract class CurrentPrincipalAccessorBase implements ICurrentPrincipalAccessor {
  constructor(protected readonly ambientScopeProvider: IAmbientScopeProvider<ClaimsPrincipal>) {}

  get principal(): ClaimsPrincipal {
    return this.ambientScopeProvider.getValue(AbpAmbientKeys.currentPrincipal) ?? this.getClaimsPrincipal();
  }

  protected abstract getClaimsPrincipal(): ClaimsPrincipal;

  change(principal: PrincipalLike): Disposable {
    return this.ambientScopeProvider.beginScope(AbpAmbientKeys.currentPrincipal, toClaimsPrincipal(principal));
  }

  run<R>(principal: PrincipalLike, fn: () => R): R {
    return this.ambientScopeProvider.run(AbpAmbientKeys.currentPrincipal, toClaimsPrincipal(principal), fn);
  }
}

/** Port of `ThreadCurrentPrincipalAccessor`: there is no `Thread.CurrentPrincipal`, so the fallback is an empty principal. */
@Singleton(ICurrentPrincipalAccessor)
export class ThreadCurrentPrincipalAccessor extends CurrentPrincipalAccessorBase {
  static readonly inject = [IAmbientScopeProvider] as const;

  protected getClaimsPrincipal(): ClaimsPrincipal {
    return new ClaimsPrincipal(new ClaimsIdentity());
  }
}
