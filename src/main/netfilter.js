'use strict';

const { TRUSTED_HOSTS } = require('./constants');

const BLOCKED_DOMAINS = [
  'sentry.io', 'sentry-cdn.com', 'ingest.sentry.io',
  'google-analytics.com', 'analytics.google.com', 'googletagmanager.com', 'googletagservices.com',
  'doubleclick.net', 'googlesyndication.com', 'adservice.google.com',
  'hotjar.com', 'hotjar.io', 'mixpanel.com', 'segment.io', 'segment.com', 'amplitude.com',
  'posthog.com', 'plausible.io', 'clarity.ms', 'fullstory.com', 'logrocket.com', 'logrocket.io',
  'datadoghq.com', 'browser-intake-datadoghq.com', 'bugsnag.com', 'newrelic.com', 'nr-data.net',
  'static.cloudflareinsights.com', 'cloudflareinsights.com',
  'vitals.vercel-insights.com', 'va.vercel-scripts.com', 'vercel.live',
  'connect.facebook.net', 'facebook.net', 'ads-twitter.com', 'analytics.twitter.com', 'tiktok-analytics.com',
  'statcounter.com', 'matomo.cloud', 'heap.io', 'heapanalytics.com', 'smartlook.com', 'mouseflow.com',
];

const BLOCKED_PATHS = ['/_vercel/insights/', '/_vercel/speed-insights/', '/va/'];

const BLOCKED_PATH_PATTERNS = [/^\/[0-9a-f]{16}\/(script\.js|view|event|session|vitals|identify|group)$/i];

const ALLOWED_DOMAINS = ['challenges.cloudflare.com', 'yapper.website', 'supabase.co', 'supabase.in', 'livekit.cloud'];

function hostMatches(host, domain) {
  return host === domain || host.endsWith('.' + domain);
}

function shouldBlock(urlString) {
  let u;
  try {
    u = new URL(urlString);
  } catch (_) {
    return false;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:' && u.protocol !== 'wss:' && u.protocol !== 'ws:') return false;
  const host = u.hostname.toLowerCase();
  if (ALLOWED_DOMAINS.some((d) => hostMatches(host, d))) {

    return BLOCKED_PATHS.some((p) => u.pathname.startsWith(p)) || BLOCKED_PATH_PATTERNS.some((re) => re.test(u.pathname));
  }
  return BLOCKED_DOMAINS.some((d) => hostMatches(host, d));
}

class NetFilter {
  constructor() {
    this.enabled = true;
    this.blockedCount = 0;
    this.recent = [];
  }

  install(ses) {
    ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (details, callback) => {
      if (this.enabled && shouldBlock(details.url)) {
        this.blockedCount++;
        try {
          const u = new URL(details.url);
          this.recent.unshift(u.hostname + u.pathname.slice(0, 40));
          if (this.recent.length > 25) this.recent.length = 25;
        } catch (_) {

        }
        callback({ cancel: true });
        return;
      }
      callback({});
    });
  }

  stats() {
    return { enabled: this.enabled, blocked: this.blockedCount, recent: this.recent.slice() };
  }
}

module.exports = { NetFilter, shouldBlock, BLOCKED_DOMAINS, BLOCKED_PATHS, BLOCKED_PATH_PATTERNS, TRUSTED_HOSTS };
