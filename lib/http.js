export const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

export const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };

export const isAdmin = (req) => !!process.env.ADMIN_KEY && req.headers.get('x-admin-key') === process.env.ADMIN_KEY;
export const requireAdmin = (req) => { if (!isAdmin(req)) fail(403, 'Host key required'); };

// Wrap a handler so thrown errors become JSON responses.
export const route = (fn) => async (req) => {
  try { return json(await fn(req, new URL(req.url))); }
  catch (e) {
    if (!e.status) console.error(e);
    return json({ error: e.status ? e.message : 'Server error' }, e.status || 500);
  }
};

export const body = async (req) => { try { return await req.json(); } catch { return {}; } };
