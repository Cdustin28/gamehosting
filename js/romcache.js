// Keeps downloaded ROMs in the browser's Cache Storage so replaying a game
// doesn't use Supabase egress (5 GB/month on the free plan). Entries are
// keyed by storage path plus the game's created_at, so a re-uploaded game
// is fetched again.

const CACHE_NAME = "cv-roms-v1";

function keyFor(path, version) {
  return `https://rom-cache.local/${encodeURIComponent(path)}?v=${encodeURIComponent(version || "")}`;
}

export async function getCachedRom(path, version) {
  if (!("caches" in window)) return null;
  try {
    const cache = await caches.open(CACHE_NAME);
    const res = await cache.match(keyFor(path, version));
    return res ? await res.blob() : null;
  } catch {
    return null;
  }
}

export async function putCachedRom(path, version, blob) {
  if (!("caches" in window)) return;
  try {
    const cache = await caches.open(CACHE_NAME);
    // Drop older versions of the same ROM.
    for (const req of await cache.keys()) {
      if (req.url.startsWith(`https://rom-cache.local/${encodeURIComponent(path)}?`)) {
        await cache.delete(req);
      }
    }
    await cache.put(keyFor(path, version), new Response(blob));
  } catch {
    // Storage full or private browsing: playing still works, just uncached.
  }
}

export async function deleteCachedRom(path) {
  if (!("caches" in window)) return;
  try {
    const cache = await caches.open(CACHE_NAME);
    for (const req of await cache.keys()) {
      if (req.url.startsWith(`https://rom-cache.local/${encodeURIComponent(path)}?`)) {
        await cache.delete(req);
      }
    }
  } catch {}
}
