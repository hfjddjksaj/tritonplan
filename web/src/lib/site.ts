/**
 * Where TritonPlan lives. Build-time overridable so a local dev pair (new site
 * + old-site migration page on two ports) can point at each other.
 */
export const SITE_ORIGIN: string = import.meta.env.VITE_SITE_ORIGIN ?? 'https://tritonplan.cn';
export const OLD_SITE_ORIGIN: string = import.meta.env.VITE_OLD_SITE_ORIGIN ?? 'https://hfjddjksaj.github.io';
export const OLD_SITE_URL = `${OLD_SITE_ORIGIN}/tritonplan/`;
