import { LocalizationResourceName, type JsonLocalizationFile } from "@abp/localization";

/** Port of `AbpTenantManagementResource` ("AbpTenantManagement"). */
@LocalizationResourceName("AbpTenantManagement")
export class AbpTenantManagementResource {}

/** Port of `Volo/Abp/TenantManagement/Localization/Resources/en.json`. */
export const abpTenantManagementEn: JsonLocalizationFile = {
  culture: "en",
  texts: {
    "Volo.Abp.TenantManagement:DuplicateTenantName": "Tenant name already exist: {Name}",
    "Menu:TenantManagement": "Tenant management",
    Tenants: "Tenants",
    NewTenant: "New tenant",
    TenantName: "Tenant name",
    "DisplayName:TenantName": "Tenant Name",
    TenantDeletionConfirmationMessage: "Tenant '{0}' will be deleted. Do you confirm that?",
    ConnectionStrings: "Connection Strings",
    "DisplayName:DefaultConnectionString": "Default Connection String",
    "DisplayName:UseSharedDatabase": "Use the Shared Database",
    "Permission:TenantManagement": "Tenant management",
    "Permission:Create": "Create",
    "Permission:Edit": "Edit",
    "Permission:Delete": "Delete",
    "Permission:ManageConnectionStrings": "Manage connection strings",
    "Permission:ManageFeatures": "Features",
    "DisplayName:AdminEmailAddress": "Admin Email Address",
    "DisplayName:AdminPassword": "Admin Password",
  },
};
