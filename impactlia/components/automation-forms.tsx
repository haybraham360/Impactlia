"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { setAutomaticAnalysis } from "@/lib/automation/actions";

// Turns automatic analysis on or off. Turning it on is checked with GitHub,
// and why it was refused is shown next to the button.
export function AutomationToggle({
  repositoryId,
  enabled,
}: {
  repositoryId: string;
  enabled: boolean;
}) {
  const [state, action] = useActionState(setAutomaticAnalysis, null);
  return (
    <form action={action}>
      <input type="hidden" name="repositoryId" value={repositoryId} />
      <input type="hidden" name="enabled" value={enabled ? "false" : "true"} />
      <SubmitButton quiet={enabled} pendingLabel={enabled ? "Turning off…" : "Checking with GitHub…"}>
        {enabled ? "Turn off" : "Turn on automatic analysis"}
      </SubmitButton>
      {state && (
        <p role="alert" className="enter mt-2 max-w-prose border-l-2 border-critical pl-3 text-sm text-critical">
          {state.message}
        </p>
      )}
    </form>
  );
}
