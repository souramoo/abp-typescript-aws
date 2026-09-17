import { Transient, optionsToken, type IOptions } from "@abp/core";
import { Controller, DisableAbpFeatures, HttpGet, HttpResult, route, type ControllerOptions } from "@abp/aws-lambda";
import { HttpStatusCode, MimeTypes, RemoteServiceErrorInfo, RemoteServiceErrorResponse } from "@abp/http";
import { AbpSwaggerGenOptions, swaggerDocuments } from "./abp-swagger-gen-options.js";
import { AbpSwaggerUIOptions } from "./abp-swagger-ui-options.js";
import { ApiExplorerSettings } from "./api-explorer.js";
import { IOpenApiDocumentGenerator } from "./openapi-document-generator.js";
import { oauth2RedirectHtml, swaggerUiHtml } from "./swagger-ui-html.js";

const htmlContentType = `${MimeTypes.Text.Html}; charset=utf-8`;
const jsonContentType = `${MimeTypes.Application.Json}; charset=utf-8`;

/** `[RemoteService(false)]` + `[ApiExplorerSettings(IgnoreApi = true)]` of the .NET `AbpSwashbuckleController`. */
export const swaggerControllerOptions: ControllerOptions = { isRemoteServiceEnabled: false, isMetadataEnabled: false };

export function normalizeRoutePrefix(routePrefix: string): string {
  return routePrefix.replace(/^\/+|\/+$/g, "");
}

/**
 * Port of the Swashbuckle middlewares (`UseSwagger` + `UseAbpSwaggerUI`) as a controller, since Lambda serves no
 * static files: `/{routePrefix}` and `/{routePrefix}/index.html` render the UI, `/{routePrefix}/{name}/swagger.json`
 * the document, `/{routePrefix}/oauth2-redirect.html` ABP's redirect page. `AbpSwashbuckleModule` re-routes the
 * controller when `AbpSwaggerUIOptions.routePrefix` is changed.
 */
@Transient()
@DisableAbpFeatures({ disableAuditing: true, disableUnitOfWork: true })
@ApiExplorerSettings({ ignoreApi: true })
@Controller("swagger", swaggerControllerOptions)
export class AbpSwaggerController {
  static readonly inject = [IOpenApiDocumentGenerator, optionsToken(AbpSwaggerGenOptions), optionsToken(AbpSwaggerUIOptions)] as const;

  constructor(
    private readonly generator: IOpenApiDocumentGenerator,
    private readonly genOptions: IOptions<AbpSwaggerGenOptions>,
    private readonly uiOptions: IOptions<AbpSwaggerUIOptions>,
  ) {}

  @HttpGet("")
  async index(): Promise<HttpResult> {
    return this.page();
  }

  @HttpGet("index.html")
  async indexHtml(): Promise<HttpResult> {
    return this.page();
  }

  @HttpGet(":documentName/swagger.json", route("documentName"))
  async swaggerJson(documentName: string): Promise<HttpResult> {
    if (!this.generator.documentNames.includes(documentName)) {
      const error = new RemoteServiceErrorResponse(new RemoteServiceErrorInfo(`The Swagger document '${documentName}' is not configured.`));
      return new HttpResult(HttpStatusCode.NotFound, JSON.stringify(error), jsonContentType);
    }
    return new HttpResult(HttpStatusCode.OK, JSON.stringify(this.generator.getDocument(documentName)), jsonContentType);
  }

  @HttpGet("oauth2-redirect.html")
  async oauth2Redirect(): Promise<HttpResult> {
    return new HttpResult(HttpStatusCode.OK, oauth2RedirectHtml, htmlContentType);
  }

  protected page(): HttpResult {
    const ui = this.uiOptions.value;
    const base = `${ui.appPath.endsWith("/") ? ui.appPath : `${ui.appPath}/`}${normalizeRoutePrefix(ui.routePrefix)}`;
    const html = swaggerUiHtml({
      documents: swaggerDocuments(this.genOptions.value).map((document) => ({ url: `${base}/${document.name}/swagger.json`, name: `${document.title} ${document.version}` })),
      documentTitle: ui.documentTitle,
      swaggerUiVersion: ui.swaggerUiVersion,
      oauth2RedirectPath: `${base}/oauth2-redirect.html`,
      oauthClientId: ui.oauthClientId,
      oauthScopes: ui.oauthScopes,
      appPath: ui.appPath,
    });
    return new HttpResult(HttpStatusCode.OK, html, htmlContentType);
  }
}
