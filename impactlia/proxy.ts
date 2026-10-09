import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { CHOOSE_ORGANIZATION_PATH } from "@/lib/routes";

// Everything is protected unless it is listed here, so a route added in a
// later phase is private by default.
const isPublicRoute = createRouteMatcher([
  // The landing page. It reads no session and no data.
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/__clerk(.*)",
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
  // needs one, so a session without it goes to pick or create one.
  if (!orgId && request.nextUrl.pathname !== CHOOSE_ORGANIZATION_PATH) {
    return NextResponse.redirect(new URL(CHOOSE_ORGANIZATION_PATH, request.url));
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/:path*",
  ],
};
