"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

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
      className={`cursor-pointer rounded-md px-3.5 py-2 text-sm font-medium whitespace-nowrap disabled:cursor-default disabled:opacity-60 ${
        quiet ? "border border-line bg-surface hover:bg-canvas" : "bg-accent text-accent-ink"
      }`}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
