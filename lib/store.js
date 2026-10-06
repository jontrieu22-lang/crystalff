// All league data lives in one small JSON document. In production it is a
// private Vercel Blob (BLOB_READ_WRITE_TOKEN, set by connecting a Blob store);
// dev.js and tests use an in-memory copy. Writes use the blob's ETag, so two
// people saving at once can't overwrite each other.
// Preview deployments (any branch but main) share the Blob store with production,
// so they read and write a separate file and can never touch the real league.
const KEY = process.env.VERCEL_ENV === 'production' ? 'league.json' : 'league-preview.json';
const ROSTER = ['James', 'Ethan', 'Reilly', 'Josh', 'JT', 'Sam', 'Keane', 'Alex', 'Eric', 'Nicky', 'Partha', 'Aidan'];

const fresh = () => ({
  nextId: ROSTER.length + 1,
  players: ROSTER.map((name, i) => ({ id: i + 1, name })),
  legs: [],   // { id, week, playerId, ticker, game, label, side, price, outcome, createdAt }
  weeks: {},  // { [week]: { placer, actualOdds, note } }
});

export function memoryBackend(initial = null) {
  let doc = initial, etag = initial ? '1' : null;
  return {
    async read() { return { data: doc && structuredClone(doc), etag }; },
    async write(data, prev, { force = false } = {}) {
      if (!force && prev !== etag) throw Object.assign(new Error('conflict'), { conflict: true });
      doc = structuredClone(data);
      etag = String(Number(etag || 0) + 1);
    },
  };
}

function blobBackend() {
  const blob = import('@vercel/blob');
  return {
    async read() {
      const { get, head, BlobNotFoundError } = await blob;
      // The ETag for ifMatch must come from head(): the download's ETag header is a
      // different (encoded) value and never matches, which failed every save.
      // Read the tag first, then the body: if a write lands in between, our write
      // is rejected and retried rather than clobbering it.
      let etag;
      try { etag = (await head(KEY)).etag; } catch (e) {
        if (e instanceof BlobNotFoundError) return { data: null, etag: null };
        throw e;
      }
      const r = await get(KEY, { access: 'private', useCache: false });
      if (!r || r.statusCode !== 200) return { data: null, etag: null };
      return { data: JSON.parse(await new Response(r.stream).text()), etag };
    },
    async write(data, prev, { force = false } = {}) {
      const { put, BlobPreconditionFailedError } = await blob;
      try {
        await put(KEY, JSON.stringify(data), {
          access: 'private', contentType: 'application/json', addRandomSuffix: false,
          ...(force ? { allowOverwrite: true } : prev ? { ifMatch: prev } : { allowOverwrite: false }),
        });
      } catch (e) {
        if (e instanceof BlobPreconditionFailedError || /already exists/i.test(e.message)) throw Object.assign(e, { conflict: true });
        throw e;
      }
    },
  };
}

let backend;
export function setBackend(b) { backend = b; }
function store() {
  if (!backend) {
    if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error('No storage: connect a Vercel Blob store to the project');
    backend = blobBackend();
  }
  return backend;
}

export async function load() {
  return (await store().read()).data || fresh();
}

// Read-modify-write with retry on concurrent edits. `fn` mutates the draft and may return a value.
// After repeated conflicts the last attempt writes unconditionally (on freshly read data),
// so a pick never fails outright because of the version check.
const ATTEMPTS = 5;
export async function update(fn) {
  for (let attempt = 1; ; attempt++) {
    const { data, etag } = await store().read();
    const draft = data || fresh();
    const result = await fn(draft);
    const force = attempt === ATTEMPTS;
    if (force) console.warn('store: writing without version check after repeated conflicts');
    try {
      await store().write(draft, etag, { force });
      return result;
    } catch (e) {
      if (!e.conflict) throw e;
      if (force) throw Object.assign(new Error('Busy saving, please try again'), { status: 409 });
      await new Promise((r) => setTimeout(r, 50 * attempt + Math.random() * 100));
    }
  }
}
