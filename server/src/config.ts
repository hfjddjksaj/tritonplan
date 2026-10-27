export interface Config {
  port: number;
  host: string;
  origin: string;
  dbPath: string;
  cookieSecure: boolean;
  googleClientId: string;
  googleClientSecret: string;
  mail: { transport: 'resend' | 'console' | 'memory'; resendApiKey?: string; from: string };
}

const TRANSPORTS = ['resend', 'console', 'memory'] as const;

export function loadConfig(env: Record<string, string | undefined>): Config {
  const transport = env.TP_MAIL_TRANSPORT || 'resend';
  const missing: string[] = [];
  if (!env.TP_ORIGIN) missing.push('TP_ORIGIN');
  if (!env.TP_DB_PATH) missing.push('TP_DB_PATH');
  if (transport === 'resend') {
    // resend = production. Without the Google pair the server would boot and only fail when someone clicks
    // "Continue with Google", so refuse to start instead.
    if (!env.RESEND_API_KEY) missing.push('RESEND_API_KEY');
    if (!env.GOOGLE_CLIENT_ID) missing.push('GOOGLE_CLIENT_ID');
    if (!env.GOOGLE_CLIENT_SECRET) missing.push('GOOGLE_CLIENT_SECRET');
  }
  // Report every gap at once so a fresh deploy needs one fix pass, not one per variable.
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  if (!(TRANSPORTS as readonly string[]).includes(transport)) {
    throw new Error(`TP_MAIL_TRANSPORT must be one of ${TRANSPORTS.join(', ')}, got "${transport}"`);
  }
  const port = Number(env.TP_PORT || 8787);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`TP_PORT is not a valid port: ${env.TP_PORT}`);

  // Normalized because the write guard compares the Origin header for exact equality, and browsers never send a trailing slash.
  let origin: string;
  try {
    origin = new URL(env.TP_ORIGIN!).origin;
  } catch {
    throw new Error(`TP_ORIGIN is not a valid URL: ${env.TP_ORIGIN}`);
  }
  if (origin === 'null') throw new Error(`TP_ORIGIN is not a valid http(s) origin: ${env.TP_ORIGIN}`);

  return {
    port,
    host: env.TP_HOST || '127.0.0.1',
    origin,
    dbPath: env.TP_DB_PATH!,
    // Secure-by-default: only the literal 'false' (local http dev) turns it off.
    cookieSecure: env.TP_COOKIE_SECURE !== 'false',
    googleClientId: env.GOOGLE_CLIENT_ID ?? '',
    googleClientSecret: env.GOOGLE_CLIENT_SECRET ?? '',
    mail: {
      transport: transport as Config['mail']['transport'],
      resendApiKey: env.RESEND_API_KEY || undefined,
      from: env.TP_MAIL_FROM || 'TritonPlan <noreply@tritonplan.cn>',
    },
  };
}
