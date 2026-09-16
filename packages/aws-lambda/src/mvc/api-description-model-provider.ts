import { Transient, getRemoteServiceMetadata, toCamelCase, type Class } from "@abp/core";
import { isIntegrationService } from "@abp/auditing";
import { AuthorizeMetadata } from "@abp/authorization";
import { ApiDescriptionModels, IApiDescriptionModelProvider, ModuleApiDescriptionModelDefaults, ParameterBindingSources, type ActionApiDescriptionModel, type ApplicationApiDescriptionModel, type ApplicationApiDescriptionModelRequestDto, type ParameterApiDescriptionModel } from "@abp/http";
import type { ParameterBinding, SchemaSource } from "./controller.js";
import { AbpRouteTableProvider, controllerNameOf } from "./mvc-middleware.js";
import type { RouteEntry } from "./router.js";

/**
 * Port of `AspNetCoreApiDescriptionModelProvider` from the route table. Parameter/return types are unknown at
 * runtime, so type names are `"object"`/`"string"` etc. derived from the bindings.
 */
@Transient(IApiDescriptionModelProvider)
export class AspNetCoreApiDescriptionModelProvider implements IApiDescriptionModelProvider {
  static readonly inject = [AbpRouteTableProvider] as const;

  constructor(private readonly routeTable: AbpRouteTableProvider) {}

  async createApiModel(_input: ApplicationApiDescriptionModelRequestDto): Promise<ApplicationApiDescriptionModel> {
    const model = ApiDescriptionModels.createApplication();
    for (const entry of this.routeTable.value.routes) {
      const remoteService = getRemoteServiceMetadata(entry.controllerType);
      if (remoteService && (remoteService.isEnabled === false || remoteService.isMetadataEnabled === false)) continue;
      const rootPath = entry.controller.area ?? ModuleApiDescriptionModelDefaults.DefaultRootPath;
      const module = ApiDescriptionModels.getOrAddModule(model, rootPath, entry.controller.remoteServiceName ?? remoteService?.name ?? ModuleApiDescriptionModelDefaults.DefaultRemoteServiceName);
      const controller = ApiDescriptionModels.getOrAddController(module, controllerNameOf(entry.controllerType), entry.controllerType.name, {
        controllerGroupName: entry.controller.groupName ?? controllerNameOf(entry.controllerType),
        isRemoteService: true,
        isIntegrationService: isIntegrationService(entry.controllerType),
      });
      const uniqueName = `${entry.controllerType.name}.${entry.action.name}`;
      if (controller.actions[uniqueName]) continue;
      ApiDescriptionModels.addAction(controller, uniqueName, this.createAction(entry, uniqueName));
    }
    ApiDescriptionModels.normalizeOrder(model);
    return model;
  }

  private createAction(entry: RouteEntry, uniqueName: string): ActionApiDescriptionModel {
    const type = entry.controllerType;
    const authorizeDatas = [...AuthorizeMetadata.getForClass(type), ...AuthorizeMetadata.getForMethod(type, entry.action.name)];
    const parameters = entry.action.bindings.map((binding, index) => this.createParameter(binding, index)).filter((p): p is ParameterApiDescriptionModel => p !== undefined);
    return {
      uniqueName,
      name: entry.action.name,
      httpMethod: entry.httpMethod,
      url: entry.template.replace(/:([A-Za-z_][\w]*)\??/g, "{$1}"),
      supportedVersions: [],
      parametersOnMethod: parameters.map((p) => ({ name: p.nameOnMethod, typeAsString: p.type ?? "object", type: p.type ?? "object", typeSimple: p.typeSimple ?? "object", isOptional: p.isOptional })),
      parameters,
      returnValue: { type: "object", typeSimple: "object" },
      allowAnonymous: AuthorizeMetadata.allowsAnonymous(type, entry.action.name) ? true : undefined,
      authorizeDatas: authorizeDatas.map((a) => ({ policy: a.policy, roles: a.roles?.join(",") })),
    };
  }

  private createParameter(binding: ParameterBinding, index: number): ParameterApiDescriptionModel | undefined {
    const nameOnMethod = `arg${index}`;
    switch (binding.source) {
      case "route":
        return { nameOnMethod, name: binding.name, jsonName: toCamelCase(binding.name), type: typeNameOf(binding.type), typeSimple: typeNameOf(binding.type), isOptional: binding.optional, bindingSourceId: ParameterBindingSources.Path };
      case "query":
        return { nameOnMethod, name: binding.name, jsonName: toCamelCase(binding.name), type: typeNameOf(binding.type), typeSimple: typeNameOf(binding.type), isOptional: binding.optional, bindingSourceId: ParameterBindingSources.Query };
      case "header":
        return { nameOnMethod, name: binding.name, jsonName: toCamelCase(binding.name), type: typeNameOf(binding.type), typeSimple: typeNameOf(binding.type), isOptional: binding.optional, bindingSourceId: ParameterBindingSources.Header };
      case "queryObject":
        return { nameOnMethod, name: "input", jsonName: "input", type: dtoName(binding.dto), typeSimple: dtoName(binding.dto), isOptional: true, bindingSourceId: ParameterBindingSources.ModelBinding };
      case "form":
        return { nameOnMethod, name: "input", jsonName: "input", type: dtoName(binding.dto), typeSimple: dtoName(binding.dto), isOptional: true, bindingSourceId: ParameterBindingSources.Form };
      case "body":
        return { nameOnMethod, name: "input", jsonName: "input", type: dtoName(binding.dto), typeSimple: dtoName(binding.dto), isOptional: binding.optional, bindingSourceId: ParameterBindingSources.Body };
      case "context":
      case "services":
        return undefined;
      default: {
        const _exhaustive: never = binding;
        return _exhaustive;
      }
    }
  }
}

function typeNameOf(type: "string" | "number" | "boolean" | "guid" | "date"): string {
  switch (type) {
    case "string":
      return "System.String";
    case "number":
      return "System.Double";
    case "boolean":
      return "System.Boolean";
    case "guid":
      return "System.Guid";
    case "date":
      return "System.DateTime";
    default: {
      const _exhaustive: never = type;
      return _exhaustive;
    }
  }
}

function dtoName(dto: SchemaSource | undefined): string {
  if (dto === undefined) return "System.Object";
  if (typeof dto === "function") return (dto as Class).name;
  return "System.Object";
}
