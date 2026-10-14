// Pure, injectable lifecycle: tests use mock storage, production uses SecureStore.
export function createFaceSessionManager({ storage, api, backend, validUser }) {
  let currentToken = null;
  let generation = 0;
  const key = "niah.face.session.v1";
  async function clear() {
    generation += 1;
    currentToken = null;
    await storage.remove(key);
  }
  async function readToken() {
    if (currentToken) return currentToken;
    const raw = await storage.get(key);
    if (!raw) return null;
    try {
      const saved = JSON.parse(raw);
      if (saved.backend !== backend || typeof saved.token !== "string" || !/^[a-f0-9]{64}$/.test(saved.token)) {
        await clear(); return null;
      }
      currentToken = saved.token;
      return currentToken;
    } catch { await clear(); return null; }
  }
  async function verify(token, reference) {
    const { user } = await api("/me", {}, token, "POST", reference);
    if (!validUser(user)) throw new Error("Backend returned an invalid authenticated account.");
    return user; // Never restore roles from local storage or a client-supplied profile.
  }
  return {
    async establish(session) {
      if (typeof session?.token !== "string" || !/^[a-f0-9]{64}$/.test(session.token)) throw new Error("Invalid login session.");
      const attempt = ++generation;
      const user = await verify(session.token, session.requestId);
      if (attempt !== generation) throw new Error("Login was cancelled. Please sign in again.");
      if (session.user?.id !== user.id) throw new Error("Session account does not match the login result.");
      await storage.set(key, JSON.stringify({ backend, token: session.token }));
      if (attempt !== generation) { await storage.remove(key); throw new Error("Login was cancelled."); }
      currentToken = session.token;
      return user;
    },
    async restore() {
      const token = await readToken();
      if (!token) return null;
      const attempt = generation;
      try {
        const user = await verify(token);
        return attempt === generation ? user : null;
      } catch (error) {
        if (attempt === generation) { await clear(); throw error; }
        return null;
      }
    },
    async logout() {
      const token = await readToken();
      await clear(); // Always remove local access, even if the server is unavailable.
      if (token) await api("/logout", {}, token);
    },
    hasSession: () => Boolean(currentToken),
    clear,
  };
}
