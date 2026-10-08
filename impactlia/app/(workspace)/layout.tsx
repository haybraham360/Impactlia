import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { Suspense } from "react";
import { ThemeControl } from "@/components/theme-control";
import { WorkspaceNav } from "@/components/workspace-nav";

export default function WorkspaceLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <aside className="flex shrink-0 flex-col gap-4 border-b border-line bg-surface p-4 md:w-60 md:border-r md:border-b-0">
        <Link href="/" className="px-2.5 text-base font-semibold tracking-tight">
          Impactlia
        </Link>

        {/* Session-dependent, so it streams in; the rest of the shell is
            prerendered. The fallbacks hold the space to avoid a layout jump. */}
        <div className="min-h-9">
          <Suspense>
            <OrganizationSwitcher
              hidePersonal
              afterSelectOrganizationUrl="/"
              afterCreateOrganizationUrl="/"
            />
          </Suspense>
        </div>

        <Suspense>
          <WorkspaceNav />
        </Suspense>

        <div className="flex items-end justify-between gap-4 md:mt-auto md:flex-col md:items-stretch">
          <ThemeControl />
          <div className="min-h-7">
            <Suspense>
              <UserButton showName />
            </Suspense>
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-6 py-8 md:px-12 md:py-12">
        {children}
      </main>
    </div>
  );
}
