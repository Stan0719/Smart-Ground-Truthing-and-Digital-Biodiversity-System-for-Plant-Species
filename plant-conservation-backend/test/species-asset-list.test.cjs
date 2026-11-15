'use strict';
// In-memory PGlite fixture only; no environment loading or live PostgreSQL connection.
const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const sharp = require('sharp');
const { createPlantDatabase } = require('./postgres-fixture.cjs');
const { createPlantApp } = require('../server.js');

test('species asset listing admits approved public JPEG/PNG only, preserves RBAC and matches portrait ordering', async t => {
  const pool = await createPlantDatabase();
  t.after(() => pool.end());
  await pool.query(`INSERT INTO species(scientific_name,rbac_data) VALUES
    ('Public','{}'),('Internal','{}'),('Protected','{}'),
    ('Pending','{"approvalStatus":"Pending Review"}'),('Rejected','{"approvalStatus":"Rejected"}');
    INSERT INTO rbac_species_visibility VALUES(1,'public'),(2,'internal'),(3,'protected'),(4,'public'),(5,'public')`);
  const jpeg = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'green' } }).jpeg().toBuffer();
  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'green' } }).png().toBuffer();
  const fixtures = [
    ['new-jpeg',1,true,'image/jpeg','2026-11-02'],
    ['z-tied',1,true,'image/jpeg','2026-11-01'],
    ['a-tied',1,true,'image/png','2026-11-01'],
    ['old-jpeg',1,true,'image/jpeg','2026-10-01'],
    ['unapproved-jpeg',1,false,'image/jpeg','2026-11-03'],
    ['unapproved-png',1,false,'image/png','2026-11-03'],
    ['pdf',1,true,'application/pdf','2026-11-04'],
    ['internal-png',2,true,'image/png','2026-11-01'],
    ['protected-png',3,true,'image/png','2026-11-01'],
    ['pending-png',4,true,'image/png','2026-11-01'],
    ['rejected-jpeg',5,true,'image/jpeg','2026-11-01'],
  ];
  for (const [id,species,approved,type,created] of fixtures) await pool.query(
    'INSERT INTO plant_asset(id,species_id,owner_subject,client_key,approved,content_type,content,created_at) VALUES($1,$2,$3,$1,$4,$5,$6,$7)',
    [id,species,'staff:fixture',approved,type,type === 'image/png' ? png : type === 'application/pdf' ? Buffer.from('%PDF-fixture') : jpeg,created]);
  const tokens = { bot: '1'.repeat(64), officer: '2'.repeat(64), admin: '3'.repeat(64) };
  const roles = { bot: 'Botanist', officer: 'Conservation Officer', admin: 'Administrator' };
  const auth = { event: async () => {}, session: async token => {
    const id = Object.keys(tokens).find(id => tokens[id] === token);
    return id ? { id, role: roles[id], status: 'Active', mustChangePassword: false } : null;
  } };
  const server = createPlantApp({ pool, auth, origins: new Set() }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const call = async (path, role) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { headers: role ? { Authorization: `Bearer ${tokens[role]}` } : {} });
    const type = response.headers.get('content-type') || '';
    return { status: response.status, type, data: type.includes('json') ? await response.json() : Buffer.from(await response.arrayBuffer()) };
  };
  const listed = async (id,role) => { const response = await call(`/assets?species_id=${id}`,role); assert.equal(response.status,200); return response.data.assets.map(a => a.id); };

  await t.test('public JPEG/PNG eligibility and stable newest-first/ascending-ID ties', async () => {
    for (let i=0;i<3;i++) assert.deepEqual(await listed(1), ['new-jpeg','a-tied','z-tied','old-jpeg']);
    const pngResponse = await call('/assets/a-tied');
    assert.equal(pngResponse.status,200); assert.match(pngResponse.type,/image\/png/); assert.ok(pngResponse.data.equals(png));
    assert.equal((await call('/assets/new-jpeg')).status,200);
    const first = (await call('/species/1')).data.species;
    assert.equal(first.image_asset_id,'new-jpeg'); assert.equal(first.image_url,'/api/assets/new-jpeg');
    await pool.query("UPDATE plant_asset SET approved=FALSE WHERE id='new-jpeg'");
    assert.deepEqual(await listed(1), ['a-tied','z-tied','old-jpeg']);
    assert.equal((await call('/species/1')).data.species.image_asset_id,'a-tied');
  });
  await t.test('unapproved, pending, rejected, internal and protected assets remain private', async () => {
    for (const id of ['unapproved-jpeg','unapproved-png','pending-png','rejected-jpeg','internal-png','protected-png'])
      assert.equal((await call(`/assets/${id}`)).status,404,id);
    for (const id of [2,3,4,5]) assert.deepEqual(await listed(id),[]);
    assert.equal((await call('/assets/pdf')).status,403);
    assert.equal((await call('/assets/missing')).status,404);
  });
  await t.test('existing scientific/Officer privileges remain distinct and Administrator gets no grant', async () => {
    assert.deepEqual(await listed(2,'bot'),['internal-png']);
    assert.deepEqual(await listed(3,'bot'),[]);
    assert.equal((await call('/assets/protected-png','bot')).status,404);
    assert.deepEqual(await listed(3,'officer'),['protected-png']);
    assert.equal((await call('/assets/protected-png','officer')).status,200);
    assert.ok((await listed(1,'officer')).includes('unapproved-png'));
    assert.ok((await listed(1,'officer')).includes('pdf'));
    assert.equal((await call('/assets/pdf','officer')).status,200);
    assert.equal((await call('/assets?species_id=1','admin')).status,403);
    assert.equal((await call('/assets/a-tied','admin')).status,403);
    assert.equal((await call('/species/1','admin')).status,403);
  });
});
