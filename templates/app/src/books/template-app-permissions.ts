import { Transient, localizableString, type LocalizableString } from "@abp/core";
import { PermissionDefinitionProvider, type IPermissionDefinitionContext } from "@abp/authorization";
import { TemplateAppResource } from "./template-app-resource.js";

/** Port of `MyProjectNamePermissions` with the tutorial's book permissions. */
export const TemplateAppPermissions = {
  GroupName: "TemplateApp",
  Books: {
    Default: "TemplateApp.Books",
    Create: "TemplateApp.Books.Create",
    Edit: "TemplateApp.Books.Edit",
    Delete: "TemplateApp.Books.Delete",
  },
} as const;

function L(name: string): LocalizableString {
  return localizableString(TemplateAppResource, name);
}

/** Port of `MyProjectNamePermissionDefinitionProvider`. */
@Transient()
export class TemplateAppPermissionDefinitionProvider extends PermissionDefinitionProvider {
  define(context: IPermissionDefinitionContext): void {
    const group = context.addGroup(TemplateAppPermissions.GroupName, L("Permission:TemplateApp"));
    const books = group.addPermission(TemplateAppPermissions.Books.Default, L("Permission:Books"));
    books.addChild(TemplateAppPermissions.Books.Create, L("Permission:Books.Create"));
    books.addChild(TemplateAppPermissions.Books.Edit, L("Permission:Books.Edit"));
    books.addChild(TemplateAppPermissions.Books.Delete, L("Permission:Books.Delete"));
  }
}
