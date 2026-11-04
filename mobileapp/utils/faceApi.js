const diagnostics = typeof __DEV__ === "boolean" && __DEV__;
import { mobileApiUrl, classifyConnectivityFailure } from "./apiConfiguration.js";

function responseError(message, status, code = "API_RESPONSE_FORMAT") {
  return Object.assign(new Error(message), { status, code });
}

export function normalizeFaceUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
    return url.toString().replace(/\/$/, "");
  } catch { return null; }
}
export function faceCameraConfigured() {
  try { return Boolean(mobileApiUrl("face")); } catch { return false; }
}

export async function parseFaceResponse(response) {
  const raw = await response.text();
  const status = response.status;
  if (!raw.trim()) {
    if (status === 401 || status === 403) throw responseError(`Backend access denied (HTTP ${status}). The tunnel may require sign-in. Check its access configuration.`, status, "API_HTTP_ERROR");
    if ([502, 503, 504].includes(status)) throw responseError(`Backend is unreachable through the tunnel (HTTP ${status}). Keep the authentication service running and check /health.`, status, "API_HTTP_ERROR");
    throw responseError(`Backend returned an empty response (HTTP ${status}). Check /health and the authentication service.`, status);
  }
  let result;
  try { result = JSON.parse(raw); }
  catch { throw responseError(`Backend returned a non-JSON response (HTTP ${status}). Check the configured URL and tunnel access.`, status); }
  if (!result || typeof result !== "object" || Array.isArray(result)) throw responseError("Backend returned an invalid response.", status);
  if (!response.ok) {
    const message = typeof result.error === "string" ? result.error : `Backend request failed (HTTP ${status}).`;
    const reference = /^[a-f0-9]{12}$/.test(result.requestId || "") ? ` Reference: ${result.requestId}` : "";
    const error = new Error(message + reference);
    error.status = status;
    error.code = typeof result.code === "string" && /^[a-zA-Z0-9_]{1,64}$/.test(result.code) ? result.code : "API_HTTP_ERROR";
    error.requestId = reference ? result.requestId : undefined;
    throw error;
  }
  return result;
}

