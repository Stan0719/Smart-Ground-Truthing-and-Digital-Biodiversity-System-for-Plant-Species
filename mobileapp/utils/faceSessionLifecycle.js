// Pure, injectable lifecycle: tests use mock storage, production uses SecureStore.
export function createFaceSessionManager({ storage, api, backend, validUser, now=()=>Date.now(), authorizeOffline=async()=>false }) {
  let currentToken = null;
  let generation = 0;
  let lease=null,unlocked=false,lastSeen=0;
  const key = "niah.face.session.v1";
  async function clear() {
    generation += 1;
    currentToken = null;lease=null;unlocked=false;lastSeen=0;
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
      lease=saved.lease||null;
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
      await storage.set(key, JSON.stringify({ backend, token: session.token,lease:{user,verifiedAt:now()} }));
      if (attempt !== generation) { await storage.remove(key); throw new Error("Login was cancelled."); }
      currentToken = session.token;lease={user,verifiedAt:now()};unlocked=false;lastSeen=now();
      return user;
    },
    async restore({allowOffline=false}={}) {
      const token = await readToken();
      if (!token) return null;
      const attempt = generation;
      try {
        const user = await verify(token);
        if(attempt!==generation)return null;
        lease={user,verifiedAt:now()};lastSeen=now();unlocked=false;
        await storage.set(key,JSON.stringify({backend,token,lease}));return user;
      } catch (error) {
        if(attempt===generation){
          const transient=error.transient===true||[502,503,504].includes(error.status);
          if(transient){
            if(!allowOffline)throw error;
            const time=now();if(!lease||!validUser(lease.user)||lease.user.role!=='botanist'||!Number.isFinite(lease.verifiedAt)||time<lease.verifiedAt||time<lastSeen||time-lease.verifiedAt>=15*60*1000){await clear();throw error}
            if(!unlocked){if(!await authorizeOffline()){throw Error('Unlock your device to access offline drafts.')}unlocked=true}
            if(attempt!==generation)return null;if(!lease||now()<time||now()-lease.verifiedAt>=15*60*1000){await clear();throw error}lastSeen=now();return {...lease.user,offline:true};
          }
          await clear();throw error;
        }
        return null;
      }
    },
    async logout() {
      const token = await readToken();
      await clear(); // Always remove local access, even if the server is unavailable.
      if (token) await api("/logout", {}, token);
    },
    async withToken(work){const user=await this.restore();if(!user||user.offline||!currentToken)throw Error('Sign in before making a business request.');const stamp=generation,token=currentToken;const result=await work(token,user);if(stamp!==generation||token!==currentToken)throw Error('The session changed during the request.');return result;},
    hasSession: () => Boolean(currentToken),
    clear,
  };
}
