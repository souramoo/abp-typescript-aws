import { ConnectionStringName } from "@abp/data";
import { MemoryDbContext } from "@abp/memory-db";
import { AbpIdentityDbProperties, IdentityClaimType, IdentityLinkUser, IdentityRole, IdentitySecurityLog, IdentitySession, IdentityUser, IdentityUserDelegation, OrganizationUnit } from "../domain/index.js";

/** The in-memory counterpart of `IdentityDynamoDbContext` (tests and local runs). */
@ConnectionStringName(AbpIdentityDbProperties.ConnectionStringName)
export class IdentityMemoryDbContext extends MemoryDbContext {
  override readonly entities = [IdentityUser, IdentityRole, IdentityClaimType, OrganizationUnit, IdentitySecurityLog, IdentitySession, IdentityLinkUser, IdentityUserDelegation];
}
