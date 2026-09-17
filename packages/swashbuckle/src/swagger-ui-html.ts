export interface SwaggerUiDocumentLink {
  readonly url: string;
  readonly name: string;
}

export interface SwaggerUiHtmlOptions {
  readonly documents: readonly SwaggerUiDocumentLink[];
  readonly documentTitle: string;
  readonly swaggerUiVersion: string;
  /** Absolute path of the OAuth2 redirect page (`/swagger/oauth2-redirect.html`); the origin is added in the browser. */
  readonly oauth2RedirectPath: string;
  readonly oauthClientId?: string;
  readonly oauthScopes?: readonly string[];
  readonly appPath?: string;
}

export function swaggerUiCdnUrl(version: string): string {
  return `https://cdn.jsdelivr.net/npm/swagger-ui-dist@${version}`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** JSON that is safe inside a `<script>` element. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

/**
 * Port of `wwwroot/swagger/ui/abp.swagger.js`: wraps the request interceptor (adds the `__tenant` header typed into
 * the tenant box and `X-Requested-With`) and completes the OAuth2 redirect through `localStorage`, the way ABP's
 * `oauth2-redirect.html` hands the result back.
 */
const abpSwaggerScript = `var abp = abp || {};
(function () {
  var tenantKey = "abp_swagger_tenant";
  var input = document.getElementById("abp-tenant");
  try { input.value = localStorage.getItem(tenantKey) || ""; } catch (e) { /* storage unavailable */ }
  input.addEventListener("change", function () {
    try { localStorage.setItem(tenantKey, input.value); } catch (e) { /* storage unavailable */ }
  });
  abp.swagger = {
    requestInterceptor: function (request) {
      var tenant = input.value.trim();
      if (tenant && !request.headers["__tenant"]) request.headers["__tenant"] = tenant;
      if (!request.headers["X-Requested-With"]) request.headers["X-Requested-With"] = "XMLHttpRequest";
      return request;
    }
  };
  window.addEventListener("storage", function (event) {
    if (event.key !== "abp_swagger_oauth2" || !event.newValue) return;
    var qp = JSON.parse(event.newValue || "{}");
    localStorage.removeItem("abp_swagger_oauth2");
    var oauth2 = window.swaggerUIRedirectOauth2;
    if (!oauth2) return;
    var sentState = oauth2.state;
    var redirectUrl = oauth2.redirectUrl;
    var isValid = qp.state === sentState;
    var flow = oauth2.auth.schema.get("flow");
    if ((flow === "accessCode" || flow === "authorizationCode" || flow === "authorization_code") && !oauth2.auth.code) {
      if (!isValid) {
        oauth2.errCb({ authId: oauth2.auth.name, source: "auth", level: "warning", message: "Authorization may be unsafe, passed state was changed in server. The passed state wasn't returned from auth server." });
      }
      if (qp.code) {
        delete oauth2.state;
        oauth2.auth.code = qp.code;
        oauth2.callback({ auth: oauth2.auth, redirectUrl: redirectUrl });
      } else {
        var message = qp.error ? "[" + qp.error + "]: " + (qp.error_description ? qp.error_description + ". " : "no accessCode received from the server. ") + (qp.error_uri ? "More info: " + qp.error_uri : "") : "";
        oauth2.errCb({ authId: oauth2.auth.name, source: "auth", level: "error", message: message || "[Authorization failed]: no accessCode received from the server." });
      }
    } else {
      oauth2.callback({ auth: oauth2.auth, token: qp, isValid: isValid, redirectUrl: redirectUrl });
    }
  });
})();`;

/** Port of ABP's `wwwroot/swagger/oauth2-redirect.html`, served same-origin so the opener page can read the result. */
export const oauth2RedirectHtml = `<!doctype html>
<html lang="en-US">
<head><meta charset="utf-8"><title>Swagger UI: OAuth2 Redirect</title></head>
<body>
<script>
'use strict';
function run() {
  var qp, arr;
  if (/code|token|error/.test(window.location.hash)) {
    qp = window.location.hash.substring(1).replace('?', '&');
  } else {
    qp = location.search.substring(1);
  }
  arr = qp.split("&");
  arr.forEach(function (v, i, _arr) { _arr[i] = '"' + v.replace('=', '":"') + '"'; });
  qp = qp ? JSON.parse('{' + arr.join() + '}', function (key, value) { return key === "" ? value : decodeURIComponent(value); }) : {};
  localStorage.setItem("abp_swagger_oauth2", JSON.stringify(qp));
  window.close();
}
if (document.readyState !== 'loading') { run(); } else { document.addEventListener('DOMContentLoaded', function () { run(); }); }
</script>
</body>
</html>
`;

/**
 * Port of Swashbuckle's `index.html` as customised by `UseAbpSwaggerUI`: swagger-ui-dist from the CDN,
 * `SwaggerUIBundle` initialised with the document URLs, `initOAuth` with the ABP client and the ABP request
 * interceptor (tenant header) injected.
 */
export function swaggerUiHtml(options: SwaggerUiHtmlOptions): string {
  const cdn = swaggerUiCdnUrl(options.swaggerUiVersion);
  const config = {
    urls: options.documents,
    oauth2RedirectPath: options.oauth2RedirectPath,
    oauth: { clientId: options.oauthClientId ?? "", scopes: [...(options.oauthScopes ?? [])] },
    appPath: options.appPath ?? "/",
  };
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(options.documentTitle)}</title>
  <link rel="stylesheet" href="${cdn}/swagger-ui.css">
  <style>
    html { box-sizing: border-box; overflow-y: scroll; }
    *, *:before, *:after { box-sizing: inherit; }
    body { margin: 0; background: #fafafa; }
    #abp-tenant-bar { display: flex; align-items: center; gap: .5rem; padding: .5rem 1.25rem; background: #1b1b1b; color: #fff; font: 14px sans-serif; }
    #abp-tenant-bar input { padding: .25rem .5rem; border: 1px solid #555; border-radius: 4px; min-width: 16rem; }
  </style>
</head>
<body>
  <div id="abp-tenant-bar">
    <label for="abp-tenant">__tenant</label>
    <input id="abp-tenant" type="text" placeholder="tenant name or id (empty = host)" autocomplete="off">
  </div>
  <div id="swagger-ui"></div>
  <script src="${cdn}/swagger-ui-bundle.js" charset="utf-8"></script>
  <script src="${cdn}/swagger-ui-standalone-preset.js" charset="utf-8"></script>
  <script>
${abpSwaggerScript}
  </script>
  <script>
    window.onload = function () {
      var config = ${scriptJson(config)};
      abp.appPath = config.appPath;
      var ui = SwaggerUIBundle({
        urls: config.urls,
        dom_id: "#swagger-ui",
        deepLinking: true,
        presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
        plugins: [SwaggerUIBundle.plugins.DownloadUrl],
        layout: "StandaloneLayout",
        oauth2RedirectUrl: window.location.origin + config.oauth2RedirectPath,
        requestInterceptor: abp.swagger.requestInterceptor
      });
      ui.initOAuth({ clientId: config.oauth.clientId, scopes: config.oauth.scopes, usePkceWithAuthorizationCodeGrant: true });
      window.ui = ui;
    };
  </script>
</body>
</html>
`;
}
