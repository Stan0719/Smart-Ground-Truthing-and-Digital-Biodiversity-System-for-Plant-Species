const diagnostics = process.env.EXPO_PUBLIC_FACE_DEBUG === "1";
const configuredUrl = process.env.EXPO_PUBLIC_FACE_API_URL?.trim();

export function normalizeFaceUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
    return url.toString().replace(/\/$/, "");
  } catch { return null; }
}
export function faceCameraConfigured() {
  return Boolean(normalizeFaceUrl(configuredUrl));
}

export async function parseFaceResponse(response) {
  const raw = await response.text();
  const status = response.status;
  if (!raw.trim()) {
    if (status === 401 || status === 403) throw new Error(`Backend access denied (HTTP ${status}). The tunnel may require sign-in. Check its access configuration.`);
    if ([502, 503, 504].includes(status)) throw new Error(`Backend is unreachable through the tunnel (HTTP ${status}). Keep the Python server terminal running and check /health.`);
    throw new Error(`Backend returned an empty response (HTTP ${status}). Check /health and the Python terminal.`);
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

export function createFaceClient({ url, fetchImpl = fetch, timeoutMs = 120000 }) {
  return async function request(path, body = {}, token, method = "POST", reference = faceReference()) {
    const base = normalizeFaceUrl(url);
    if (!base) throw new Error("Set EXPO_PUBLIC_FACE_API_URL to the HTTPS backend address, without query parameters.");
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
        reject(new Error("Face backend timed out. Check the Python terminal; the request may already have completed. Sign in again before retrying enrollment."));
      }, ["/me", "/health", "/logout"].includes(path) ? Math.min(timeoutMs, 15000) : timeoutMs);
    });
    const operation = async () => {
      let response;
      try {
        response = await fetchImpl(`${base}${path}`, {
          method, headers: { "Content-Type": "application/json", "X-Face-Request-ID": reference, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: method === "GET" ? undefined : JSON.stringify(body), signal: controller.signal,
        });
      } catch {
        log("failed_before_response");
        throw new Error("Cannot connect to the face backend. Check your internet connection, backend URL and running Python terminal.");
      }
      // Clone for metadata only; never log response content or request values.
      log("response_received", { status: response.status, contentType: response.headers?.get?.("content-type") || "unknown" });
      const raw = await response.text();
      log("response_completed", { status: response.status, bodyLength: raw.length });
      return parseFaceResponse({ status: response.status, ok: response.ok, text: async () => raw });
    };
    try { return await Promise.race([operation(), timeout]); }
    catch (error) {
      log("request_rejected", { code: error.code || "transport_failure", requestId: error.requestId || reference });
      error.message = `${path}: ${error.message}`;
      throw error;
    }
    finally { clearTimeout(timer); }
  };
}
export const faceApi = createFaceClient({ url: configuredUrl });

export function validateFaceSession(result) {
  if (!result || typeof result.token !== "string" || !/^[a-f0-9]{64}$/.test(result.token) || !validFaceUser(result.user)) {
    throw new Error("Backend returned an invalid login session. Use password login and check the server.");
  }
  return result;
}
export function validFaceUser(user) {
  return user && typeof user.email === "string" && typeof user.id === "string" && typeof user.name === "string" && ["botanist", "visitor"].includes(user.role);
}
