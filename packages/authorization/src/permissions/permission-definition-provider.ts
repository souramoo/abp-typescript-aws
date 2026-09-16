import { createClassMarker, type AbstractClass } from "@abp/core";
import type { IPermissionDefinitionContext } from "./permission-definition-context.js";

/**
 * Port of `IPermissionDefinitionProvider`. Implementations are discovered by the `IPermissionDefinitionProvider`
 * class marker (subclasses of `PermissionDefinitionProvider` carry it automatically; other classes use
 * `@IPermissionDefinitionProvider()`) and added to `AbpPermissionOptions.definitionProviders`.
 */
export interface IPermissionDefinitionProvider {
  preDefine(context: IPermissionDefinitionContext): void;
  define(context: IPermissionDefinitionContext): void;
  postDefine(context: IPermissionDefinitionContext): void;
}
export const IPermissionDefinitionProvider = createClassMarker("IPermissionDefinitionProvider");

/** Port of `PermissionDefinitionProvider`. Concrete subclasses need their own `@Transient()`. */
export abstract class PermissionDefinitionProvider implements IPermissionDefinitionProvider {
  preDefine(_context: IPermissionDefinitionContext): void {}
  abstract define(context: IPermissionDefinitionContext): void;
  postDefine(_context: IPermissionDefinitionContext): void {}
}
IPermissionDefinitionProvider.mark(PermissionDefinitionProvider as AbstractClass);
