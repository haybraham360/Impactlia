"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { SpinnerIcon } from "@/components/icons";

// The button of a form that runs a server action. While the action is running
// it says so and cannot be pressed twice.
export function SubmitButton({
  children,
  pendingLabel,
  quiet = false,
}: {
  children: ReactNode;
  pendingLabel: string;
  // A secondary action: outlined rather than filled.
  quiet?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={`btn btn-small whitespace-nowrap disabled:cursor-default disabled:opacity-70 ${
        quiet ? "btn-secondary" : "btn-primary"
      }`}
    >
      {pending && <SpinnerIcon className="size-3.5" />}
      {pending ? pendingLabel : children}
    </button>
  );
}
