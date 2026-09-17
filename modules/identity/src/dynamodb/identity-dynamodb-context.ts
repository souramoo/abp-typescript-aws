import type { Guid } from "@abp/core";
import { ConnectionStringName } from "@abp/data";
import { Entity } from "@abp/ddd-domain";
import { AbpDynamoDbContext, type DynamoDbModelBuilder } from "@abp/dynamodb";
import type { IMultiTenant } from "@abp/multi-tenancy-abstractions";
import { AbpIdentityDbProperties, IdentityClaimType, IdentityLinkUser, IdentityRole, IdentitySecurityLog, IdentitySession, IdentityUser, IdentityUserDelegation, OrganizationUnit } from "../domain/index.js";

/**
 * Denormalised lookup item for `IIdentityUserRepository.findByLogin`: one item per external login of a user, keyed
 * by `loginProvider#providerKey` (logins themselves stay embedded in the user item like the MongoDB document).
 * `DynamoDbIdentityUserRepository` keeps these in sync on insert/update/delete; `gsi2` (by user id) lists them.
 */
export class IdentityUserLoginIndex extends Entity<string> implements IMultiTenant {
  tenantId: Guid | undefined = undefined;
  userId!: Guid;
  loginProvider!: string;
  providerKey!: string;

  constructor(userId?: Guid, loginProvider?: string, providerKey?: string, tenantId?: Guid) {
    super(loginProvider === undefined || providerKey === undefined ? undefined : IdentityUserLoginIndex.keyOf(loginProvider, providerKey));
    if (userId === undefined) return;
    this.userId = userId;
    this.loginProvider = loginProvider!;
    this.providerKey = providerKey!;
    this.tenantId = tenantId;
  }

  static keyOf(loginProvider: string, providerKey: string): string {
    return `${loginProvider}#${providerKey}`;
  }
}

/**
 * Port of `AbpIdentityMongoDbContext` / `IAbpIdentityMongoDbContext`. Key segments follow the .NET collection names;
 * the extra indexes serve the point lookups of the repositories (`gsi2`/`gsi3`), list filters run in memory over the
 * tenant partition.
 */
@ConnectionStringName(AbpIdentityDbProperties.ConnectionStringName)
export class IdentityDynamoDbContext extends AbpDynamoDbContext {
  protected override configureEntities(builder: DynamoDbModelBuilder): void {
    configureIdentity(builder);
  }
}

/** Port of `AbpIdentityMongoDbContextExtensions.ConfigureIdentity`. */
export function configureIdentity(builder: DynamoDbModelBuilder): void {
  const prefix = AbpIdentityDbProperties.dbTablePrefix;
  builder
    .entity(IdentityUser, (e) => {
      e.name(`${prefix}Users`).index("gsi2", { pk: (u) => u.normalizedUserName }).index("gsi3", { pk: (u) => u.normalizedEmail });
    })
    .entity(IdentityUserLoginIndex, (e) => {
      e.name(`${prefix}UserLogins`).index("gsi2", { pk: (l) => l.userId });
    })
    .entity(IdentityRole, (e) => {
      e.name(`${prefix}Roles`).index("gsi2", { pk: (r) => r.normalizedName });
    })
    .entity(IdentityClaimType, (e) => {
      e.name(`${prefix}ClaimTypes`).index("gsi2", { pk: (c) => c.name });
    })
    .entity(OrganizationUnit, (e) => {
      e.name(`${prefix}OrganizationUnits`).index("gsi2", { pk: (ou) => ou.parentId ?? "root", sk: (ou) => ou.code });
    })
    .entity(IdentitySecurityLog, (e) => {
      e.name(`${prefix}SecurityLogs`).index("gsi2", { pk: (l) => l.userId, sk: (l) => `${l.creationTime.toISOString()}#${l.id}` });
    })
    .entity(IdentitySession, (e) => {
      e.name(`${prefix}Sessions`).index("gsi2", { pk: (s) => s.sessionId }).index("gsi3", { pk: (s) => s.userId });
    })
    .entity(IdentityLinkUser, (e) => {
      e.name(`${prefix}LinkUsers`);
    })
    .entity(IdentityUserDelegation, (e) => {
      e.name(`${prefix}UserDelegations`).index("gsi2", { pk: (d) => d.targetUserId });
    });
}
