import { OrganizationList } from "@clerk/nextjs";
import { Suspense } from "react";
import { WORKSPACE_PATH } from "@/lib/routes";

// The one place a signed-in session without an active organization can end
// up. Sending it to sign-in instead loops forever, because sign-in sees a
// signed-in user and sends them straight back.
export default function ChooseOrganizationPage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8 p-6">
      <p className="text-xl font-semibold tracking-tight">Impactlia</p>
      <Suspense>
        <OrganizationList
          hidePersonal
          afterSelectOrganizationUrl={WORKSPACE_PATH}
          afterCreateOrganizationUrl={WORKSPACE_PATH}
        />
      </Suspense>
    </div>
  );
}
