import type { Guid } from "@abp/core";
import { EventName } from "@abp/event-bus";
import type { IMultiTenant } from "@abp/multi-tenancy-abstractions";
import { ExtraPropertyDictionary } from "@abp/object-extending";
import type { IUserData } from "./user-data.js";

/** Port of `UserEto` (`[EventName("Volo.Abp.Users.User")]`). */
@EventName("Volo.Abp.Users.User")
export class UserEto implements IUserData, IMultiTenant {
  id!: Guid;
  tenantId: Guid | undefined = undefined;
  userName!: string;
  name: string | undefined = undefined;
  surname: string | undefined = undefined;
  isActive = true;
  email: string | undefined = undefined;
  emailConfirmed = false;
  phoneNumber: string | undefined = undefined;
  phoneNumberConfirmed = false;
  extraProperties: ExtraPropertyDictionary = new ExtraPropertyDictionary();
}

/** Port of `UserPasswordChangeRequestedEto`. */
@EventName("Volo.Abp.Users.UserPasswordChangeRequested")
export class UserPasswordChangeRequestedEto implements IMultiTenant {
  tenantId: Guid | undefined = undefined;
  userName!: string;
  password!: string;
}

/** Port of `InviteUserToTenantRequestedEto`. */
@EventName("Volo.Abp.Users.InviteUserToTenantRequested")
export class InviteUserToTenantRequestedEto implements IMultiTenant {
  tenantId: Guid | undefined = undefined;
  email!: string;
  directlyAddToTenant = false;
}
