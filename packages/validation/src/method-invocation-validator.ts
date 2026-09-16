import { AbpException, createToken, Transient, type Class } from "@abp/core";
import { AbpValidationException } from "./abp-validation-exception.js";
import { IObjectValidator } from "./object-validator.js";
import { ValidationMetadata } from "./validation-attributes.js";
import { AbpValidationResult, type IAbpValidationResult } from "./validation-result.js";

/** Port of `ParameterInfo` as far as validation needs it. */
export interface MethodParameterInfo {
  readonly name: string;
  readonly index: number;
  readonly allowNull: boolean;
}

/**
 * Port of `MethodInvocationValidationContext`. Without reflection the parameter list is derived from the
 * argument count and the method's declared arity; names are best-effort (`arg{i}` when not recoverable).
 */
export class MethodInvocationValidationContext extends AbpValidationResult {
  readonly parameters: readonly MethodParameterInfo[];

  constructor(
    readonly targetObject: object | undefined,
    readonly targetType: Class,
    readonly method: string,
    readonly parameterValues: readonly unknown[],
  ) {
    super();
    this.parameters = describeParameters(targetType, method, parameterValues.length);
  }
}

function describeParameters(targetType: Class, method: string, argumentCount: number): MethodParameterInfo[] {
  const fn: unknown = (targetType.prototype as Record<string, unknown>)[method];
  const declared = typeof fn === "function" ? fn.length : 0;
  const names = typeof fn === "function" ? parseParameterNames(fn) : [];
  const required = new Set(ValidationMetadata.requiredParameterIndexes(targetType, method));
  const count = Math.max(declared, argumentCount);
  const parameters: MethodParameterInfo[] = [];
  for (let index = 0; index < count; index++) {
    parameters.push({ name: names[index] ?? `arg${index}`, index, allowNull: !required.has(index) });
  }
  return parameters;
}

function parseParameterNames(fn: object): string[] {
  const source = Function.prototype.toString.call(fn);
  const start = source.indexOf("(");
  const end = source.indexOf(")");
  if (start < 0 || end < start) return [];
  return source
    .slice(start + 1, end)
    .split(",")
    .map((p) => p.replace(/\/\*.*?\*\//g, "").trim().replace(/^\.\.\./, "").split(/[=:\s{[]/)[0] ?? "")
    .filter((p) => /^[A-Za-z_$][\w$]*$/.test(p));
}

/** Port of `IMethodInvocationValidator`. */
export interface IMethodInvocationValidator {
  validateAsync(context: MethodInvocationValidationContext): Promise<void>;
}
export const IMethodInvocationValidator = createToken<IMethodInvocationValidator>("IMethodInvocationValidator");

/** Port of `MethodInvocationValidator`. */
@Transient(IMethodInvocationValidator)
export class MethodInvocationValidator implements IMethodInvocationValidator {
  static readonly inject = [IObjectValidator] as const;
  constructor(private readonly objectValidator: IObjectValidator) {}

  async validateAsync(context: MethodInvocationValidationContext): Promise<void> {
    if (!context) throw new AbpException("context can not be null!");
    if (context.parameters.length === 0) return;
    if (this.isValidationDisabled(context)) return;

    if (context.errors.length > 0 && this.hasSingleNullArgument(context)) this.throwValidationError(context);

    await this.addMethodParameterValidationErrorsAsync(context);

    if (context.errors.length > 0) this.throwValidationError(context);
  }

  protected isValidationDisabled(context: MethodInvocationValidationContext): boolean {
    if (ValidationMetadata.isEnabledForMethod(context.targetType, context.method)) return false;
    return ValidationMetadata.isDisabledForMethod(context.targetType, context.method) || ValidationMetadata.isDisabledForClass(context.targetType);
  }

  protected hasSingleNullArgument(context: MethodInvocationValidationContext): boolean {
    return context.parameters.length === 1 && (context.parameterValues[0] === null || context.parameterValues[0] === undefined);
  }

  protected throwValidationError(context: MethodInvocationValidationContext): never {
    throw new AbpValidationException("Method arguments are not valid! See validationErrors for details.", context.errors);
  }

  protected async addMethodParameterValidationErrorsAsync(context: MethodInvocationValidationContext): Promise<void> {
    for (const parameter of context.parameters) {
      await this.addMethodParameterValidationErrorsForAsync(context, parameter, context.parameterValues[parameter.index]);
    }
  }

  protected async addMethodParameterValidationErrorsForAsync(context: IAbpValidationResult, parameter: MethodParameterInfo, parameterValue: unknown): Promise<void> {
    context.errors.push(...(await this.objectValidator.getErrorsAsync(parameterValue, parameter.name, parameter.allowNull)));
  }
}
