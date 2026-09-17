import { Check, Guid, isNullOrWhiteSpace, removeAll } from "@abp/core";
import { EntityBase, FullAuditedAggregateRoot } from "@abp/ddd-domain";
import type { IGuidGenerator } from "@abp/guids";
import type { IMultiTenant } from "@abp/multi-tenancy-abstractions";
import type { Claim } from "@abp/security";
import type { IUser } from "@abp/users/domain";
import { IdentityUserClaim, claimMatches } from "./identity-claim.js";

/** Port of `Microsoft.AspNetCore.Identity.UserLoginInfo`. */
export class UserLoginInfo {
  constructor(
    readonly loginProvider: string,
    readonly providerKey: string,
    readonly providerDisplayName: string | undefined = undefined,
  ) {}
}

/** Port of `IdentityUserRole` (composite key: userId + roleId). */
export class IdentityUserRole extends EntityBase implements IMultiTenant {
  tenantId: Guid | undefined = undefined;
  userId!: Guid;
  roleId!: Guid;

  constructor(userId?: Guid, roleId?: Guid, tenantId?: Guid) {
    super();
    if (userId === undefined) return;
    this.userId = userId;
    this.roleId = Check.notNull(roleId, "roleId");
    this.tenantId = tenantId;
  }

  getKeys(): readonly unknown[] {
    return [this.userId, this.roleId];
  }
}

/** Port of `IdentityUserLogin` (composite key: userId + loginProvider). */
export class IdentityUserLogin extends EntityBase implements IMultiTenant {
  tenantId: Guid | undefined = undefined;
  userId!: Guid;
  loginProvider!: string;
  providerKey!: string;
  providerDisplayName: string | undefined = undefined;

  constructor(userId?: Guid, loginProvider?: string, providerKey?: string, providerDisplayName?: string, tenantId?: Guid) {
    super();
    if (userId === undefined) return;
    this.userId = userId;
    this.loginProvider = Check.notNull(loginProvider, "loginProvider");
    this.providerKey = Check.notNull(providerKey, "providerKey");
    this.providerDisplayName = providerDisplayName;
    this.tenantId = tenantId;
  }

  toUserLoginInfo(): UserLoginInfo {
    return new UserLoginInfo(this.loginProvider, this.providerKey, this.providerDisplayName);
  }

  getKeys(): readonly unknown[] {
    return [this.userId, this.loginProvider];
  }
}

/** Port of `IdentityUserToken` (composite key: userId + loginProvider + name). */
export class IdentityUserToken extends EntityBase implements IMultiTenant {
  tenantId: Guid | undefined = undefined;
  userId!: Guid;
  loginProvider!: string;
  name!: string;
  value: string | undefined = undefined;

  constructor(userId?: Guid, loginProvider?: string, name?: string, value?: string, tenantId?: Guid) {
    super();
    if (userId === undefined) return;
    this.userId = userId;
    this.loginProvider = Check.notNull(loginProvider, "loginProvider");
    this.name = Check.notNull(name, "name");
    this.value = value;
    this.tenantId = tenantId;
  }

  getKeys(): readonly unknown[] {
    return [this.userId, this.loginProvider, this.name];
  }
}

/** Port of `IdentityUserOrganizationUnit` (composite key: userId + organizationUnitId). */
export class IdentityUserOrganizationUnit extends EntityBase implements IMultiTenant {
  tenantId: Guid | undefined = undefined;
  userId!: Guid;
  organizationUnitId!: Guid;
  creationTime!: Date;
  creatorId: Guid | undefined = undefined;

  constructor(userId?: Guid, organizationUnitId?: Guid, tenantId?: Guid) {
    super();
    if (userId === undefined) return;
    this.userId = userId;
    this.organizationUnitId = Check.notNull(organizationUnitId, "organizationUnitId");
    this.tenantId = tenantId;
    this.creationTime = new Date();
  }

