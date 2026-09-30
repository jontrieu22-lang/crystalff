// All league data lives in one small JSON document. In production it is a
// private Vercel Blob (BLOB_READ_WRITE_TOKEN, set by connecting a Blob store);
// dev.js and tests use an in-memory copy. Writes use the blob's ETag, so two
// people saving at once can't overwrite each other.
const KEY = 'league.json';
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
    async write(data, prev) {
      if (prev !== etag) throw Object.assign(new Error('conflict'), { conflict: true });
      doc = structuredClone(data);
      etag = String(Number(etag || 0) + 1);
    },
  };
}

function blobBackend() {
  const blob = import('@vercel/blob');
  return {
    async read() {
      const { get } = await blob;
      const r = await get(KEY, { access: 'private', useCache: false });
      if (!r || r.statusCode !== 200) return { data: null, etag: null };
      return { data: JSON.parse(await new Response(r.stream).text()), etag: r.blob.etag };
    },
    async write(data, prev) {
      const { put, BlobPreconditionFailedError } = await blob;
      try {
        await put(KEY, JSON.stringify(data), {
          access: 'private', contentType: 'application/json', addRandomSuffix: false,
          ...(prev ? { ifMatch: prev } : { allowOverwrite: false }),
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
export async function update(fn) {
  for (let attempt = 0; ; attempt++) {
    const { data, etag } = await store().read();
    const draft = data || fresh();
    const result = await fn(draft);
    try {
      await store().write(draft, etag);
      return result;
    } catch (e) {
      if (!e.conflict || attempt >= 4) throw e;
    }
  }
}
