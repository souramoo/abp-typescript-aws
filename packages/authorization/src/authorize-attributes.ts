import { createMethodMetadata, getMethodNames, type Class } from "@abp/core";

/** Port of `IAuthorizeData`: the data of one `[Authorize]` attribute. */
export interface AuthorizeData {
  readonly policy?: string;
  readonly roles?: readonly string[];
}

const authorizeMetadata = createMethodMetadata<readonly AuthorizeData[]>("Authorize");
const allowAnonymousMetadata = createMethodMetadata<boolean>("AllowAnonymous");

type ClassOrMethodDecorator = (target: object, propertyKey?: string | symbol, descriptor?: PropertyDescriptor) => void;

/**
 * Port of `[Authorize]` / `[Authorize("Policy")]` / `[Authorize(Roles = "a,b")]` on a class or a method.
 * May be applied several times; attributes of base classes and overridden methods are inherited, like .NET.
 */
export function Authorize(policy?: string | AuthorizeData): ClassOrMethodDecorator {
  const data: AuthorizeData = typeof policy === "string" ? { policy } : (policy ?? {});
  return (target, propertyKey) => {
    if (propertyKey === undefined) {
      const type = target as Class;
      authorizeMetadata.setForClass(type, [...(authorizeMetadata.getForClass(type) ?? []), data]);
      return;
    }
    const type = (target as { constructor: Class }).constructor;
    authorizeMetadata([...(authorizeMetadata.get(type, String(propertyKey)) ?? []), data])(target, propertyKey);
  };
}

/** Port of `[AllowAnonymous]` on a method (or on a class, which then applies to all of its methods). */
export function AllowAnonymous(): ClassOrMethodDecorator {
  return (target, propertyKey) => {
    if (propertyKey === undefined) allowAnonymousMetadata.setForClass(target as Class, true);
    else allowAnonymousMetadata(true)(target, propertyKey);
  };
}

export const AuthorizeMetadata = {
  getForClass(type: Class | undefined): readonly AuthorizeData[] {
    return authorizeMetadata.getForClass(type) ?? [];
  },
  getForMethod(type: Class | undefined, method: string): readonly AuthorizeData[] {
    return authorizeMetadata.get(type, method) ?? [];
  },
  /** `[AllowAnonymous]` on the method itself or on its class. */
  allowsAnonymous(type: Class | undefined, method: string): boolean {
    return allowAnonymousMetadata.get(type, method) === true || allowAnonymousMetadata.getForClass(type) === true;
  },
  /** Port of `AuthorizationInterceptorRegistrar.ShouldIntercept`: the class or any of its methods is decorated. */
  hasAny(type: Class): boolean {
    return AuthorizeMetadata.getForClass(type).length > 0 || getMethodNames(type).some((m) => AuthorizeMetadata.getForMethod(type, m).length > 0);
  },
};
