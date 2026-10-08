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
};

if (missing.length > 0) {
  throw new Error(
    `Missing required environment variables: ${missing.join(", ")}. ` +
      "Set them in .env.local next to package.json.",
  );
}
