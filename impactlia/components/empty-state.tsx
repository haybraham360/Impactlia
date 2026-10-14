import type { ReactNode } from "react";

// A panel for "nothing here yet": a small drawing of what will be here, what
// it is for, and the one real next step. The drawings use the same marks as
// the product (a diamond is a changed file, a ring a file that imports it) so
// they teach the vocabulary rather than decorate.

type Kind = "repository" | "pull-request" | "report";

function RepositoryDrawing() {
  return (
    <svg aria-hidden="true" viewBox="0 0 168 104" className="h-26 w-42" fill="none">
      <rect x="8" y="14" width="52" height="68" rx="8" fill="var(--raised)" stroke="var(--line)" />
      <path d="M18 30h24M18 40h32M18 50h18M18 60h28" stroke="var(--edge)" strokeWidth="2" strokeLinecap="round" />
      <path d="M60 48c18 0 18-24 36-24M60 48c18 0 18 24 36 24M112 24c12 0 12 12 24 12" stroke="var(--edge)" strokeWidth="1.5" strokeDasharray="3 3" />
      <rect x="98" y="16" width="16" height="16" rx="3" transform="rotate(45 106 24)" fill="var(--accent)" />
      <circle cx="106" cy="72" r="8" fill="var(--surface)" stroke="var(--incoming)" strokeWidth="2" />
      <circle cx="146" cy="36" r="8" fill="var(--surface)" stroke="var(--incoming)" strokeWidth="2" />
    </svg>
  );
}

function PullRequestDrawing() {
  return (
    <svg aria-hidden="true" viewBox="0 0 168 104" className="h-26 w-42" fill="none">
      <rect x="28" y="10" width="112" height="84" rx="10" fill="var(--raised)" stroke="var(--line)" />
      <circle cx="48" cy="30" r="5" stroke="var(--accent)" strokeWidth="2" />
      <circle cx="48" cy="74" r="5" stroke="var(--accent)" strokeWidth="2" />
      <path d="M48 35v34M90 69V50a10 10 0 0 0-10-10H62" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" />
      <circle cx="90" cy="74" r="5" stroke="var(--accent)" strokeWidth="2" />
      <path d="M104 30h24M104 42h16" stroke="var(--edge)" strokeWidth="2" strokeLinecap="round" />
      <rect x="110" y="62" width="12" height="12" rx="2" transform="rotate(45 116 68)" fill="var(--incoming)" opacity="0.85" />
    </svg>
  );
}

function ReportDrawing() {
  return (
    <svg aria-hidden="true" viewBox="0 0 168 104" className="h-26 w-42" fill="none">
      <rect x="40" y="8" width="88" height="88" rx="10" fill="var(--raised)" stroke="var(--line)" />
      <path d="M54 26h40" stroke="var(--edge)" strokeWidth="2" strokeLinecap="round" />
      <rect x="54" y="38" width="4" height="10" rx="1.5" fill="var(--caution)" />
      <rect x="61" y="34" width="4" height="14" rx="1.5" fill="var(--caution)" />
      <rect x="68" y="30" width="4" height="18" rx="1.5" fill="var(--caution)" opacity="0.25" />
      {[60, 74].map((y) => (
        <g key={y}>
          <rect x="54" y={y - 5} width="10" height="10" rx="3" stroke="var(--outgoing)" strokeWidth="1.5" />
          <path d={`M56.5 ${y}l2 2 3.5-4`} stroke="var(--outgoing)" strokeWidth="1.5" />
          <path d={`M70 ${y}h${y === 60 ? 42 : 30}`} stroke="var(--edge)" strokeWidth="2" strokeLinecap="round" />
        </g>
      ))}
    </svg>
  );
}

const drawings: Record<Kind, () => ReactNode> = {
  repository: RepositoryDrawing,
  "pull-request": PullRequestDrawing,
  report: ReportDrawing,
};

export function EmptyState({
  kind,
  title,
  children,
  action,
}: {
  kind: Kind;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  const Drawing = drawings[kind];
  return (
    <div className="panel flex flex-col items-center gap-6 px-6 py-8 text-center sm:flex-row sm:items-center sm:gap-8 sm:px-8 sm:text-left">
      <div className="shrink-0">
        <Drawing />
      </div>
      <div className="min-w-0">
        <p className="text-base font-semibold">{title}</p>
        <div className="mt-1.5 max-w-prose space-y-2 text-sm text-muted">{children}</div>
        {action && <div className="mt-4 flex flex-wrap justify-center gap-3 sm:justify-start">{action}</div>}
      </div>
    </div>
  );
}
