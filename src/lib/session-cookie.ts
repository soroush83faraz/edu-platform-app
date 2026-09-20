// Session-cookie constants shared by the session module and src/proxy.ts. No imports (proxy must stay lean).
//
// `__Host-` prefixed cookies are REJECTED by browsers unless they carry `Secure`, so the prefix is used only
// where Secure is possible (production behind Caddy TLS). Development on http://localhost gets a plain name.
const isProduction = process.env.NODE_ENV === "production";

export const SESSION_COOKIE_NAME = isProduction ? "__Host-session" : "session";
export const SESSION_COOKIE_SECURE = isProduction;

/** Trusted device: 30 days, sliding (re-issued when less than 7 days remain). */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_SLIDING_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;
/** «این دستگاه عمومی است»: 8 hours, browser-session cookie (no Max-Age), never extended. */
export const PUBLIC_DEVICE_TTL_MS = 8 * 60 * 60 * 1000;
/** `last_seen_at` is written at most this often. */
export const LAST_SEEN_INTERVAL_MS = 5 * 60 * 1000;