export function faceDiagnostic(stage, reference, details = {}) {
  if (diagnostics) console.info("[face-login]", { stage, reference, ...details });
}
export function faceReference() {
  // A log correlation ID only; never used as authentication or a challenge.
  return Array.from({ length: 12 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}

export function createFaceClient({ url, fetchImpl = fetch, timeoutMs = 120000, beforeRequest, service = "face", diagnostic = diagnostics ? entry => console.info("[mobile-api]", entry) : null }) {
  return async function request(path, body = {}, token, method = "POST", reference = faceReference()) {
    const label = service === "auth" ? "authentication service" : "face backend";
    let base;
    try { base = normalizeFaceUrl(typeof url === "function" ? url() : url); }
    catch (error) { error.code = "API_CONFIGURATION"; throw error; }
    if (!base) throw Object.assign(new Error(`Configure the ${service} API HTTPS URL without credentials, query parameters or fragments.`), {code:"API_CONFIGURATION"});
    if(beforeRequest)await beforeRequest(path);
    if (!/^\/[a-z/-]+$/.test(path)) throw Object.assign(new Error("Invalid API endpoint."), {code:"API_CONFIGURATION"});
    reference = /^[a-f0-9]{12}$/.test(reference) ? reference : faceReference();
    const started = Date.now();
    const log = (phase, details = {}) => {
      try { diagnostic?.({ phase, reference, endpoint: `${base}${path}`, base, method, durationMs: Date.now() - started, ...details }); } catch { /* Diagnostics must not affect authentication. */ }
    };
    log("request_started", { method });
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        log("timeout");
        reject(Object.assign(new Error(`The ${label} timed out. Check the running service and connection. The request may have completed; sign in again before retrying.`), {code:"API_TIMEOUT"}));
        controller.abort();
      }, ["/me", "/health", "/logout"].includes(path) ? Math.min(timeoutMs, 15000) : timeoutMs);
    });
    const operation = async () => {
      let response;
      // Serialization errors are not transport failures.
      const serialized = method === "GET" ? undefined : JSON.stringify(body);
      try {
        response = await fetchImpl(`${base}${path}`, {
          method, credentials:"omit", redirect:"error", headers: { Accept: "application/json", "Content-Type": "application/json", "X-Face-Request-ID": reference, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: serialized, signal: controller.signal,
        });
      } catch (cause) {
        const error = classifyConnectivityFailure(cause);
        log("failed_before_response", { responseReceived: false, code: error.code });
        if (error.code === "API_UNREACHABLE") error.message = `Cannot connect to the ${label}. Check the configured ${service} API URL, hostname, internet connection and running service.`;
        throw error;
      }
      // Clone for metadata only; never log response content or request values.
      log("response_received", { status: response.status, responseReceived: true });
      let raw;
      try { raw = await response.text(); }
      catch { throw responseError("The response body was interrupted. Sign in again to check whether the request completed.", response.status, "API_RESPONSE_INTERRUPTED"); }
      log("response_completed", { status: response.status, bodyLength: raw.length });
      if (service === "auth" && response.status === 404)
        throw Object.assign(new Error("Authentication endpoint not found. Set the auth API base to the Node authentication service /api/mobile path."), {status:404, code:"API_WRONG_SERVICE"});
      return parseFaceResponse({ status: response.status, ok: response.ok, text: async () => raw });
    };
    try { return await Promise.race([operation(), timeout]); }
    catch (error) {
      log("request_rejected", { code: error.code || "transport_failure", requestId: error.requestId || reference });
      if(!error.status)error.transient=true;
      error.requestId = error.requestId || reference;
      error.message = `${path}: ${error.message}`;
      if (diagnostics) error.message += ` [${error.code || "API_CLIENT_ERROR"}; reference ${reference}]`;
      throw error;
    }
    finally { clearTimeout(timer); }
  };
}
// Password/session traffic must never silently fall back to the biometric service.
const accountPaths = new Set(['/password','/change-password','/register','/me','/logout','/recovery/request','/recovery/confirm']);
export function createMobileApi({ resolveUrl = mobileApiUrl, fetchImpl = fetch, timeoutMs } = {}) {
  const accountClient = createFaceClient({url:()=>resolveUrl('auth'), fetchImpl, timeoutMs:timeoutMs ?? 15000, service:'auth'});
  const faceClient = createFaceClient({url:()=>resolveUrl('face'), fetchImpl, timeoutMs});
  return (path,...args)=>accountPaths.has(path)?accountClient(path,...args):faceClient(path,...args);
}
export const faceApi = createMobileApi();

// Runs the same native fetch transport as login, without credentials or account writes.
export function createAuthConnectionProbe({ resolveUrl = mobileApiUrl, fetchImpl = fetch } = {}) {
  return async () => {
    const reference = faceReference();
    try {
      // Same resolver and transport as createMobileApi's password client.
      const base = resolveUrl("auth");
      const client = createFaceClient({ url: base, fetchImpl, service: "auth", timeoutMs: 15000 });
      const result = await client("/health", {}, undefined, "GET", reference);
      if (result.service !== "Niah Authentication API" || result.ready !== true)
        throw responseError("Health response is not the ready authentication service.", 200, "API_WRONG_SERVICE");
      return { base, reference, status: 200 };
    } catch (error) {
      error.code = error.code || "API_CONFIGURATION";
      error.requestId = error.requestId || reference;
      throw error;
    }
  };
}
export const probeAuthConnection = createAuthConnectionProbe();

export function validateFaceSession(result) {
  if (!result || typeof result.token !== "string" || !/^[a-f0-9]{64}$/.test(result.token) || !validFaceUser(result.user)) {
    throw new Error("Backend returned an invalid login session. Use password login and check the server.");
  }
  return result;
}
export function validFaceUser(user) {
  return user && typeof user.email === "string" && typeof user.id === "string" && typeof user.name === "string" && ["botanist", "visitor", "conservation-officer"].includes(user.role);
}
