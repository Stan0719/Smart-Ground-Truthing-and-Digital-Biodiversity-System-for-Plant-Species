import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
const source = readFileSync(new URL('../utils/faceSessionLifecycle.js', import.meta.url), 'utf8');
const { createFaceSessionManager } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const user = { id: 'account-a', email: 'a@example.com', role: 'botanist' }, token = 'a'.repeat(64);
function fixture() {
 let saved = null, fail = false; const calls = [];
 const storage = { get: async () => saved, set: async (_, v) => { saved = v; }, remove: async () => { saved = null; } };
 const api = async (path, _, bearer) => { calls.push({path, bearer}); if(fail) throw Error('Expired or unavailable'); return {user}; };
 const make = () => createFaceSessionManager({storage, api, backend:'https://backend.example', validUser: v => v?.id === user.id});
 return {make, calls, stored:()=>saved, fail:()=>{fail=true;}, seed:v=>{saved=JSON.stringify(v);}};
}
test('persist secure token and bounded draft lease; restore online authority from backend', async()=>{
 const f=fixture(), m=f.make(); assert.deepEqual(await m.establish({token,user}),user);
 const saved=JSON.parse(f.stored());assert.equal(saved.backend,'https://backend.example');assert.equal(saved.token,token);assert.deepEqual(saved.lease.user,user);assert.ok(Number.isFinite(saved.lease.verifiedAt));f.seed({...saved,lease:{...saved.lease,user:{...user,role:'Administrator'}}});
 assert.deepEqual(await f.make().restore(),user); assert.equal(f.calls.every(c=>c.path==='/me'&&c.bearer===token),true);
});
test('reject identity mismatch',async()=>{const f=fixture();await assert.rejects(f.make().establish({token,user:{id:'other'}}),/does not match/);assert.equal(f.stored(),null);});
test('expired or unavailable session clears access',async()=>{const f=fixture(),m=f.make();await m.establish({token,user});f.fail();await assert.rejects(m.restore());assert.equal(m.hasSession(),false);assert.equal(f.stored(),null);});
test('logout revokes; subsequent verified face session can sign in',async()=>{const f=fixture(),m=f.make();await m.establish({token,user});await m.logout();assert.equal(f.stored(),null);assert.equal(await m.restore(),null);assert.deepEqual(f.calls.at(-1),{path:'/logout',bearer:token});assert.deepEqual(await m.establish({token:'b'.repeat(64),user}),user);});
test('offline logout still clears local access',async()=>{const f=fixture(),m=f.make();await m.establish({token,user});f.fail();await assert.rejects(m.logout());assert.equal(f.stored(),null);assert.equal(m.hasSession(),false);});
test('wrong backend or forged token never grants access',async()=>{for(const saved of [{backend:'https://other',token},{backend:'https://backend.example',token:'forged',role:'botanist'}]){const f=fixture();f.seed(saved);assert.equal(await f.make().restore(),null);assert.equal(f.calls.length,0);}});
