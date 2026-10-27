import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
const load = async (p) =>
  import(
    "data:text/javascript;base64," +
      Buffer.from(readFileSync(new URL(p, import.meta.url), "utf8")).toString(
        "base64",
      )
  );
const { createFaceSessionManager } = await load(
  "../utils/faceSessionLifecycle.js",
);
const { createDraftStore } = await load("../utils/offlineDraftStore.js");
const token = "a".repeat(64),
  user = {
    id: "owner",
    name: "Owner",
    email: "owner@example.invalid",
    role: "botanist",
  };
function sessions() {
  const saved = new Map();
  let now = 1000000,
    failure = null,
    unlocks = 0;
  const storage = {
    get: async (k) => saved.get(k) || null,
    set: async (k, v) => saved.set(k, v),
    remove: async (k) => saved.delete(k),
  };
  const make = () =>
    createFaceSessionManager({
      storage,
      backend: "https://face.example.invalid",
      validUser: (u) => u?.id === "owner",
      now: () => now,
      authorizeOffline: async () => {
        unlocks++;
        return true;
      },
      api: async () => {
        if (failure) throw failure;
        return { user };
      },
    });
  return {
    make,
    saved,
    fail: (e) => (failure = e),
    advance: (n) => (now += n),
    unlocks: () => unlocks,
  };
}
test("offline restart restores only a bounded owner draft lease, not API authority", async () => {
  const f = sessions();
  await f.make().establish({ token, user });
  f.fail(Object.assign(Error("offline"), { transient: true }));
  const fresh = f.make();
  const local = await fresh.restore({ allowOffline: true });
  assert.equal(local.offline, true);
  assert.equal(local.id, "owner");
  assert.equal(f.unlocks(), 1);
  await assert.rejects(fresh.restore());
  await fresh.restore({ allowOffline: true });
  assert.equal(f.unlocks(), 1);
  f.advance(15 * 60 * 1000);
  await assert.rejects(fresh.restore({ allowOffline: true }));
});
test("revocation and clock rollback cannot restore offline access; logout clears the lease", async () => {
  const f = sessions();
  const m = f.make();
  await m.establish({ token, user });
  f.fail(Object.assign(Error("revoked"), { status: 401 }));
  await assert.rejects(m.restore({ allowOffline: true }));
  assert.equal(f.saved.size, 0);
  f.fail(null);
  await m.establish({ token, user });
  f.fail(Object.assign(Error("offline"), { transient: true }));
  f.advance(-1);
  await assert.rejects(f.make().restore({ allowOffline: true }));
  await assert.rejects(m.logout());
  assert.equal(f.saved.size, 0);
});
function drafts() {
  const data = new Map(),
    key = randomBytes(32);
  let full = false,
    owner = "owner",
    available = 1e8;
  const make = () =>
    createDraftStore({
      storage: {
        getItem: async (k) => data.get(k) || null,
        setItem: async (k, v) => {
          if (full) throw Error("disk full");
          data.set(k, v);
        },
      },
      encrypt: async (_id, v) => {
        const iv = randomBytes(12),
          cipher = createCipheriv("aes-256-gcm", key, iv);
        const content = Buffer.concat([
          cipher.update(v, "utf8"),
          cipher.final(),
        ]);
        return {
          version: 1,
          ciphertext: Buffer.concat([
            iv,
            cipher.getAuthTag(),
            content,
          ]).toString("base64"),
        };
      },
      decrypt: async (_id, v) => {
        const bytes = Buffer.from(v.ciphertext, "base64");
        const cipher = createDecipheriv(
          "aes-256-gcm",
          key,
          bytes.subarray(0, 12),
        );
        cipher.setAuthTag(bytes.subarray(12, 28));
        return Buffer.concat([
          cipher.update(bytes.subarray(28)),
          cipher.final(),
        ]).toString("utf8");
      },
      authorize: async (id) => {
        if (id !== owner) throw Error("owner");
      },
      availableBytes: async () => available,
      maxBytes: 1000,
    });
  return {
    make,
    data,
    full: () => (full = true),
    other: () => (owner = "other"),
    low: () => (available = 0),
  };
}
const draft = { client_key: "one", body: { content: { notes: "private" } } };
test("draft recovery after restart and failed writes preserve earlier observations", async () => {
  const f = drafts();
  await f.make().saveDraft("owner", draft);
  assert.equal([...f.data.values()][0].includes("private"), false);
  assert.deepEqual(await f.make().readDrafts("owner"), [draft]);
  f.full();
  await assert.rejects(
    f.make().saveDraft("owner", { ...draft, body: { new: true } }),
    /not saved/,
  );
  assert.deepEqual(await f.make().readDrafts("owner"), [draft]);
  f.other();
  await assert.rejects(f.make().readDrafts("owner"), /owner/);
});
test("storage budget and low disk refuse new writes without deleting drafts", async () => {
  const f = drafts(),
    store = f.make();
  await store.saveDraft("owner", draft);
  await assert.rejects(
    store.saveDraft("owner", {
      client_key: "large",
      body: { photo: "x".repeat(1100) },
    }),
    /storage/,
  );
  f.low();
  await assert.rejects(store.saveDraft("owner", draft), /storage/);
  assert.deepEqual(await store.readDrafts("owner"), [draft]);
});
test("sync removal cannot delete a newer edit of the same draft", async () => {
  const f = drafts(),
    s = f.make();
  await s.saveDraft("owner", draft);
  await s.saveDraft("owner", { ...draft, body: { changed: true } });
  assert.equal(await s.removeDraft("owner", "one", draft), false);
  assert.equal((await s.readDrafts("owner")).length, 1);
});

