type Runtime = import("@astrojs/cloudflare").Runtime<Env>;

interface Env {
  DB: D1Database;
  SESSION: KVNamespace;
  AI: Ai;
  EMAIL: SendEmail;
  REPORT_FROM: string;
  REPORT_TO: string;
  REPORT_MODEL: string;
  REPORT_FALLBACK_MODEL: string;
  REPORT_TOKEN: string;
}

declare namespace App {
  interface Locals extends Runtime {}
}
