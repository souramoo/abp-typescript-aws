import { AbpClaimTypes } from "./abp-claim-types.js";

/** Port of `System.Security.Claims.ClaimValueTypes` (the subset ABP uses). */
export const ClaimValueTypes = {
  String: "http://www.w3.org/2001/XMLSchema#string",
  Boolean: "http://www.w3.org/2001/XMLSchema#boolean",
  Integer: "http://www.w3.org/2001/XMLSchema#integer",
  Integer32: "http://www.w3.org/2001/XMLSchema#integer32",
  Integer64: "http://www.w3.org/2001/XMLSchema#integer64",
  Double: "http://www.w3.org/2001/XMLSchema#double",
  DateTime: "http://www.w3.org/2001/XMLSchema#dateTime",
  Json: "JSON",
} as const;

export const DefaultIssuer = "LOCAL AUTHORITY";

/** Port of `System.Security.Claims.Claim`. */
export class Claim {
  constructor(
    readonly type: string,
    readonly value: string,
    readonly valueType: string = ClaimValueTypes.String,
    readonly issuer: string = DefaultIssuer,
  ) {}

  toString(): string {
    return `${this.type}: ${this.value}`;
  }
}

export type ClaimPredicate = string | ((claim: Claim) => boolean);

function toPredicate(match: ClaimPredicate): (claim: Claim) => boolean {
  return typeof match === "string" ? (c) => c.type === match : match;
}

/**
 * Port of `System.Security.Claims.ClaimsIdentity`. `isAuthenticated` is true when an
 * `authenticationType` is set, exactly like .NET. Name/role claim types default to the
 * (remappable) `AbpClaimTypes.userName` / `AbpClaimTypes.role`.
 */
export class ClaimsIdentity {
  private readonly claimList: Claim[] = [];
  readonly authenticationType: string | undefined;
  readonly nameClaimType: string;
  readonly roleClaimType: string;
  label: string | undefined;

  constructor(claims?: Iterable<Claim>, authenticationType?: string, nameClaimType?: string, roleClaimType?: string);
  constructor(authenticationType: string, nameClaimType?: string, roleClaimType?: string);
  constructor(first?: Iterable<Claim> | string, second?: string, third?: string, fourth?: string) {
    if (typeof first === "string") {
      this.authenticationType = first;
      this.nameClaimType = second ?? AbpClaimTypes.userName;
      this.roleClaimType = third ?? AbpClaimTypes.role;
    } else {
      if (first) this.claimList.push(...first);
      this.authenticationType = second;
      this.nameClaimType = third ?? AbpClaimTypes.userName;
      this.roleClaimType = fourth ?? AbpClaimTypes.role;
    }
  }

  get claims(): readonly Claim[] {
    return this.claimList;
  }

  get isAuthenticated(): boolean {
    return this.authenticationType !== undefined && this.authenticationType !== "";
  }

  get name(): string | undefined {
    return this.findFirst(this.nameClaimType)?.value;
  }

  addClaim(claim: Claim): void {
    this.claimList.push(claim);
  }

  addClaims(claims: Iterable<Claim>): void {
    this.claimList.push(...claims);
  }

  removeClaim(claim: Claim): void {
    const i = this.claimList.indexOf(claim);
    if (i >= 0) this.claimList.splice(i, 1);
  }

  tryRemoveClaim(claim: Claim): boolean {
    const i = this.claimList.indexOf(claim);
    if (i < 0) return false;
    this.claimList.splice(i, 1);
    return true;
  }

  findFirst(match: ClaimPredicate): Claim | undefined {
    return this.claimList.find(toPredicate(match));
  }

  findAll(match: ClaimPredicate): Claim[] {
    return this.claimList.filter(toPredicate(match));
  }

  hasClaim(type: string, value: string): boolean;
  hasClaim(match: (claim: Claim) => boolean): boolean;
  hasClaim(match: ClaimPredicate, value?: string): boolean {
    if (typeof match === "string") return this.claimList.some((c) => c.type === match && c.value === value);
    return this.claimList.some(match);
  }

  clone(): ClaimsIdentity {
    const copy = new ClaimsIdentity(this.claimList, this.authenticationType, this.nameClaimType, this.roleClaimType);
    copy.label = this.label;
    return copy;
  }
}

/** Port of `System.Security.Claims.ClaimsPrincipal`: authenticated when any identity is authenticated. */
export class ClaimsPrincipal {
  private readonly identityList: ClaimsIdentity[] = [];

  constructor(identities?: ClaimsIdentity | Iterable<ClaimsIdentity>) {
    if (identities instanceof ClaimsIdentity) this.identityList.push(identities);
    else if (identities) this.identityList.push(...identities);
  }

  get identities(): readonly ClaimsIdentity[] {
    return this.identityList;
  }

  /** Primary identity (.NET default selector: the first identity). */
  get identity(): ClaimsIdentity | undefined {
    return this.identityList[0];
  }

  get claims(): Claim[] {
    return this.identityList.flatMap((i) => i.claims);
  }

  get isAuthenticated(): boolean {
    return this.identityList.some((i) => i.isAuthenticated);
  }

  addIdentity(identity: ClaimsIdentity): void {
    this.identityList.push(identity);
  }

  addIdentities(identities: Iterable<ClaimsIdentity>): void {
    this.identityList.push(...identities);
  }

  findFirst(match: ClaimPredicate): Claim | undefined {
    for (const identity of this.identityList) {
      const found = identity.findFirst(match);
      if (found) return found;
    }
    return undefined;
  }

  findAll(match: ClaimPredicate): Claim[] {
    return this.identityList.flatMap((i) => i.findAll(match));
  }

  hasClaim(type: string, value: string): boolean;
  hasClaim(match: (claim: Claim) => boolean): boolean;
  hasClaim(match: ClaimPredicate, value?: string): boolean {
    return this.identityList.some((i) => (typeof match === "string" ? i.hasClaim(match, value ?? "") : i.hasClaim(match)));
  }

  isInRole(role: string): boolean {
    return this.identityList.some((i) => i.hasClaim(i.roleClaimType, role));
  }
}
