import { AbpException, createToken, isNullOrWhiteSpace } from "@abp/core";

/*
 * Port of `Volo.Abp.Http.Modeling` as plain data types: the JSON contract of `/api/abp/api-definition`, consumed by
 * client proxy generators. .NET builds them by reflection; here the HTTP host fills them from controller metadata.
 */

/** Port of `AuthorizeDataApiDescriptionModel`. */
export interface AuthorizeDataApiDescriptionModel {
  policy?: string;
  roles?: string;
}

/** Port of `ReturnValueApiDescriptionModel`. */
export interface ReturnValueApiDescriptionModel {
  type: string;
  typeSimple: string;
  summary?: string;
  contentTypes?: string[];
  isRemoteStream?: boolean;
}

/** Port of `MethodParameterApiDescriptionModel`. */
export interface MethodParameterApiDescriptionModel {
  name: string;
  typeAsString: string;
  type: string;
  typeSimple: string;
  isOptional: boolean;
  defaultValue?: unknown;
  summary?: string;
  description?: string;
  displayName?: string;
}

/** Port of `ParameterApiDescriptionModel`. */
export interface ParameterApiDescriptionModel {
  nameOnMethod: string;
  name: string;
  jsonName?: string;
  type?: string;
  typeSimple?: string;
  isOptional: boolean;
  defaultValue?: unknown;
  constraintTypes?: string[];
  /** `ParameterBindingSources`: "Path", "Query", "Body", "Header", "Form", "ModelBinding". */
  bindingSourceId?: string;
  descriptorName?: string;
  summary?: string;
  description?: string;
  displayName?: string;
}

/** Port of `ParameterBindingSources`. */
export const ParameterBindingSources = {
  ModelBinding: "ModelBinding",
  Body: "Body",
  Query: "Query",
  Path: "Path",
  Form: "Form",
  Header: "Header",
  Services: "Services",
  Custom: "Custom",
  FormFile: "FormFile",
} as const;

/** Port of `ActionApiDescriptionModel`. */
export interface ActionApiDescriptionModel {
  uniqueName: string;
  name: string;
  httpMethod?: string;
  url: string;
  supportedVersions?: string[];
  parametersOnMethod: MethodParameterApiDescriptionModel[];
  parameters: ParameterApiDescriptionModel[];
  returnValue: ReturnValueApiDescriptionModel;
  allowAnonymous?: boolean;
  authorizeDatas?: AuthorizeDataApiDescriptionModel[];
  implementFrom?: string;
  summary?: string;
  remarks?: string;
  description?: string;
  displayName?: string;
}

/** Port of `InterfaceMethodApiDescriptionModel`. */
export interface InterfaceMethodApiDescriptionModel {
  name: string;
  parametersOnMethod: MethodParameterApiDescriptionModel[];
  returnValue: ReturnValueApiDescriptionModel;
}

/** Port of `ControllerInterfaceApiDescriptionModel`. */
export interface ControllerInterfaceApiDescriptionModel {
  type: string;
  name: string;
  methods: InterfaceMethodApiDescriptionModel[];
}

/** Port of `ControllerApiDescriptionModel`. */
export interface ControllerApiDescriptionModel {
  controllerName: string;
  controllerGroupName?: string;
  isRemoteService: boolean;
  isIntegrationService: boolean;
  apiVersion?: string;
  type: string;
  summary?: string;
  remarks?: string;
  description?: string;
  displayName?: string;
  interfaces: ControllerInterfaceApiDescriptionModel[];
  actions: Record<string, ActionApiDescriptionModel>;
}

/** Port of `ModuleApiDescriptionModel`. */
export interface ModuleApiDescriptionModel {
  rootPath: string;
  remoteServiceName: string;
  controllers: Record<string, ControllerApiDescriptionModel>;
}

export const ModuleApiDescriptionModelDefaults = {
  DefaultRootPath: "app",
  DefaultRemoteServiceName: "Default",
} as const;

/** Port of `PropertyApiDescriptionModel`. */
export interface PropertyApiDescriptionModel {
  name: string;
  jsonName?: string;
  type: string;
  typeSimple: string;
  isRequired: boolean;
  minLength?: number;
  maxLength?: number;
  minimum?: string;
  maximum?: string;
  minimumIsExclusive?: boolean;
  maximumIsExclusive?: boolean;
  regex?: string;
  isNullable: boolean;
  summary?: string;
  description?: string;
  displayName?: string;
}

/** Port of `TypeApiDescriptionModel`. */
export interface TypeApiDescriptionModel {
  baseType?: string;
  isEnum: boolean;
  enumNames?: string[];
  enumValues?: unknown[];
  genericArguments?: string[];
  properties?: PropertyApiDescriptionModel[];
  summary?: string;
  remarks?: string;
  description?: string;
  displayName?: string;
}

