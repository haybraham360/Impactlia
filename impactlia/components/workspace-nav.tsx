"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import {
  CloseIcon,
  MenuIcon,
  OverviewIcon,
  PullRequestIcon,
  TeamIcon,
  TraceIcon,
} from "@/components/icons";
import {
  AI_RUNS_PATH,
  PULL_REQUESTS_PATH,
  TEAM_PATH,
  WORKSPACE_PATH,
} from "@/lib/routes";

// Every destination here is a route that exists. Pages without an entry of
// their own belong to the section they are reached from: a repository run to
// the overview, where repositories are added, and an analysis to pull
// requests, where it is started.
const sections = [
  {
    href: WORKSPACE_PATH,
    label: "Overview",
    icon: OverviewIcon,
    owns: (path: string) => path === WORKSPACE_PATH || path.startsWith(`${WORKSPACE_PATH}/runs/`),
  },
  {
    href: PULL_REQUESTS_PATH,
    label: "Pull requests",
    icon: PullRequestIcon,
    owns: (path: string) =>
      path === PULL_REQUESTS_PATH || path.startsWith(`${WORKSPACE_PATH}/analyses/`),
  },
  {
    href: AI_RUNS_PATH,
    label: "AI runs",
    icon: TraceIcon,
    owns: (path: string) => path === AI_RUNS_PATH,
  },
  {
    href: TEAM_PATH,
    label: "Team",
    icon: TeamIcon,
    owns: (path: string) => path === TEAM_PATH,
  },
];

const titles: { match: (path: string) => boolean; title: string }[] = [
  { match: (path) => path.startsWith(`${WORKSPACE_PATH}/runs/`), title: "Repository analysis" },
  { match: (path) => path.startsWith(`${WORKSPACE_PATH}/analyses/`), title: "Pull request analysis" },
];

function titleOf(path: string): string {
  return (
    titles.find((entry) => entry.match(path))?.title ??
    sections.find((section) => section.owns(path))?.label ??
    "Impactlia"
  );
}

const DRAWER_ID = "workspace-sidebar";

function SectionLinks({ onNavigate }: { onNavigate: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Workspace" className="text-sm">
      <ul className="space-y-0.5">
        {sections.map(({ href, label, icon: SectionIcon, owns }) => {
          const current = owns(pathname);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={current ? "page" : undefined}
                onClick={onNavigate}
                className="group relative flex items-center gap-3 rounded-lg px-3 py-2 text-muted transition-colors duration-150 hover:bg-hover hover:text-ink aria-[current=page]:bg-accent/12 aria-[current=page]:font-medium aria-[current=page]:text-ink"
              >
                {/* The marker for where you are: a bar as well as a fill. */}
                <span
                  aria-hidden="true"
                  className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-accent opacity-0 transition-opacity duration-150 group-aria-[current=page]:opacity-100"
                />
                <SectionIcon className="size-4 transition-colors duration-150 group-hover:text-ink group-aria-[current=page]:text-accent" />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function PageTitle() {
  return <p className="truncate text-sm font-medium">{titleOf(usePathname())}</p>;
}

// The page's main action, everywhere but the page it leads to.
function AnalyzeAction() {
  if (usePathname() === PULL_REQUESTS_PATH) return null;
  return (
    <Link href={PULL_REQUESTS_PATH} className="btn btn-primary btn-small ml-auto shrink-0">
      <PullRequestIcon className="size-3.5" />
      <span className="hidden sm:inline">Analyze a pull request</span>
      <span className="sm:hidden">Analyze</span>
    </Link>
  );
}

// The shell around every workspace page. The sidebar is a column on wide
// screens and a drawer on narrow ones; the same elements either way, so the
// session controls inside it are mounted once.
export function WorkspaceShell({
  sidebar,
  footer,
  children,
}: {
  // Above and below the section links: the organization, theme and account.
  sidebar: ReactNode;
  footer: ReactNode;
  children: ReactNode;
}) {
  // Reading the path suspends while the page is prerendered, so only the
  // small parts that need it do, each behind its own boundary, and the shell
  // itself stays static.
  const [open, setOpen] = useState(false);
  const closeButton = useRef<HTMLButtonElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        menuButton.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <div className="flex min-h-dvh">
      {open && (
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 cursor-default bg-black/50 md:hidden"
        />
      )}
      <aside
        id={DRAWER_ID}
        aria-label="Workspace navigation"
        className={`flex-col gap-5 border-r border-line bg-surface p-4 md:sticky md:top-0 md:flex md:h-dvh md:w-60 md:shrink-0 ${
          open
            ? "enter flex max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-40 max-md:w-72 max-md:overflow-y-auto max-md:shadow-2xl"
            : "hidden"
        }`}
      >
        <div className="flex items-center justify-between">
          <Link href={WORKSPACE_PATH} className="px-3 text-base font-semibold tracking-tight">
            Impactlia
          </Link>
          <button
            ref={closeButton}
            type="button"
            onClick={() => setOpen(false)}
            className="flex size-10 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-hover hover:text-ink md:hidden"
          >
            <CloseIcon />
            <span className="sr-only">Close navigation</span>
          </button>
        </div>
        {sidebar}
        <Suspense>
          <SectionLinks onNavigate={() => setOpen(false)} />
        </Suspense>
        <div className="mt-auto flex flex-col gap-4">{footer}</div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-canvas/85 px-4 backdrop-blur-md sm:px-6 md:px-10">
          <button
            ref={menuButton}
            type="button"
            aria-expanded={open}
            aria-controls={DRAWER_ID}
            onClick={() => setOpen(true)}
            className="-ml-2 flex size-10 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-hover hover:text-ink md:hidden"
          >
            <MenuIcon />
            <span className="sr-only">Open navigation</span>
          </button>
          <Suspense>
            <PageTitle />
          </Suspense>
          <Suspense>
            <AnalyzeAction />
          </Suspense>
        </header>
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 md:px-10 md:py-10">{children}</main>
      </div>
    </div>
  );
}
