/**
 * Port of `SwaggerUIOptions` as configured by `UseAbpSwaggerUI`. Lambda ships no static files, so the Swagger UI
 * assets are loaded from the swagger-ui-dist package on the jsDelivr CDN instead of the embedded resources.
 */
export class AbpSwaggerUIOptions {
  /** Port of `RoutePrefix`: the UI lives at `/{routePrefix}` and the documents at `/{routePrefix}/{name}/swagger.json`. */
  routePrefix = "swagger";
  documentTitle = "Swagger UI";
  /** Port of `OAuthClientId`: pre-filled in the Authorize dialog (the template uses `TemplateApp_App`). */
  oauthClientId: string | undefined = undefined;
  /** Port of `OAuthScopes`. */
  oauthScopes: string[] = [];
  /** The swagger-ui-dist version fetched from `https://cdn.jsdelivr.net/npm/swagger-ui-dist@<version>/`. */
  swaggerUiVersion = "5.17.14";
  /** Port of `AbpAppPath`: the base path of the API when it is mounted under a stage prefix (`/`, `/prod/`). */
  appPath = "/";
}
