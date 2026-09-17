import { AbpUserConsts } from "@abp/users/domain-shared";

/** Port of `IdentityUserConsts` (mutable statics like ABP). */
export class IdentityUserConsts {
  static maxUserNameLength: number = AbpUserConsts.maxUserNameLength;
  static maxNameLength: number = AbpUserConsts.maxNameLength;
  static maxSurnameLength: number = AbpUserConsts.maxSurnameLength;
  static maxNormalizedUserNameLength: number = IdentityUserConsts.maxUserNameLength;
  static maxEmailLength: number = AbpUserConsts.maxEmailLength;
  static maxNormalizedEmailLength: number = IdentityUserConsts.maxEmailLength;
  static maxPhoneNumberLength: number = AbpUserConsts.maxPhoneNumberLength;
  /** Default value: 128 */
  static maxPasswordLength = 128;
  /** Default value: 256 */
  static maxPasswordHashLength = 256;
  /** Default value: 256 */
  static maxSecurityStampLength = 256;
  /** Default value: 16 */
  static maxLoginProviderLength = 16;
}

/** Port of `IdentityRoleConsts`. */
export class IdentityRoleConsts {
  /** Default value: 256 */
  static maxNameLength = 256;
  /** Default value: 256 */
  static maxNormalizedNameLength = 256;
}

/** Port of `IdentityUserClaimConsts`. */
export class IdentityUserClaimConsts {
  /** Default value: 256 */
  static maxClaimTypeLength = 256;
  /** Default value: 1024 */
  static maxClaimValueLength = 1024;
}

/** Port of `IdentityRoleClaimConsts`. */
export class IdentityRoleClaimConsts {
  static maxClaimTypeLength: number = IdentityUserClaimConsts.maxClaimTypeLength;
  static maxClaimValueLength: number = IdentityUserClaimConsts.maxClaimValueLength;
}

/** Port of `IdentityClaimTypeConsts`. */
export class IdentityClaimTypeConsts {
  /** Default value: 256 */
  static maxNameLength = 256;
  /** Default value: 512 */
  static maxRegexLength = 512;
  /** Default value: 128 */
  static maxRegexDescriptionLength = 128;
  /** Default value: 256 */
  static maxDescriptionLength = 256;
}

/** Port of `IdentityUserLoginConsts`. */
export class IdentityUserLoginConsts {
  /** Default value: 64 */
  static maxLoginProviderLength = 64;
  /** Default value: 196 */
  static maxProviderKeyLength = 196;
  /** Default value: 128 */
  static maxProviderDisplayNameLength = 128;
}

/** Port of `IdentityUserTokenConsts`. */
export class IdentityUserTokenConsts {
  /** Default value: 64 */
  static maxLoginProviderLength = 64;
  /** Default value: 128 */
  static maxNameLength = 128;
}

/** Port of `IdentityUserPasswordHistoriesConsts`. */
export class IdentityUserPasswordHistoriesConsts {
  /** Default value: 256 */
  static maxPasswordLength = 256;
}

/** Port of `OrganizationUnitConsts`. */
export class OrganizationUnitConsts {
  /** Maximum length of the DisplayName property. */
  static maxDisplayNameLength = 128;
  /** Maximum depth of an OU hierarchy. */
  static readonly MaxDepth = 16;
  /** Length of a code unit between dots. */
  static readonly CodeUnitLength = 5;
  /** Maximum length of the Code property. */
  static readonly MaxCodeLength = OrganizationUnitConsts.MaxDepth * (OrganizationUnitConsts.CodeUnitLength + 1) - 1;
}

/** Port of `IdentitySecurityLogConsts`. */
export class IdentitySecurityLogConsts {
  /** Default value: 96 */
  static maxApplicationNameLength = 96;
  /** Default value: 96 */
  static maxIdentityLength = 96;
  /** Default value: 96 */
  static maxActionLength = 96;
  /** Default value: 256 */
  static maxUserNameLength = 256;
  /** Default value: 64 */
  static maxTenantNameLength = 64;
  /** Default value: 64 */
  static maxClientIpAddressLength = 64;
  /** Default value: 64 */
  static maxClientIdLength = 64;
  /** Default value: 64 */
  static maxCorrelationIdLength = 64;
  /** Default value: 512 */
  static maxBrowserInfoLength = 512;
}

/** Port of `IdentitySecurityLogActionConsts`. */
export class IdentitySecurityLogActionConsts {
  static loginSucceeded = "LoginSucceeded";
  static loginLockedout = "LoginLockedout";
  static loginNotAllowed = "LoginNotAllowed";
  static loginRequiresTwoFactor = "LoginRequiresTwoFactor";
  static loginFailed = "LoginFailed";
  static loginInvalidUserName = "LoginInvalidUserName";
  static loginInvalidUserNameOrPassword = "LoginInvalidUserNameOrPassword";
  static logout = "Logout";
  static changeUserName = "ChangeUserName";
  static changeEmail = "ChangeEmail";
  static changePhoneNumber = "ChangePhoneNumber";
  static changePassword = "ChangePassword";
  static twoFactorEnabled = "TwoFactorEnabled";
  static twoFactorDisabled = "TwoFactorDisabled";
}

