import { SignUp } from "@clerk/nextjs";
import { Suspense } from "react";

export default function SignUpPage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8 p-6">
      <p className="text-xl font-semibold tracking-tight">Impactlia</p>
      {/* Clerk reads the URL at runtime, which cacheComponents only
          allows inside Suspense. */}
      <Suspense>
        <SignUp />
      </Suspense>
      <p className="max-w-sm text-center text-sm text-muted">
        A workspace is set up for you straight after. Impactlia keeps your account id and that
        workspace. Signing in with GitHub shares your public profile and email, nothing else. Repository access is
        asked for separately, and only when you connect GitHub.
      </p>
    </div>
  );
}
