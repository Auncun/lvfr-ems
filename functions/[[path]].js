const API_PATHS = ["/api/", "/auth/"];
const DEFAULT_GAS_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbyBdjIEgSN1LZButFPrJA1C9_6w3xClnX370rDRic7fMqkVKsjw5uw0EX8gw4vO-Tav/exec";

export async function onRequest(context) {
  const { request, env } = context;
  const incoming = new URL(request.url);

  if (!API_PATHS.some(prefix => incoming.pathname.startsWith(prefix))) {
    return context.next();
  }

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

  const route = incoming.pathname;
  const params = Object.fromEntries(incoming.searchParams.entries());
  const authorization = request.headers.get("Authorization") || "";
  const accessToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";

  let data = {};
  if (!['GET', 'HEAD'].includes(request.method)) {
    data = await request.json().catch(() => ({}));
  }
  const upstreamRequest = new Request(target.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ route, method: request.method, params, accessToken, data }),
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
    return Response.json({
      detail: `Apps Script returned a non-JSON response (HTTP ${upstream.status}, ${contentType}) from ${finalUrl}. Check the Cloudflare GAS_WEB_APP_URL override and confirm the Apps Script /exec deployment is active, executes as you, and allows access to users.`
    }, { status: 502 });
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
    const status = /sign in again|access token/i.test(message) ? 401 : 400;
    return Response.json({ detail: message }, { status });
  }
  return Response.json(payload.data);
}
