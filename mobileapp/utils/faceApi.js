const diagnostics = process.env.EXPO_PUBLIC_FACE_DEBUG === "1";
import { mobileApiUrl } from "./apiConfiguration.js";

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
    if (status === 401 || status === 403) throw new Error(`Backend access denied (HTTP ${status}). The tunnel may require sign-in. Check its access configuration.`);
    if ([502, 503, 504].includes(status)) throw new Error(`Backend is unreachable through the tunnel (HTTP ${status}). Keep the authentication service running and check /health.`);
    throw new Error(`Backend returned an empty response (HTTP ${status}). Check /health and the authentication service.`);
  }
  let result;
  try { result = JSON.parse(raw); }
  catch { throw new Error(`Backend returned a non-JSON response (HTTP ${status}). Check the configured URL and tunnel access.`); }
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("Backend returned an invalid response.");
  if (!response.ok) {
    const message = typeof result.error === "string" ? result.error : `Backend request failed (HTTP ${status}).`;
    const reference = typeof result.requestId === "string" ? ` Reference: ${result.requestId}` : "";
    const error = new Error(message + reference);
    error.status = status;
    error.code = result.code;
    error.requestId = result.requestId;
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

export function createFaceClient({ url, fetchImpl = fetch, timeoutMs = 120000, beforeRequest, service = "face" }) {
  return async function request(path, body = {}, token, method = "POST", reference = faceReference()) {
    const label = service === "auth" ? "authentication service" : "face backend";
    let base;
    try { base = normalizeFaceUrl(typeof url === "function" ? url() : url); }
    catch (error) { error.code = "API_CONFIGURATION"; throw error; }
    if (!base) throw Object.assign(new Error(`Configure the ${service} API HTTPS URL without credentials, query parameters or fragments.`), {code:"API_CONFIGURATION"});
    if(beforeRequest)await beforeRequest(path);
    const log = (phase, details = {}) => {
      if (diagnostics) console.info("[face-api]", { phase, reference, endpoint: path, backend: new URL(base).origin, ...details });
    };
    log("request_started", { method });
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        log("timeout");
        controller.abort();
        reject(Object.assign(new Error(`The ${label} timed out. Check the running service and connection. The request may have completed; sign in again before retrying.`), {code:"API_TIMEOUT"}));
      }, ["/me", "/health", "/logout"].includes(path) ? Math.min(timeoutMs, 15000) : timeoutMs);
    });
    const operation = async () => {
      let response;
      try {
        response = await fetchImpl(`${base}${path}`, {
          method, credentials:"omit", redirect:"error", headers: { "Content-Type": "application/json", "X-Face-Request-ID": reference, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: method === "GET" ? undefined : JSON.stringify(body), signal: controller.signal,
        });
      } catch {
        log("failed_before_response");
        throw Object.assign(new Error(`Cannot connect to the ${label}. Check the configured ${service} API URL, hostname, internet connection and running service.`), {code:"API_UNREACHABLE"});
      }
      // Clone for metadata only; never log response content or request values.
      log("response_received", { status: response.status, contentType: response.headers?.get?.("content-type") || "unknown" });
      const raw = await response.text();
      log("response_completed", { status: response.status, bodyLength: raw.length });
      if (service === "auth" && response.status === 404)
        throw Object.assign(new Error("Authentication endpoint not found. Set the auth API base to the Node authentication service /api/mobile path."), {status:404, code:"API_WRONG_SERVICE"});
      return parseFaceResponse({ status: response.status, ok: response.ok, text: async () => raw });
    };
    try { return await Promise.race([operation(), timeout]); }
    catch (error) {
      log("request_rejected", { code: error.code || "transport_failure", requestId: error.requestId || reference });
      if(!error.status)error.transient=true;
      error.message = `${path}: ${error.message}`;
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

export function validateFaceSession(result) {
  if (!result || typeof result.token !== "string" || !/^[a-f0-9]{64}$/.test(result.token) || !validFaceUser(result.user)) {
    throw new Error("Backend returned an invalid login session. Use password login and check the server.");
  }
  return result;
}
export function validFaceUser(user) {
  return user && typeof user.email === "string" && typeof user.id === "string" && typeof user.name === "string" && ["botanist", "visitor", "conservation-officer"].includes(user.role);
}
