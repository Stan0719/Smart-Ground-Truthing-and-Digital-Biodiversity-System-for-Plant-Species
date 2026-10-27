import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync(
  new URL("../utils/faceSessionLifecycle.js", import.meta.url),
  "utf8",
);
const { createFaceSessionManager } = await import(
  "data:text/javascript;base64," + Buffer.from(source).toString("base64")
);
function fixture() {
  let saved = null;
  const user = { id: "account", role: "botanist" },
    token = "a".repeat(64);
  const manager = createFaceSessionManager({
    backend: "https://face.example.invalid",
    validUser: (u) => u.id === user.id,
    api: async () => ({ user }),
    storage: {
      get: async () => saved,
      set: async (_, v) => {
        saved = v;
      },
      remove: async () => {
        saved = null;
      },
    },
  });
  return { manager, user, token };
}
test("business requests require authoritative session token", async () => {
  const { manager, user, token } = fixture();
  await assert.rejects(manager.withToken(() => {}));
  await manager.establish({ user, token });
  assert.equal(await manager.withToken((t) => t), token);
  await manager.logout();
  await assert.rejects(manager.withToken(() => {}));
});
test("logout during business request invalidates its response", async () => {
  const { manager, user, token } = fixture();
  await manager.establish({ user, token });
  let finish;
  const work = manager.withToken(
    () =>
      new Promise((r) => {
        finish = r;
      }),
  );
  await new Promise((r) => setImmediate(r));
  await manager.logout();
  finish("done");
  await assert.rejects(work, /session changed/i);
});

 test('mobile business catalogue forwards bearer authority, scientific scope and draft owner',async t=>{
 const requests=[];globalThis.__plantAuditSession={hasSession:()=>true,withToken:async work=>work('a'.repeat(64),{id:'owner',role:'botanist'})};globalThis.__plantAuditFetch=async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>({species:[]})}};
 t.after(()=>{delete globalThis.__plantAuditSession;delete globalThis.__plantAuditFetch});
 const source=readFileSync(new URL('../utils/plantApi.js',import.meta.url),'utf8').replace(/import \{faceSession\} from "\.\/faceSession";/,'const faceSession=globalThis.__plantAuditSession;').replace(/import \{ mobileApiUrl \} from "\.\/apiConfiguration\.js";/,'const mobileApiUrl=()=>"https://approved.example.invalid";').replaceAll('await fetch(','await globalThis.__plantAuditFetch(');
 const client=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 await client.fetchSpeciesCatalog();assert.equal(requests[0].url,'https://approved.example.invalid/api/species?scope=scientific');assert.equal(requests[0].options.headers.Authorization,'Bearer '+'a'.repeat(64));
 await assert.rejects(client.plantApi('/plants',{method:'POST',body:{},expectedAccountId:'other'}),/correct account/);assert.equal(requests.length,1);
 });
