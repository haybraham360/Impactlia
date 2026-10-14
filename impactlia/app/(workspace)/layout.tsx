import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import { Suspense } from "react";
import { ThemeControl } from "@/components/theme-control";
import { WorkspaceShell } from "@/components/workspace-nav";
import { WORKSPACE_PATH } from "@/lib/routes";

export default function WorkspaceLayout({ children }: LayoutProps<"/">) {
  return (
    <WorkspaceShell
      sidebar={
        // Session-dependent, so it streams in; the rest of the shell is
        // prerendered. The fallbacks hold the space to avoid a layout jump.
        <div className="min-h-9 px-1">
          <Suspense>
            <OrganizationSwitcher
              hidePersonal
              afterSelectOrganizationUrl={WORKSPACE_PATH}
              afterCreateOrganizationUrl={WORKSPACE_PATH}
            />
          </Suspense>
        </div>
      }
      footer={
        <>
          <ThemeControl />
          <div className="min-h-7 px-1">
            <Suspense>
              <UserButton showName />
            </Suspense>
          </div>
        </>
      }
    >
      {children}
    </WorkspaceShell>
  );
}
