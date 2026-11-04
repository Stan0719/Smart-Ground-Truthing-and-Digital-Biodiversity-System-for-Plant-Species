// Pure, injectable lifecycle: tests use mock storage, production uses SecureStore.
export function createFaceSessionManager({ storage, api, backend, validUser, now=()=>Date.now(), authorizeOffline=async()=>false, diagnostic=()=>{} }) {
  let currentToken = null;
  let generation = 0;
  let lease=null,unlocked=false,lastSeen=0;
  let pendingVerification = null, lastNotified = null, clearing = null;
  const listeners = new Set();
  function notify(authenticated, reason) {
    try { diagnostic({ phase: "session_state", authenticated, reason }); } catch { /* Metadata only. */ }
    if (lastNotified === authenticated) return;
    lastNotified = authenticated;
    for (const listener of listeners) { try { listener({ authenticated, reason }); } catch { /* Observers cannot alter authority. */ } }
  }
  const key = "niah.face.session.v1";
  async function clear(reason = "cleared") {
    generation += 1;
    currentToken = null;lease=null;unlocked=false;lastSeen=0;
    notify(false, reason);
    const removal = Promise.resolve().then(() => storage.remove(key));
    clearing = removal;
    try { await removal; } finally { if (clearing === removal) clearing = null; }
  }
  async function readToken() {
    if (clearing) { await clearing; return currentToken; }
    if (currentToken) return currentToken;
    const attempt = generation;
    const raw = await storage.get(key);
    if (attempt !== generation) return currentToken;
    if (!raw) { notify(false, "missing_saved_session"); return null; }
    try {
      const saved = JSON.parse(raw);
      if (saved.backend !== backend || typeof saved.token !== "string" || !/^[a-f0-9]{64}$/.test(saved.token)) {
        await clear(saved.backend !== backend ? "backend_changed" : "invalid_saved_session"); return null;
      }
      lease=saved.lease||null;
      currentToken = saved.token;
      return currentToken;
    } catch { await clear("invalid_saved_session"); return null; }
  }
  function verify(token, reference) {
    if (pendingVerification?.token === token && pendingVerification.generation === generation) return pendingVerification.work;
    const work = Promise.resolve().then(() => api("/me", {}, token, "POST", reference)).then(({ user }) => {
      if (!validUser(user)) throw new Error("Backend returned an invalid authenticated account.");
      return user; // Always verify with the existing account service.
    }).finally(() => { if (pendingVerification?.work === work) pendingVerification = null; });
    pendingVerification = { token, generation, work };
    return work;
  }
  return {
    async establish(session) {
      if (clearing) await clearing;
      if (typeof session?.token !== "string" || !/^[a-f0-9]{64}$/.test(session.token)) throw new Error("Invalid login session.");
      const attempt = ++generation;
      const user = await verify(session.token, session.requestId);
      if (attempt !== generation) throw new Error("Login was cancelled. Please sign in again.");
      if (session.user?.id !== user.id) throw new Error("Session account does not match the login result.");
      await storage.set(key, JSON.stringify({ backend, token: session.token,lease:{user,verifiedAt:now()} }));
      if (attempt !== generation) { await storage.remove(key); throw new Error("Login was cancelled."); }
      currentToken = session.token;lease={user,verifiedAt:now()};unlocked=false;lastSeen=now();
      notify(true, "login_verified");
      return user;
    },
    async restore({allowOffline=false}={}) {
      const attempt = generation;
      const token = await readToken();
      if (!token || attempt !== generation) return null;
      try {
        const user = await verify(token);
        if(attempt!==generation)return null;
        lease={user,verifiedAt:now()};lastSeen=now();unlocked=false;
        await storage.set(key,JSON.stringify({backend,token,lease}));notify(true,"session_verified");return user;
      } catch (error) {
        if(attempt===generation){
          const transient=error.transient===true||[502,503,504].includes(error.status);
          if(transient){
            if(!allowOffline)throw error;
            const time=now();if(!lease||!validUser(lease.user)||lease.user.role!=='botanist'||!Number.isFinite(lease.verifiedAt)||time<lease.verifiedAt||time<lastSeen||time-lease.verifiedAt>=15*60*1000){await clear();throw error}
            if(!unlocked){if(!await authorizeOffline()){throw Error('Unlock your device to access offline drafts.')}unlocked=true}
            if(attempt!==generation)return null;if(!lease||now()<time||now()-lease.verifiedAt>=15*60*1000){await clear();throw error}lastSeen=now();return {...lease.user,offline:true};
          }
          await clear("verification_rejected");throw error;
        }
        return null;
      }
    },
    async logout() {
      const token = await readToken();
      await clear(); // Always remove local access, even if the server is unavailable.
      if (token) await api("/logout", {}, token);
    },
    async withToken(work){const user=await this.restore();if(!user||user.offline||!currentToken)throw Object.assign(Error('Your session is no longer available. Sign in again.'),{code:'SESSION_REQUIRED',status:401});const stamp=generation,token=currentToken;const result=await work(token,user);if(stamp!==generation||token!==currentToken)throw Object.assign(Error('The session changed during the request.'),{code:'SESSION_CHANGED'});return result;},
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    hasSession: () => Boolean(currentToken),
    clear,
  };
}
