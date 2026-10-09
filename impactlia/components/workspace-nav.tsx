"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TEAM_PATH, WORKSPACE_PATH } from "@/lib/routes";

const available = [
  { href: WORKSPACE_PATH, label: "Overview" },
  { href: TEAM_PATH, label: "Team" },
];

// Shown so the workspace's shape is clear, but not links: none of these exist
// yet and the nav should not pretend otherwise.
const unavailable = ["Repositories", "Pull requests", "Analyses"];

export function WorkspaceNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Workspace" className="text-sm">
      <ul className="flex gap-1 md:flex-col">
        {available.map((item) => {
          const current = pathname === item.href;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={current ? "page" : undefined}
                className="block rounded-md px-2.5 py-1.5 text-muted hover:text-ink aria-[current=page]:bg-canvas aria-[current=page]:font-medium aria-[current=page]:text-ink"
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
      <p className="mt-5 mb-1 hidden px-2.5 text-xs text-muted md:block">
        Not available yet
      </p>
      <ul className="hidden md:block">
        {unavailable.map((label) => (
          <li key={label} className="px-2.5 py-1.5 text-muted/70">
            {label}
          </li>
        ))}
      </ul>
    </nav>
  );
}
