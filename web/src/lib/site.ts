/**
 * Where TritonPlan lives. Build-time overridable so a local dev pair (new site
 * + old-site migration page on two ports) can point at each other.
 */
export const SITE_ORIGIN: string = import.meta.env.VITE_SITE_ORIGIN ?? 'https://tritonplan.cn';
export const OLD_SITE_ORIGIN: string = import.meta.env.VITE_OLD_SITE_ORIGIN ?? 'https://hfjddjksaj.github.io';
export const OLD_SITE_URL = `${OLD_SITE_ORIGIN}/tritonplan/`;

/**
 * Where to send the browser after signing in: a path on this site, nothing
 * else. Mirrors the server's rule — to a browser `//host` and `/\host` are
 * other origins. The emailed-link pages go home: their token is spent, so
 * returning there would only leave the planner sitting at /reset or /verify.
 */
export function safeReturnTo(path: string): string {
  if (!path.startsWith('/') || path.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(path)) return '/';
  if (/^\/(reset|verify)\/?$/.test(path.split(/[?#]/)[0]!)) return '/';
  return path;
}
