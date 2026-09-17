import { AbpModule, DependsOn, type ServiceConfigurationContext } from "@abp/core";
import { AbpDynamoDbModule, addDynamoDbContext } from "@abp/dynamodb";
import { AbpUsersDynamoDbModule } from "@abp/users/dynamodb";
import { AbpIdentityDomainModule, IdentityClaimType, IdentityLinkUser, IdentityRole, IdentitySecurityLog, IdentitySession, IdentityUser, IdentityUserDelegation, OrganizationUnit } from "../domain/index.js";
import { IdentityDynamoDbContext, IdentityUserLoginIndex } from "./identity-dynamodb-context.js";
import {
  DynamoDbIdentityClaimTypeRepository,
  DynamoDbIdentityLinkUserRepository,
  DynamoDbIdentityRoleRepository,
  DynamoDbIdentitySecurityLogRepository,
  DynamoDbIdentitySessionRepository,
  DynamoDbIdentityUserDelegationRepository,
  DynamoDbIdentityUserRepository,
  DynamoDbOrganizationUnitRepository,
} from "./repositories.js";

/** Port of `AbpIdentityMongoDbModule`. */
@DependsOn(AbpIdentityDomainModule, AbpUsersDynamoDbModule, AbpDynamoDbModule)
export class AbpIdentityDynamoDbModule extends AbpModule {
  override configureServices(context: ServiceConfigurationContext): void {
    addDynamoDbContext(context.services, IdentityDynamoDbContext, (options) => {
      options
        .addRepository(IdentityUser, DynamoDbIdentityUserRepository)
        .addRepository(IdentityRole, DynamoDbIdentityRoleRepository)
        .addRepository(IdentityClaimType, DynamoDbIdentityClaimTypeRepository)
        .addRepository(OrganizationUnit, DynamoDbOrganizationUnitRepository)
        .addRepository(IdentitySecurityLog, DynamoDbIdentitySecurityLogRepository)
        .addRepository(IdentityLinkUser, DynamoDbIdentityLinkUserRepository)
        .addRepository(IdentityUserDelegation, DynamoDbIdentityUserDelegationRepository)
        .addRepository(IdentitySession, DynamoDbIdentitySessionRepository)
        .addDefaultRepository(IdentityUserLoginIndex);
    });
  }
}
