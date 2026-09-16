import { AbpModule, IApplicationInfoAccessor, IConfiguration, isNullOrWhiteSpace, type ServiceCollection, type ServiceConfigurationContext, type Class } from "@abp/core";
import { AbpClaimsPrincipalContributor, AbpClaimsPrincipalFactoryOptions, AbpDynamicClaimsPrincipalContributor, type IAbpClaimsPrincipalContributor, type IAbpDynamicClaimsPrincipalContributor } from "./claims/claims-principal-factory.js";
import { AbpStringEncryptionOptions } from "./encryption/string-encryption.js";
import { AbpSecurityLogOptions } from "./security-log/security-log.js";

/**
 * Port of `AbpSecurityModule`. Contributor auto-registration is hooked in `preConfigureServices`
 * (not `postConfigureServices` as in .NET) because conventional registration runs before post-configure here.
 */
export class AbpSecurityModule extends AbpModule {
  override preConfigureServices(context: ServiceConfigurationContext): void {
    autoAddClaimsPrincipalContributors(context.services);
  }

  override configureServices(context: ServiceConfigurationContext): void {
    const applicationName = context.services.getSingletonInstanceOrNull(IApplicationInfoAccessor)?.applicationName;
    if (applicationName) {
      this.configure(AbpSecurityLogOptions, (options) => {
        options.applicationName = applicationName;
      });
    }

    const configuration = context.services.getSingletonInstanceOrNull(IConfiguration);
    if (!configuration) return;
    this.configure(AbpStringEncryptionOptions, (options) => {
      const keySize = configuration.get("StringEncryption:KeySize");
      if (!isNullOrWhiteSpace(keySize) && Number.isInteger(Number(keySize))) options.keySize = Number(keySize);

      const defaultPassPhrase = configuration.get("StringEncryption:DefaultPassPhrase");
      if (!isNullOrWhiteSpace(defaultPassPhrase)) options.defaultPassPhrase = defaultPassPhrase;

      const initVectorBytes = configuration.get("StringEncryption:InitVectorBytes");
      if (!isNullOrWhiteSpace(initVectorBytes)) options.initVectorBytes = Buffer.from(initVectorBytes, "ascii");

      const defaultSalt = configuration.get("StringEncryption:DefaultSalt");
      if (!isNullOrWhiteSpace(defaultSalt)) options.defaultSalt = Buffer.from(defaultSalt, "ascii");
    });
  }
}

function autoAddClaimsPrincipalContributors(services: ServiceCollection): void {
  const contributorTypes: Class<IAbpClaimsPrincipalContributor>[] = [];
  const dynamicContributorTypes: Class<IAbpDynamicClaimsPrincipalContributor>[] = [];

  services.onRegistered((context) => {
    if (AbpClaimsPrincipalContributor.has(context.implementationType)) contributorTypes.push(context.implementationType as Class<IAbpClaimsPrincipalContributor>);
    if (AbpDynamicClaimsPrincipalContributor.has(context.implementationType)) dynamicContributorTypes.push(context.implementationType as Class<IAbpDynamicClaimsPrincipalContributor>);
  });

  services.options.configure(AbpClaimsPrincipalFactoryOptions, (options) => {
    options.contributors.addRange(contributorTypes);
    options.dynamicContributors.addRange(dynamicContributorTypes);
  });
}
