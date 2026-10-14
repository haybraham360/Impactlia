import type { ReactNode } from "react";

// The workspace's icons: one 16-unit grid, one stroke weight, drawn here so
// there is no icon package to keep in step. Each is decorative; whatever uses
// it supplies the words.

function Icon({ children, className = "size-4" }: { children: ReactNode; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className={`shrink-0 ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

type IconProps = { className?: string };

export function OverviewIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="2" y="2" width="5" height="5" rx="1.25" />
      <rect x="9" y="2" width="5" height="5" rx="1.25" />
      <rect x="2" y="9" width="5" height="5" rx="1.25" />
      <rect x="9" y="9" width="5" height="5" rx="1.25" />
    </Icon>
  );
}

export function PullRequestIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="4" cy="3.5" r="1.75" />
      <circle cx="4" cy="12.5" r="1.75" />
      <circle cx="12" cy="12.5" r="1.75" />
      <path d="M4 5.25v5.5M12 10.75V7a2.5 2.5 0 0 0-2.5-2.5H7m1.5-2L7 4.5 8.5 6" />
    </Icon>
  );
}

export function TraceIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2 4h3l2 4h2l2 4h3" />
      <circle cx="2" cy="4" r="0.5" />
      <path d="M8.5 2.5h5M11 5.5h2.5" />
    </Icon>
  );
}

export function TeamIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="6" cy="5.5" r="2.25" />
      <path d="M2 13.5c.5-2.3 2-3.5 4-3.5s3.5 1.2 4 3.5" />
      <path d="M10.5 3.5a2.25 2.25 0 0 1 0 4.25M12 10.25c1 .5 1.7 1.6 2 3.25" />
    </Icon>
  );
}

export function RepositoryIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 13V3.5A1.5 1.5 0 0 1 5 2h7.5v9.5H5a1.5 1.5 0 0 0-1.5 1.5Zm0 0A1.5 1.5 0 0 0 5 14.5h7.5" />
      <path d="M6 5h4" />
    </Icon>
  );
}

export function MenuIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2 4.5h12M2 8h12M2 11.5h12" />
    </Icon>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
    </Icon>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 8h10M9 4l4 4-4 4" />
    </Icon>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 8.5l3 3 6-7" />
    </Icon>
  );
}

export function SpinnerIcon({ className = "size-4" }: IconProps) {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className={`shrink-0 ${className}`} fill="none">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path
        d="M14 8a6 6 0 0 0-6-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        className="origin-center motion-safe:animate-spin"
      />
    </svg>
  );
}