/** Port of `ApplicationApiDescriptionModel`. */
export interface ApplicationApiDescriptionModel {
  modules: Record<string, ModuleApiDescriptionModel>;
  types: Record<string, TypeApiDescriptionModel>;
}

/** Port of `ApplicationApiDescriptionModelRequestDto`. */
export interface ApplicationApiDescriptionModelRequestDto {
  includeTypes?: boolean;
  includeDescriptions?: boolean;
}

/** Port of `IApiDescriptionModelProvider`. */
export interface IApiDescriptionModelProvider {
  createApiModel(input: ApplicationApiDescriptionModelRequestDto): Promise<ApplicationApiDescriptionModel>;
}
export const IApiDescriptionModelProvider = createToken<IApiDescriptionModelProvider>("IApiDescriptionModelProvider");

/* Ports of the static `Create`/`AddX`/`GetOrAddX` members as functions. */

export const ApiDescriptionModels = {
  createApplication(): ApplicationApiDescriptionModel {
    return { modules: {}, types: {} };
  },

  createModule(rootPath: string, remoteServiceName: string): ModuleApiDescriptionModel {
    return { rootPath, remoteServiceName, controllers: {} };
  },

  addModule(application: ApplicationApiDescriptionModel, module: ModuleApiDescriptionModel): ModuleApiDescriptionModel {
    if (application.modules[module.rootPath]) throw new AbpException(`There is already a module with same root path: ${module.rootPath}`);
    application.modules[module.rootPath] = module;
    return module;
  },

  getOrAddModule(application: ApplicationApiDescriptionModel, rootPath: string, remoteServiceName: string): ModuleApiDescriptionModel {
    return (application.modules[rootPath] ??= ApiDescriptionModels.createModule(rootPath, remoteServiceName));
  },

  createController(controllerName: string, type: string, init: Partial<Omit<ControllerApiDescriptionModel, "controllerName" | "type" | "actions">> = {}): ControllerApiDescriptionModel {
    return { controllerName, type, isRemoteService: true, isIntegrationService: false, interfaces: [], actions: {}, ...init };
  },

  addController(module: ModuleApiDescriptionModel, controller: ControllerApiDescriptionModel): ControllerApiDescriptionModel {
    if (module.controllers[controller.type]) throw new AbpException(`There is already a controller with type: ${controller.type} in module: ${module.rootPath}`);
    module.controllers[controller.type] = controller;
    return controller;
  },

  getOrAddController(module: ModuleApiDescriptionModel, controllerName: string, type: string, init: Partial<Omit<ControllerApiDescriptionModel, "controllerName" | "type" | "actions">> = {}): ControllerApiDescriptionModel {
    const key = isNullOrWhiteSpace(init.apiVersion) ? type : `${init.apiVersion}.${type}`;
    return (module.controllers[key] ??= ApiDescriptionModels.createController(controllerName, type, init));
  },

  addAction(controller: ControllerApiDescriptionModel, uniqueName: string, action: ActionApiDescriptionModel): ActionApiDescriptionModel {
    if (controller.actions[uniqueName]) {
      throw new AbpException(`Can not add more than one action with same name to the same controller. Controller: ${controller.controllerName}, Action: ${action.name}.`);
    }
    controller.actions[uniqueName] = action;
    return action;
  },

  /** Port of `CreateSubModel`: filters modules/controllers/actions by name. */
  createSubModel(application: ApplicationApiDescriptionModel, modules?: string[], controllers?: string[], actions?: string[]): ApplicationApiDescriptionModel {
    const subModel = ApiDescriptionModels.createApplication();
    for (const module of Object.values(application.modules)) {
      if (modules && !modules.includes(module.rootPath)) continue;
      const subModule = ApiDescriptionModels.createModule(module.rootPath, module.remoteServiceName);
      for (const controller of Object.values(module.controllers)) {
        if (controllers && !controllers.includes(controller.controllerName)) continue;
        const subController: ControllerApiDescriptionModel = { ...controller, actions: {} };
        for (const [key, action] of Object.entries(controller.actions)) {
          if (!actions || actions.includes(key)) subController.actions[key] = action;
        }
        ApiDescriptionModels.addController(subModule, subController);
      }
      ApiDescriptionModels.addModule(subModel, subModule);
    }
    return subModel;
  },

  normalizeOrder(application: ApplicationApiDescriptionModel): void {
    application.modules = Object.fromEntries(Object.entries(application.modules).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  },
};