/** Port of `IdentitySecurityLogIdentityConsts`. */
export class IdentitySecurityLogIdentityConsts {
  static identity = "Identity";
  static identityExternal = "IdentityExternal";
  static identityTwoFactor = "IdentityTwoFactor";
}

/** Port of `IdentitySessionConsts`. */
export class IdentitySessionConsts {
  static maxSessionIdLength = 128;
  static maxDeviceLength = 64;
  static maxDeviceInfoLength = 256;
  static maxClientIdLength = 64;
  static maxIpAddressesLength = 2048;
}

/** Port of `IdentitySessionDevices`. */
export const IdentitySessionDevices = {
  Web: "Web",
  OAuth: "OAuth",
  Mobile: "Mobile",
} as const;

/** Port of `LinkUserTokenProviderConsts`. */
export class LinkUserTokenProviderConsts {
  static linkUserTokenProviderName = "AbpLinkUser";
  static linkUserTokenPurpose = "AbpLinkUser";
  static linkUserLoginTokenPurpose = "AbpLinkUserLogin";
  static linkUserConsentLoginProvider = "[AbpLinkUserConsent]";
  static linkUserConsentTokenName = "Consent";
}

/** Port of `IdentityModuleExtensionConsts` (`Volo.Abp.ObjectExtending`). */
export const IdentityModuleExtensionConsts = {
  ModuleName: "Identity",
  EntityNames: {
    User: "User",
    Role: "Role",
    ClaimType: "ClaimType",
    OrganizationUnit: "OrganizationUnit",
    IdentitySession: "IdentitySession",
  },
  ConfigurationNames: {
    AllowUserToEdit: "AllowUserToEdit",
  },
} as const;

/** Port of `IdentityErrorCodes`. */
export const IdentityErrorCodes = {
  UserSelfDeletion: "Volo.Abp.Identity:010001",
  MaxAllowedOuMembership: "Volo.Abp.Identity:010002",
  ExternalUserPasswordChange: "Volo.Abp.Identity:010003",
  DuplicateOrganizationUnitDisplayName: "Volo.Abp.Identity:010004",
  StaticRoleRenaming: "Volo.Abp.Identity:010005",
  StaticRoleDeletion: "Volo.Abp.Identity:010006",
  UsersCanNotChangeTwoFactor: "Volo.Abp.Identity:010007",
  CanNotChangeTwoFactor: "Volo.Abp.Identity:010008",
  YouCannotDelegateYourself: "Volo.Abp.Identity:010009",
  OrganizationUnitParentTenantMismatch: "Volo.Abp.Identity:010010",
  ClaimNameExist: "Volo.Abp.Identity:010021",
  CanNotUpdateStaticClaimType: "Volo.Abp.Identity:010022",
  CanNotDeleteStaticClaimType: "Volo.Abp.Identity:010023",
} as const;

/** Port of `IdentityClaimValueType`. */
export enum IdentityClaimValueType {
  String = 0,
  Int = 1,
  Boolean = 2,
  DateTime = 3,
}

/** Port of `IdentitySettingNames`. */
export const IdentitySettingNames = {
  Password: {
    RequiredLength: "Abp.Identity.Password.RequiredLength",
    RequiredUniqueChars: "Abp.Identity.Password.RequiredUniqueChars",
    RequireNonAlphanumeric: "Abp.Identity.Password.RequireNonAlphanumeric",
    RequireLowercase: "Abp.Identity.Password.RequireLowercase",
    RequireUppercase: "Abp.Identity.Password.RequireUppercase",
    RequireDigit: "Abp.Identity.Password.RequireDigit",
    ForceUsersToPeriodicallyChangePassword: "Abp.Identity.Password.ForceUsersToPeriodicallyChangePassword",
    PasswordChangePeriodDays: "Abp.Identity.Password.PasswordChangePeriodDays",
    EnablePreventPasswordReuse: "Abp.Identity.Password.EnablePreventPasswordReuse",
    PreventPasswordReuseCount: "Abp.Identity.Password.PreventPasswordReuseCount",
  },
  Lockout: {
    AllowedForNewUsers: "Abp.Identity.Lockout.AllowedForNewUsers",
    LockoutDuration: "Abp.Identity.Lockout.LockoutDuration",
    MaxFailedAccessAttempts: "Abp.Identity.Lockout.MaxFailedAccessAttempts",
  },
  SignIn: {
    RequireConfirmedEmail: "Abp.Identity.SignIn.RequireConfirmedEmail",
    RequireEmailVerificationToRegister: "Abp.Identity.SignIn.RequireEmailVerificationToRegister",
    EnablePhoneNumberConfirmation: "Abp.Identity.SignIn.EnablePhoneNumberConfirmation",
    RequireConfirmedPhoneNumber: "Abp.Identity.SignIn.RequireConfirmedPhoneNumber",
  },
  User: {
    IsUserNameUpdateEnabled: "Abp.Identity.User.IsUserNameUpdateEnabled",
    IsEmailUpdateEnabled: "Abp.Identity.User.IsEmailUpdateEnabled",
  },
  OrganizationUnit: {
    MaxUserMembershipCount: "Abp.Identity.OrganizationUnit.MaxUserMembershipCount",
  },
} as const;
