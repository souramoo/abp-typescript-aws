import { AbpModule, DependsOn, type ServiceConfigurationContext } from "@abp/core";
import { AbpMemoryDbModule, addMemoryDbContext } from "@abp/memory-db";
import { AbpUsersMemoryDbModule } from "@abp/users/memory-db";
import { AbpIdentityDomainModule, IdentityClaimType, IdentityLinkUser, IdentityRole, IdentitySecurityLog, IdentitySession, IdentityUser, IdentityUserDelegation, OrganizationUnit } from "../domain/index.js";
import { IdentityMemoryDbContext } from "./identity-memory-db-context.js";
import {
  MemoryDbIdentityClaimTypeRepository,
  MemoryDbIdentityLinkUserRepository,
  MemoryDbIdentityRoleRepository,
  MemoryDbIdentitySecurityLogRepository,
  MemoryDbIdentitySessionRepository,
  MemoryDbIdentityUserDelegationRepository,
  MemoryDbIdentityUserRepository,
  MemoryDbOrganizationUnitRepository,
} from "./repositories.js";

/** The memory-db counterpart of `AbpIdentityDynamoDbModule` (tests and local runs). */
@DependsOn(AbpIdentityDomainModule, AbpUsersMemoryDbModule, AbpMemoryDbModule)
export class AbpIdentityMemoryDbModule extends AbpModule {
  override configureServices(context: ServiceConfigurationContext): void {
    addMemoryDbContext(context.services, IdentityMemoryDbContext, (options) => {
      options
        .addRepository(IdentityUser, MemoryDbIdentityUserRepository)
        .addRepository(IdentityRole, MemoryDbIdentityRoleRepository)
        .addRepository(IdentityClaimType, MemoryDbIdentityClaimTypeRepository)
        .addRepository(OrganizationUnit, MemoryDbOrganizationUnitRepository)
        .addRepository(IdentitySecurityLog, MemoryDbIdentitySecurityLogRepository)
        .addRepository(IdentityLinkUser, MemoryDbIdentityLinkUserRepository)
        .addRepository(IdentityUserDelegation, MemoryDbIdentityUserDelegationRepository)
        .addRepository(IdentitySession, MemoryDbIdentitySessionRepository);
    });
  }
}
