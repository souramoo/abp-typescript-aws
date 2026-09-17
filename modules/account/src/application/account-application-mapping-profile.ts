import { IdentityUser } from "@abp/identity/domain";
import { MappingProfile } from "@abp/object-mapping";
import { mapExtraPropertiesTo } from "@abp/object-extending";
import { ProfileDto } from "../application-contracts/index.js";

/**
 * Port of `AbpAccountApplicationMappers` (`IdentityUser → ProfileDto`, `HasPassword` set after mapping). The
 * `IdentityUser → IdentityUserDto` map used by `register` comes from `IdentityApplicationMappingProfile`, which the
 * account application module registers under its own mapping context.
 */
export class AccountApplicationMappingProfile extends MappingProfile {
  constructor() {
    super();
    this.createMap(IdentityUser, ProfileDto, (user) => {
      const dto = new ProfileDto();
      dto.userName = user.userName;
      dto.email = user.email;
      dto.name = user.name;
      dto.surname = user.surname;
      dto.phoneNumber = user.phoneNumber;
      dto.isExternal = user.isExternal;
      dto.concurrencyStamp = user.concurrencyStamp;
      mapExtraPropertiesTo(user, dto);
      dto.hasPassword = user.passwordHash !== undefined && user.passwordHash !== null;
      return dto;
    });
  }
}
