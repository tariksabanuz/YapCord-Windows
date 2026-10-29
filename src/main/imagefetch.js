'use strict';

const { SITE_HOSTS } = require('./constants');

const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 10000;
// Any subdomain of yapper.website (api., files., and whatever else Yapper's own CDN uses now or later -
// files.yapper.website is where avatars actually live, confirmed from a real "blocked url" failure on
// PetPet's avatar fetch) is first-party and trusted, same as the bare domain. .r2.dev/.supabase.co are
// third-party CDNs Yapper itself serves some assets from.
const HOST_SUFFIXES = ['.yapper.website', '.r2.dev', '.supabase.co'];

function allowedUrl(raw) {
  let u;
  try {
    u = new URL(String(raw));
  } catch (_) {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return null;
  const host = u.hostname.toLowerCase();
  const ok = SITE_HOSTS.includes(host) || HOST_SUFFIXES.some((s) => host.endsWith(s) && host.length > s.length);
  return ok ? u : null;
}

async function fetchImage({ net }, rawUrl) {
  const u = allowedUrl(rawUrl);
  if (!u) throw new Error('blocked url');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await net.fetch(u.href, { redirect: 'error', signal: ctl.signal, credentials: 'omit' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const type = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!/^image\/(png|jpeg|gif|webp|avif|bmp)$/.test(type)) throw new Error('not a picture');
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_BYTES) throw new Error('too large');
    const data = Buffer.from(await res.arrayBuffer());
    if (data.length > MAX_BYTES) throw new Error('too large');
    return { type, data };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { fetchImage, allowedUrl, MAX_BYTES };
