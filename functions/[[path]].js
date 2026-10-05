const API_PATHS = ["/api/", "/auth/", "/internal/"];
const DEFAULT_GAS_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbyoset4GXE3nQi6kXJvhiBOzLX-OP0_PxaxlHlzB66en5qpiQGEL67DPY48oeGhrqbc/exec";

export async function onRequest(context) {
  const { request, env } = context;
  const incoming = new URL(request.url);

  if (!API_PATHS.some(prefix => incoming.pathname.startsWith(prefix))) {
    return context.next();
  }

  // Private D1 endpoints are never Apps Script API routes. Always send them
  // to the D1 handler, even while public API auth is in migration mode.
  if (incoming.pathname.startsWith("/internal/") || String(env.D1_AUTH_MODE || "").toLowerCase() === "enabled") {
    const { handleD1 } = await import("./_lib/d1-auth.js");
    return handleD1(context);
  }

  const route = incoming.pathname;
  const authorization = request.headers.get("Authorization") || "";
  const sessionToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  let data = {};
  if (!['GET', 'HEAD'].includes(request.method)) data = await request.json().catch(() => ({}));
  return proxyToAppsScript(context, route, incoming, sessionToken, data);
}

export async function proxyToAppsScript(context, route, incoming, sessionToken, data) {
  const { env } = context;
  const { request } = context;
  const webAppUrl = String(env.GAS_WEB_APP_URL || DEFAULT_GAS_WEB_APP_URL).trim();

  let target;
  try {
    target = new URL(webAppUrl);
  } catch {
    return Response.json({ detail: "GAS_WEB_APP_URL must be a valid HTTPS URL." }, { status: 503 });
  }
  if (target.protocol !== "https:" || target.hostname !== "script.google.com") {
    return Response.json({ detail: "GAS_WEB_APP_URL must be a Google Apps Script HTTPS web-app URL." }, { status: 503 });
  }

  const params = Object.fromEntries(incoming.searchParams.entries());
  const upstreamRequest = new Request(target.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ route, method: request.method, params, sessionToken, data,
      workerSecret: env.LVFR_D1_WORKER_SECRET || "" }),
    // Apps Script ContentService returns its body from a one-time
    // script.googleusercontent.com URL. Let Fetch follow the redirect as part
    // of the original request lifecycle; manually replaying it as a GET can
    // lose redirect semantics or produce a stale /macros/echo response.
    redirect: "follow",
  });

  let upstream;
  try {
    upstream = await fetch(upstreamRequest);
  } catch (error) {
    console.error('Apps Script request failed before receiving a response:', error);
    return Response.json({
      detail: "Cloudflare could not connect to the Apps Script web app. Check its deployment URL and availability."
    }, { status: 502 });
  }

  let payload;
  const finalUrl = (() => {
    try {
      const url = new URL(upstream.url);
      return `${url.origin}${url.pathname}`;
    } catch {
      return "unknown";
    }
  })();
  const contentType = upstream.headers.get('content-type') || 'unknown';
  try {
    payload = JSON.parse(await upstream.text());
  } catch (error) {
    console.error('Apps Script returned a non-JSON response:', {
      status: upstream.status,
      contentType,
      finalUrl,
      error,
    });
    const isGoogleusercontentEcho = finalUrl.startsWith('https://script.googleusercontent.com/macros/echo');
    const detail = isGoogleusercontentEcho
      ? `Apps Script redirected /exec to its ContentService response URL, but that URL returned HTTP ${upstream.status} (${contentType}). Check that GAS_WEB_APP_URL is the current /exec URL and that the web app is deployed to execute as you and allow access to users. If the URL is correct, redeploy the web app and retry; do not use the googleusercontent URL as GAS_WEB_APP_URL.`
      : `Apps Script returned a non-JSON response (HTTP ${upstream.status}, ${contentType}) from ${finalUrl}. Check that GAS_WEB_APP_URL points to the active Apps Script /exec deployment, executes as you, and allows access to users.`;
    return Response.json({ detail }, { status: 502 });
  }

  if (!payload || typeof payload !== 'object' || typeof payload.ok !== 'boolean') {
    console.error('Apps Script response did not use the expected API format:', {
      status: upstream.status,
      finalUrl,
    });
    return Response.json({
      detail: `The deployed Apps Script is not running the expected API version (HTTP ${upstream.status}). Replace Code.gs and deploy a new version.`
    }, { status: 502 });
  }

  if (!payload.ok) {
    const message = payload.error || "The request was rejected.";
    if (route === "/internal/loi" && /sign in with your name and password|session expired/i.test(message)) {
      return Response.json({ detail: "The deployed Apps Script is missing the internal LOI handler. Deploy the current apps-script/Code.gs as a new web-app version, then try again." }, { status: 502 });
    }
    const status = /sign in again|access token/i.test(message) ? 401 : 400;
    return Response.json({ detail: message }, { status });
  }
  return Response.json(payload.data);
}
