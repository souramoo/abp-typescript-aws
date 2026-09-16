import { Transient, createToken } from "@abp/core";
import { findClientId } from "../claims/claims-identity-extensions.js";
import { ICurrentPrincipalAccessor } from "../claims/current-principal-accessor.js";

/** Port of `ICurrentClient`. */
export interface ICurrentClient {
  readonly id: string | undefined;
  readonly isAuthenticated: boolean;
}
export const ICurrentClient = createToken<ICurrentClient>("ICurrentClient");

@Transient(ICurrentClient)
export class CurrentClient implements ICurrentClient {
  static readonly inject = [ICurrentPrincipalAccessor] as const;

  constructor(private readonly principalAccessor: ICurrentPrincipalAccessor) {}

  get id(): string | undefined {
    return findClientId(this.principalAccessor.principal);
  }

  get isAuthenticated(): boolean {
    return this.id !== undefined;
  }
}
