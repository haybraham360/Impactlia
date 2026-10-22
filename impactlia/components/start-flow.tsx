"use client";

import { OrganizationList, useAuth, useOrganizationList } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SpinnerIcon } from "@/components/icons";
import { createWorkspace, finishStart } from "@/lib/onboarding/actions";
import { startStepFor } from "@/lib/onboarding/start";
import { START_PATH, WORKSPACE_PATH } from "@/lib/routes";

// Between signing in and the app. A new person gets a workspace made for
// them; someone with one goes straight in; only someone with several picks.
// Nothing here is asked of the person unless they have a choice to make.

export function StartFlow() {
  const router = useRouter();
  const { isLoaded: authLoaded, orgId } = useAuth();
  const { isLoaded, setActive, userMemberships } = useOrganizationList({ userMemberships: true });
  const [failure, setFailure] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // One run at a time, so a re-render cannot create a second workspace.
  const running = useRef(false);

  const ready = authLoaded && isLoaded && !userMemberships.isLoading;
  const step = ready
    ? startStepFor({ activeOrganization: Boolean(orgId), memberships: userMemberships.count ?? 0 })
    : null;
  const onlyOrganization = userMemberships.data?.[0]?.organization.id ?? null;

  useEffect(() => {
    if (step === null || step === "choose" || running.current || !setActive) return;
    running.current = true;
    (async () => {
      if (step === "create") {
        const created = await createWorkspace();
        if ("message" in created) return created.message;
        await setActive({ organization: created.organizationId });
      } else if (step === "activate" && onlyOrganization) {
        await setActive({ organization: onlyOrganization });
      }
      const finished = await finishStart();
      if (finished) return finished.message;
      router.replace(WORKSPACE_PATH);
      return null;
    })()
      .catch(() => "Your workspace could not be set up. Check your connection and try again.")
      .then((message) => {
        if (message) setFailure(message);
      })
      .finally(() => {
        running.current = false;
      });
  }, [step, attempt, setActive, onlyOrganization, router]);

  if (step === "choose") {
    return (
      <div className="flex flex-col items-center gap-4">
        <p className="max-w-sm text-center text-sm text-muted">
          You belong to more than one workspace. Choose the one to open.
        </p>
        <OrganizationList
          hidePersonal
          afterSelectOrganizationUrl={START_PATH}
          afterCreateOrganizationUrl={START_PATH}
        />
      </div>
    );
  }

  if (failure) {
    return (
      <div role="alert" className="panel max-w-sm px-5 py-4 text-sm">
        <p className="font-medium text-critical">{failure}</p>
        <button
          type="button"
          className="btn btn-primary btn-small mt-4"
          onClick={() => {
            setFailure(null);
            setAttempt((count) => count + 1);
          }}
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="flex max-w-sm flex-col items-center gap-3 text-center">
      <p role="status" className="flex items-center gap-2 font-medium">
        <SpinnerIcon className="size-4" />
        {step === "create" ? "Setting up your workspace…" : "Opening your workspace…"}
      </p>
      <p className="text-sm text-muted">
        Impactlia keeps your account id and your workspace. GitHub is asked for nothing until you
        connect a repository.
      </p>
    </div>
  );
}
