/** Port of `ExtensionPropertyLookupConfiguration`. */
export class ExtensionPropertyLookupConfiguration {
  url: string | undefined;
  resultListPropertyName = "items";
  displayPropertyName = "text";
  valuePropertyName = "id";
  filterParamName = "filter";
}

/** Port of `ObjectExtensionPropertyInfo.ExtensionPropertyUI` and its modal records. */
export interface ExtensionPropertyUIModal {
  isVisible: boolean;
  isReadOnly: boolean;
}

export interface ExtensionPropertyUI {
  order: number;
  createModal: ExtensionPropertyUIModal;
  editModal: ExtensionPropertyUIModal;
}

export function createExtensionPropertyUI(): ExtensionPropertyUI {
  return { order: 0, createModal: { isVisible: true, isReadOnly: false }, editModal: { isVisible: true, isReadOnly: false } };
}

/** Port of `ExtensionPropertyPolicyConfiguration` and its parts. */
export interface ExtensionPropertyGlobalFeaturePolicyConfiguration {
  features: string[];
  requiresAll: boolean;
}
export interface ExtensionPropertyFeaturePolicyConfiguration {
  features: string[];
  requiresAll: boolean;
}
export interface ExtensionPropertyPermissionPolicyConfiguration {
  permissionNames: string[];
  requiresAll: boolean;
}
export interface ExtensionPropertyPolicyConfiguration {
  globalFeatures: ExtensionPropertyGlobalFeaturePolicyConfiguration;
  features: ExtensionPropertyFeaturePolicyConfiguration;
  permissions: ExtensionPropertyPermissionPolicyConfiguration;
}

export function createExtensionPropertyPolicy(): ExtensionPropertyPolicyConfiguration {
  return { globalFeatures: { features: [], requiresAll: false }, features: { features: [], requiresAll: false }, permissions: { permissionNames: [], requiresAll: false } };
}