test("corrupt encrypted data fails closed without deleting stored observations", async () => {
  const f = drafts();
  await f.make().saveDraft("owner", draft);
  const key = [...f.data.keys()][0];
  const value = JSON.parse(f.data.get(key));
  value.ciphertext = "AAAA";
  f.data.set(key, JSON.stringify(value));
  const original = f.data.get(key);
  await assert.rejects(f.make().readDrafts("owner"), /Nothing was deleted/);
  assert.equal(f.data.get(key), original);
});

test("device unlock cannot extend an expired offline lease or restore a logged-out session", async () => {
  for (const cancel of [false, true]) {
    const saved = new Map();
    let clock = 1000,
      offline = false,
      release,
      entered;
    const unlocking = new Promise((resolve) => {
      entered = resolve;
    });
    const manager = createFaceSessionManager({
      storage: {
        get: async (k) => saved.get(k),
        set: async (k, v) => saved.set(k, v),
        remove: async (k) => saved.delete(k),
      },
      backend: "https://face.example.invalid",
      validUser: (u) => u?.id === user.id,
      now: () => clock,
      api: async () => {
        if (offline) throw Object.assign(Error("offline"), { transient: true });
        return { user };
      },
      authorizeOffline: async () => {
        entered();
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    });
    await manager.establish({ token, user });
    offline = true;
    const restoring = manager.restore({ allowOffline: true });
    const result = cancel
      ? restoring.then((value) => assert.equal(value, null))
      : assert.rejects(restoring, /offline/);
    await unlocking;
    if (cancel) await manager.clear();
    else clock += 15 * 60 * 1000;
    release(true);
    // Logout cancels restoration rather than returning a cached private profile.
    await result;
  }
});

test("draft read rechecks account authorization after asynchronous decryption", async () => {
  let owner = "owner",
    release,
    entered;
  const waiting = new Promise((resolve) => {
    entered = resolve;
  });
  const original = JSON.stringify({ version: 1, ciphertext: "synthetic" });
  const store = createDraftStore({
    storage: {
      getItem: async () => original,
      setItem: async () => assert.fail("read must not write"),
    },
    encrypt: async () => assert.fail("read must not encrypt"),
    decrypt: async () => {
      entered();
      await new Promise((resolve) => {
        release = resolve;
      });
      return JSON.stringify([draft]);
    },
    authorize: async (id) => {
      if (id !== owner) throw Error("owner changed");
    },
  });
  const reading = store.readDrafts("owner");
  const rejected = assert.rejects(reading, /Nothing was deleted/);
  await waiting;
  owner = "other";
  release();
  await rejected;
});
