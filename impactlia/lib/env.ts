// Every required value is read here, once. next.config.ts imports this file,
// so a missing or blank value stops `next dev`, `next build` and `next start`
// with one message naming all of them, instead of surfacing later as a
// confusing provider error.

const missing: string[] = [];

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    missing.push(name);
    return "";
  }
  return value;
}

// A value the application runs without. What is missing is reported where it
// matters instead of stopping the server.
function optional(name: string): string | null {
  return process.env[name]?.trim() || null;
}

function requiredUrl(name: string): string {
  const value = required(name);
  if (value && !URL.canParse(value)) {
    throw new Error(`${name} in .env.local is not a valid URL.`);
  }
  return value;
}

export const env = {
  clerkPublishableKey: required("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"),
  clerkSecretKey: required("CLERK_SECRET_KEY"),
  supabaseUrl: requiredUrl("NEXT_PUBLIC_SUPABASE_URL"),
  supabasePublishableKey: required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
  // Without this the AI explanations are unavailable and say so. Repository
  // and pull request analysis are deterministic and do not use it.
  openaiApiKey: optional("OPENAI_API_KEY"),
  // Without this, AI runs are still recorded in the database but are not sent
  // to LangSmith. The AI runs page says so.
  langsmithApiKey: optional("LANGSMITH_API_KEY"),
};

// Automatic pull request analysis through the Impactlia GitHub App. Every
// value is needed for any of it to work, so it is either all here or off;
// what is missing is named on the pull requests page rather than stopping
// the server, because the rest of Impactlia runs without it.
//
// Server-only values: none of these is NEXT_PUBLIC_, so the bundler never
// puts one in browser code.
export type AutomationConfig = {
  appId: string;
  appSlug: string;
  // PEM. A value in .env.local keeps its line breaks as "\n".
  privateKey: string;
  webhookSecret: string;
  // For the one-time check, when an installation is connected, that the
  // member can see it on GitHub.
  clientId: string;
  clientSecret: string;
  // Bypasses row-level security. Used only by lib/supabase/service.ts.
  supabaseSecretKey: string;
  // Vercel Cron sends it with each call to the retry sweep.
  cronSecret: string;
  // Where the comment's link to the full analysis points.
  appUrl: string;
};

function automationConfig(): { config: AutomationConfig | null; missing: string[] } {
  const vercelUrl = optional("VERCEL_PROJECT_PRODUCTION_URL");
  const values = {
    GITHUB_APP_ID: optional("GITHUB_APP_ID"),
    GITHUB_APP_SLUG: optional("GITHUB_APP_SLUG"),
    GITHUB_APP_PRIVATE_KEY: optional("GITHUB_APP_PRIVATE_KEY"),
    GITHUB_WEBHOOK_SECRET: optional("GITHUB_WEBHOOK_SECRET"),
    GITHUB_APP_CLIENT_ID: optional("GITHUB_APP_CLIENT_ID"),
    GITHUB_APP_CLIENT_SECRET: optional("GITHUB_APP_CLIENT_SECRET"),
    SUPABASE_SECRET_KEY: optional("SUPABASE_SECRET_KEY"),
    CRON_SECRET: optional("CRON_SECRET"),
    APP_URL: optional("APP_URL") ?? (vercelUrl ? `https://${vercelUrl}` : null),
  };
  const absent = Object.entries(values)
    .filter(([, value]) => value === null)
    .map(([name]) => name);
  if (values.APP_URL !== null && !URL.canParse(values.APP_URL)) {
    throw new Error("APP_URL in .env.local is not a valid URL.");
  }
  const v = values;
  if (
    !v.GITHUB_APP_ID || !v.GITHUB_APP_SLUG || !v.GITHUB_APP_PRIVATE_KEY ||
    !v.GITHUB_WEBHOOK_SECRET || !v.GITHUB_APP_CLIENT_ID || !v.GITHUB_APP_CLIENT_SECRET ||
    !v.SUPABASE_SECRET_KEY || !v.CRON_SECRET || !v.APP_URL
  ) {
    return { config: null, missing: absent };
  }
  return {
    config: {
      appId: v.GITHUB_APP_ID,
      appSlug: v.GITHUB_APP_SLUG,
      privateKey: v.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, "\n"),
      webhookSecret: v.GITHUB_WEBHOOK_SECRET,
      clientId: v.GITHUB_APP_CLIENT_ID,
      clientSecret: v.GITHUB_APP_CLIENT_SECRET,
      supabaseSecretKey: v.SUPABASE_SECRET_KEY,
      cronSecret: v.CRON_SECRET,
      appUrl: v.APP_URL.replace(/\/+$/, ""),
    },
    missing: [],
  };
}

export const automation = automationConfig();

if (missing.length > 0) {
  throw new Error(
    `Missing required environment variables: ${missing.join(", ")}. ` +
      "Set them in .env.local next to package.json.",
  );
}
