import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AbpApplication, ConfigurationBuilder, type AbpApplicationCreationOptions, type IConfiguration, type ModuleClass } from "@abp/core";

/** `App:Database` (`ABP__App__Database`): the persistence/provider set the host starts with. */
export type TemplateAppDatabase = "DynamoDb" | "Memory";

export const TemplateAppConfigurationKeys = {
  Database: "App:Database",
  SelfUrl: "App:SelfUrl",
} as const;

/** The directory holding `appsettings*.json`: next to the bundle on Lambda, the package root under `tsx`. */
export function configurationBasePath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return existsSync(join(here, "appsettings.json")) ? here : dirname(here);
}

export function environmentName(fallback = "Production"): string {
  return process.env["ABP_ENVIRONMENT"] ?? fallback;
}

/** The configuration the application will see, built before the startup module is chosen. */
export function buildConfiguration(environment: string): IConfiguration {
  return new ConfigurationBuilder().addDefaults({ basePath: configurationBasePath(), environmentName: environment }).build();
}

export function resolveDatabase(configuration: IConfiguration): TemplateAppDatabase {
  const value = configuration.get(TemplateAppConfigurationKeys.Database)?.trim().toLowerCase();
  if (value === undefined || value === "" || value === "dynamodb") return "DynamoDb";
  if (value === "memory") return "Memory";
  throw new Error(`Unknown ${TemplateAppConfigurationKeys.Database} value '${value}'; expected 'DynamoDb' or 'Memory'.`);
}

/**
 * Loads the startup module of a database lazily: the AWS provider classes register themselves in the DI container
 * the moment their module file is imported (port of assembly scanning), so the memory host must never import them.
 */
export async function loadStartupModule(database: TemplateAppDatabase): Promise<ModuleClass> {
  if (database === "Memory") return (await import("./template-app-local-module.js")).TemplateAppLocalModule;
  return (await import("./template-app-host-module.js")).TemplateAppHostModule;
}

export interface TemplateAppCreationOptions extends Omit<AbpApplicationCreationOptions, "configuration"> {
  /** Extra in-memory configuration values (tests, `pnpm seed --tenant`). */
  configurationValues?: Record<string, unknown>;
}

/** Creates and initializes the application with `appsettings.json` + environment variables as configuration. */
export async function createApplication(startupModule: ModuleClass, options: TemplateAppCreationOptions = {}): Promise<AbpApplication> {
  const { configurationValues, ...rest } = options;
  const environment = rest.environment ?? environmentName();
  const app = await AbpApplication.create(startupModule, {
    applicationName: "TemplateApp",
    ...rest,
    environment,
    configuration: { basePath: configurationBasePath(), environmentName: environment, values: configurationValues },
  });
  await app.initialize();
  return app;
}

let hostApplication: Promise<AbpApplication> | undefined;

/**
 * The application of the Lambda handlers: created once per container (concurrent cold-start invocations await the
 * same promise) with the startup module `App:Database` selects, so tests can run the real handlers on memory.
 */
export function createHostApplication(): Promise<AbpApplication> {
  hostApplication ??= (async () => {
    const environment = environmentName();
    const database = resolveDatabase(buildConfiguration(environment));
    return createApplication(await loadStartupModule(database), { environment });
  })().catch((e: unknown) => {
    hostApplication = undefined;
    throw e;
  });
  return hostApplication;
}

/** The `pnpm dev` application: in-memory providers, `Development` settings unless `ABP_ENVIRONMENT` says otherwise. */
export async function createLocalApplication(options: TemplateAppCreationOptions = {}): Promise<AbpApplication> {
  return createApplication(await loadStartupModule("Memory"), { environment: environmentName("Development"), ...options });
}