  getKeys(): readonly unknown[] {
    return [this.userId, this.organizationUnitId];
  }
}

/**
 * Port of `IdentityUser`. The `protected internal` setters of .NET are plain fields here; `IdentityUserManager`
 * (the port of the user store + manager) is the sanctioned writer of user name, email, password hash, stamps and
 * lockout state. Password histories and passkeys are not ported.
 */
export class IdentityUser extends FullAuditedAggregateRoot<Guid> implements IUser, IMultiTenant {
  tenantId: Guid | undefined = undefined;
  userName!: string;
  normalizedUserName!: string;
  name: string | undefined = undefined;
  surname: string | undefined = undefined;
  email!: string;
  normalizedEmail!: string;
  emailConfirmed = false;
  passwordHash: string | undefined = undefined;
  securityStamp!: string;
  isExternal = false;
  phoneNumber: string | undefined = undefined;
  phoneNumberConfirmed = false;
  isActive = true;
  twoFactorEnabled = false;
  lockoutEnd: Date | undefined = undefined;
  lockoutEnabled = false;
  accessFailedCount = 0;
  shouldChangePasswordOnNextLogin = false;
  entityVersion = 0;
  lastPasswordChangeTime: Date | undefined = undefined;
  lastSignInTime: Date | undefined = undefined;
  leaved = false;
  roles: IdentityUserRole[] = [];
  claims: IdentityUserClaim[] = [];
  logins: IdentityUserLogin[] = [];
  tokens: IdentityUserToken[] = [];
  organizationUnits: IdentityUserOrganizationUnit[] = [];

  constructor(id?: Guid, userName?: string, email?: string, tenantId?: Guid) {
    super(id);
    if (id === undefined) return;
    this.tenantId = tenantId;
    this.userName = Check.notNull(userName, "userName");
    this.normalizedUserName = this.userName.toUpperCase();
    this.email = Check.notNull(email, "email");
    this.normalizedEmail = this.email.toUpperCase();
    this.securityStamp = Guid.newGuid();
    this.isActive = true;
  }

  addRole(roleId: Guid): void {
    Check.notNull(roleId, "roleId");
    if (this.isInRole(roleId)) return;
    this.roles.push(new IdentityUserRole(this.id, roleId, this.tenantId));
  }

  removeRole(roleId: Guid): void {
    Check.notNull(roleId, "roleId");
    if (!this.isInRole(roleId)) return;
    removeAll(this.roles, (r) => r.roleId === roleId);
  }

  isInRole(roleId: Guid): boolean {
    Check.notNull(roleId, "roleId");
    return this.roles.some((r) => r.roleId === roleId);
  }

  addClaim(guidGenerator: IGuidGenerator, claim: Claim): void {
    Check.notNull(guidGenerator, "guidGenerator");
    Check.notNull(claim, "claim");
    this.claims.push(IdentityUserClaim.fromClaim(guidGenerator.create(), this.id, claim, this.tenantId));
  }

  addClaims(guidGenerator: IGuidGenerator, claims: Iterable<Claim>): void {
    for (const claim of Check.notNull(claims, "claims")) this.addClaim(guidGenerator, claim);
  }

  findClaim(claim: Claim): IdentityUserClaim | undefined {
    Check.notNull(claim, "claim");
    return this.claims.find((c) => claimMatches(c, claim));
  }

  replaceClaim(claim: Claim, newClaim: Claim): void {
    Check.notNull(claim, "claim");
    Check.notNull(newClaim, "newClaim");
    for (const userClaim of this.claims.filter((c) => claimMatches(c, claim))) {
      userClaim.claimType = newClaim.type;
      userClaim.claimValue = newClaim.value;
    }
  }

  removeClaims(claims: Iterable<Claim>): void {
    for (const claim of Check.notNull(claims, "claims")) this.removeClaim(claim);
  }

  removeClaim(claim: Claim): void {
    Check.notNull(claim, "claim");
    removeAll(this.claims, (c) => claimMatches(c, claim));
  }

