import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import {
  AUTOMATION_SWEEP_PATH,
  CHOOSE_ORGANIZATION_PATH,
  START_PATH,
  GITHUB_WEBHOOK_PATH,
} from "@/lib/routes";

// Everything is protected unless it is listed here, so a route added in a
// later phase is private by default.
const isPublicRoute = createRouteMatcher([
  // The landing page. It reads no session and no data.
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/__clerk(.*)",
  // Called by GitHub and by Vercel Cron. Each checks its own secret: the
  // webhook signature and the cron bearer token.
  GITHUB_WEBHOOK_PATH,
  AUTOMATION_SWEEP_PATH,
  // The parser preview shows a file from the developer's own disk and needs
  // no session. The page itself does not exist outside development.
  ...(process.env.NODE_ENV === "development" ? ["/preview"] : []),
]);

export default clerkMiddleware(async (auth, request) => {
  if (isPublicRoute(request)) {
    return;
  }

  const { orgId } = await auth.protect();

  // Signed in is not the same as being in an organization. The workspace
  // needs one, so a session without it goes to the start page, which sets
  // one up or opens the one there is.
  const { pathname } = request.nextUrl;
  if (!orgId && pathname !== START_PATH && pathname !== CHOOSE_ORGANIZATION_PATH) {
    return NextResponse.redirect(new URL(START_PATH, request.url));
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/:path*",
  ],
};
