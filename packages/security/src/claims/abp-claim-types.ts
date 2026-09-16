/**
 * Port of `AbpClaimTypes`. Mutable statics like ABP so applications can remap claim names.
 * Defaults use the short JWT/OIDC claim names instead of the WS-* URIs of `System.Security.Claims.ClaimTypes`.
 */
export class AbpClaimTypes {
  static userName = "preferred_username";
  static name = "given_name";
  static surName = "family_name";
  static userId = "sub";
  static role = "role";
  static email = "email";
  static emailVerified = "email_verified";
  static phoneNumber = "phone_number";
  static phoneNumberVerified = "phone_number_verified";
  static tenantId = "tenantid";
  static editionId = "editionid";
  static clientId = "client_id";
  static impersonatorTenantId = "impersonator_tenantid";
  static impersonatorUserId = "impersonator_userid";
  static impersonatorTenantName = "impersonator_tenantname";
  static impersonatorUserName = "impersonator_username";
  static picture = "picture";
  static rememberMe = "remember_me";
  static sessionId = "session_id";
}
