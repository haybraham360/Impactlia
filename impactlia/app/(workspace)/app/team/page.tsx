import { OrganizationProfile } from "@clerk/nextjs";
import { Suspense } from "react";

export default function TeamPage() {
  return (
    <div>
      <h1 className="text-3xl font-semibold tracking-tight">Team</h1>
      <p className="mt-2 mb-8 text-sm text-muted">
        Invite people to this organization and manage who belongs to it.
      </p>
      {/* Clerk's own members and invitations screen. Hash routing keeps it on
          this one route. */}
      <Suspense>
        <OrganizationProfile routing="hash" />
      </Suspense>
    </div>
  );
}
