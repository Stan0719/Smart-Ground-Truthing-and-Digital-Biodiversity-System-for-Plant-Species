// Public URLs only. Never put tokens, passwords or service keys in Expo settings.
export function selectApiConfiguration(settings, release = false) {
  const environment =
    settings.environment || (release ? "production" : "development");
  if (!["development", "production"].includes(environment))
    return {
      environment,
      error: "Set EXPO_PUBLIC_API_ENV to development or production.",
    };
  // A regular reachable HTTPS gateway needs no VPN client on the phone.
  // Release builds never fall back to a development backend setting.
  const backend =
    environment === "production"
      ? settings.backendProduction
      : settings.backendDevelopment || settings.backend;
  if (backend || settings.privateGateway) {
    try {
      const gateway = validatedApiUrl(
        backend || settings.privateGateway,
        environment,
        "plant",
      );
      return { environment, plant: gateway, face: gateway + "/face" };
    } catch (error) {
      return { environment, error: error.message };
    }
  }
  return {
    environment,
    plant:
      environment === "production"
        ? settings.plantProduction
        : settings.plantDevelopment || settings.plant,
    face:
      environment === "production"
        ? settings.faceProduction
        : settings.faceDevelopment || settings.face,
  };
}
export function validatedApiUrl(value, environment, service) {
  let url;
  try {
    url = new URL(value?.trim());
  } catch {
    throw Error(`Configure the ${service} API HTTPS URL for ${environment}.`);
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (service === "plant" && url.pathname !== "/")
  )
    throw Error(
      `Invalid ${service} API URL. Use HTTPS without credentials, query parameters or fragments.`,
    );
  if (
    environment === "production" &&
    (url.hostname.endsWith(".app.github.dev") ||
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
  )
    throw Error(
      "Production APIs need an approved deployed HTTPS origin, not a local or Codespaces address.",
    );
  return url.toString().replace(/\/$/, "");
}
export const mobileApiConfiguration = selectApiConfiguration(
  {
    environment: process.env.EXPO_PUBLIC_API_ENV,
    privateGateway: process.env.EXPO_PUBLIC_PRIVATE_GATEWAY_URL,
    backend: process.env.EXPO_PUBLIC_BACKEND_URL,
    backendDevelopment: process.env.EXPO_PUBLIC_BACKEND_URL_DEVELOPMENT,
    backendProduction: process.env.EXPO_PUBLIC_BACKEND_URL_PRODUCTION,
    plant: process.env.EXPO_PUBLIC_PLANT_API_URL,
    face: process.env.EXPO_PUBLIC_FACE_API_URL,
    plantDevelopment: process.env.EXPO_PUBLIC_PLANT_API_URL_DEVELOPMENT,
    faceDevelopment: process.env.EXPO_PUBLIC_FACE_API_URL_DEVELOPMENT,
    plantProduction: process.env.EXPO_PUBLIC_PLANT_API_URL_PRODUCTION,
    faceProduction: process.env.EXPO_PUBLIC_FACE_API_URL_PRODUCTION,
  },
  typeof __DEV__ === "boolean" && !__DEV__,
);
export function mobileApiUrl(service) {
  if (mobileApiConfiguration.error) throw Error(mobileApiConfiguration.error);
  return validatedApiUrl(
    mobileApiConfiguration[service],
    mobileApiConfiguration.environment,
    service,
  );
}
export function connectivityError(code, message) {
  return Object.assign(Error(message), { code, transient: true });
}
export async function checkApiConnectivity(
  service,
  url,
  fetchImpl = fetch,
  timeoutMs = 5000,
) {
  const controller = new AbortController();
  let timer;
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(
        connectivityError(
          "API_TIMEOUT",
          "API connectivity check timed out. Check the network and running service.",
        ),
      );
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      (async () => {
        let response;
        try {
          response = await fetchImpl(url + "/health", {
            method: "GET",
            credentials: "omit",
            redirect: "manual",
            headers: { Accept: "application/json" },
            signal: controller.signal,
          });
        } catch (error) {
          throw classifyConnectivityFailure(error);
        }
        if (response.status === 401 || response.status === 403)
          throw connectivityError(
            response.status === 401 ? "API_AUTH_REQUIRED" : "API_ACCESS_DENIED",
            "The gateway requires authentication or denied access. Check VPN membership and access policy.",
          );
        if (
          response.redirected ||
          response.type === "opaqueredirect" ||
          (response.status >= 300 && response.status < 400)
        )
          throw connectivityError(
            "API_ACCESS_REDIRECT",
            "API access redirects to a sign-in or another address. Private Codespaces forwarding needs GitHub access; configure an approved phone-reachable HTTPS API.",
          );
        const type = response.headers?.get?.("content-type") || "";
        if (!type.includes("application/json"))
          throw connectivityError(
            "API_NOT_JSON",
            "The API returned a web page instead of JSON. Check private Codespaces access and the configured API address.",
          );
        if (!response.ok)
          throw connectivityError(
            "API_NOT_READY",
            `API health check failed (HTTP ${response.status}).`,
          );
        let body;
        try {
          body = await response.json();
        } catch {
          throw connectivityError(
            "API_INVALID_HEALTH",
            "The API returned invalid health JSON.",
          );
        }
        const correct =
          service === "plant"
            ? body?.service === "Plant Conservation API" && body.ready === true
            : body?.ready === true && body.accountService === "authoritative";
        if (!correct)
          throw connectivityError(
            "API_WRONG_SERVICE",
            "The API address does not identify the expected ready service. Check its configuration.",
          );
        return { service, ready: true };
      })(),
      expired,
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export function createConnectivityGuard(
  service,
  resolveUrl,
  fetchImpl = fetch,
  now = () => Date.now(),
) {
  const checks = new Map();
  return async () => {
    let url;
    try {
      url = resolveUrl();
    } catch (error) {
      throw connectivityError("API_CONFIGURATION", error.message);
    }
    let check = checks.get(url);
    if (check && now() >= check.checkedAt && now() < check.goodUntil) return;
    if (!check?.pending) {
      check = { checkedAt: 0, goodUntil: 0 };
      checks.set(url, check);
      check.pending = checkApiConnectivity(service, url, fetchImpl)
        .then(() => {
          check.checkedAt = now();
          check.goodUntil = now() + 10000;
        })
        .finally(() => {
          check.pending = null;
        });
    }
    await check.pending;
  };
}

// Native fetch often supplies no DNS/TLS/VPN cause. Report only evidence we have;
// an unreachable endpoint alone cannot establish that the VPN is disconnected.
export function classifyConnectivityFailure(error) {
  const code = error?.cause?.code || error?.code;
  if (["ENOTFOUND", "EAI_AGAIN"].includes(code))
    return connectivityError(
      "API_DNS",
      "API hostname could not be resolved. Check the configured hostname, private DNS and VPN connection.",
    );
  if (
    [
      "CERT_HAS_EXPIRED",
      "DEPTH_ZERO_SELF_SIGNED_CERT",
      "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
      "ERR_TLS_CERT_ALTNAME_INVALID",
      "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
    ].includes(code)
  )
    return connectivityError(
      "API_TLS",
      "HTTPS certificate validation failed. Check hostname, certificate validity and device time. Do not disable TLS verification.",
    );
  if (
    ["AbortError", "TimeoutError"].includes(error?.name) ||
    code === "UND_ERR_CONNECT_TIMEOUT"
  )
    return connectivityError(
      "API_TIMEOUT",
      "API request timed out. Check VPN connectivity and running services.",
    );
  return connectivityError(
    "API_UNREACHABLE",
    "Cannot reach the API securely. Check VPN connection, hostname, HTTPS and backend availability. The device did not provide a more specific cause.",
  );
}
export function sessionBackendBinding(plant, face) {
  return JSON.stringify([plant, face]);
}
