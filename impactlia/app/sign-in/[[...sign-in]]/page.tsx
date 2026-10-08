import { SignIn } from "@clerk/nextjs";
import { Suspense } from "react";

export default function SignInPage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8 p-6">
      <p className="text-xl font-semibold tracking-tight">Impactlia</p>
      {/* Clerk reads the URL at runtime, which cacheComponents only
          allows inside Suspense. */}
      <Suspense>
        <SignIn />
      </Suspense>
    </div>
  );
}