  addLogin(login: UserLoginInfo): void {
    Check.notNull(login, "login");
    this.logins.push(new IdentityUserLogin(this.id, login.loginProvider, login.providerKey, login.providerDisplayName, this.tenantId));
  }

  removeLogin(loginProvider: string, providerKey: string): void {
    Check.notNull(loginProvider, "loginProvider");
    Check.notNull(providerKey, "providerKey");
    removeAll(this.logins, (l) => l.loginProvider === loginProvider && l.providerKey === providerKey);
  }

  findToken(loginProvider: string, name: string): IdentityUserToken | undefined {
    return this.tokens.find((t) => t.loginProvider === loginProvider && t.name === name);
  }

  setToken(loginProvider: string, name: string, value: string | undefined): void {
    const token = this.findToken(loginProvider, name);
    if (token === undefined) this.tokens.push(new IdentityUserToken(this.id, loginProvider, name, value, this.tenantId));
    else token.value = value;
  }

  removeToken(loginProvider: string, name: string): void {
    removeAll(this.tokens, (t) => t.loginProvider === loginProvider && t.name === name);
  }

  addOrganizationUnit(organizationUnitId: Guid): void {
    if (this.isInOrganizationUnit(organizationUnitId)) return;
    this.organizationUnits.push(new IdentityUserOrganizationUnit(this.id, organizationUnitId, this.tenantId));
  }

  removeOrganizationUnit(organizationUnitId: Guid): void {
    if (!this.isInOrganizationUnit(organizationUnitId)) return;
    removeAll(this.organizationUnits, (ou) => ou.organizationUnitId === organizationUnitId);
  }

  isInOrganizationUnit(organizationUnitId: Guid): boolean {
    return this.organizationUnits.some((ou) => ou.organizationUnitId === organizationUnitId);
  }

  setEmailConfirmed(confirmed: boolean): void {
    this.emailConfirmed = confirmed;
  }

  setPhoneNumberConfirmed(confirmed: boolean): void {
    this.phoneNumberConfirmed = confirmed;
  }

  setPhoneNumber(phoneNumber: string | undefined, confirmed: boolean): void {
    this.phoneNumber = phoneNumber;
    this.phoneNumberConfirmed = !isNullOrWhiteSpace(phoneNumber) && confirmed;
  }

  setIsActive(isActive: boolean): void {
    this.isActive = isActive;
  }

  setShouldChangePasswordOnNextLogin(shouldChangePasswordOnNextLogin: boolean): void {
    this.shouldChangePasswordOnNextLogin = shouldChangePasswordOnNextLogin;
  }

  setLastPasswordChangeTime(lastPasswordChangeTime: Date | undefined): void {
    this.lastPasswordChangeTime = lastPasswordChangeTime;
  }

  setLastSignInTime(lastSignInTime: Date | undefined): void {
    this.lastSignInTime = lastSignInTime;
  }

  setUserNameWithoutValidation(userName: string, normalizedUserName: string): void {
    this.userName = userName;
    this.normalizedUserName = normalizedUserName;
  }

  setEmailWithoutValidation(email: string, normalizedEmail: string): void {
    this.email = email;
    this.normalizedEmail = normalizedEmail;
  }

  setPasswordHashWithoutValidation(passwordHash: string | undefined): void {
    this.passwordHash = passwordHash;
  }

  setLeaved(leaved: boolean): void {
    this.leaved = leaved;
  }

  override toString(): string {
    return `${super.toString()}, UserName = ${this.userName}`;
  }
}

/** True when the user is locked out at `now` (`LockoutEnabled && LockoutEnd > now`). */
export function isUserLockedOut(user: IdentityUser, now: Date = new Date()): boolean {
  return user.lockoutEnabled && user.lockoutEnd !== undefined && user.lockoutEnd.getTime() > now.getTime();
}
