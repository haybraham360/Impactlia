import { Suspense } from "react";
import { StartFlow } from "@/components/start-flow";

// Where every sign-in and sign-up lands. Behind the sign-in like the rest of
// the app, but needs no workspace yet: it is what sets one up.
export default function StartPage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8 p-6">
      <p className="text-xl font-semibold tracking-tight">Impactlia</p>
      {/* Clerk reads the session in the browser, which cacheComponents only
          allows inside Suspense. */}
      <Suspense>
        <StartFlow />
      </Suspense>
    </div>
  );
}
