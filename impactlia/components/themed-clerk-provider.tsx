"use client";

import { ClerkProvider } from "@clerk/nextjs";
import { useMemo, useSyncExternalStore, type ReactNode } from "react";

// Clerk draws its own screens (sign-in, sign-up, the account and workspace
// menus, the Team page) and derives its shades from the colours it is given.
// It cannot derive anything from our tokens as written, because each is a
// CSS light-dark() pair behind a var(): it fell back to its own dark grey for
// the primary button while keeping our dark button text, which made the
// button nearly invisible. So Clerk gets plain colours, read from the tokens
// for whichever theme is showing, and new ones whenever the theme changes.

type Scheme = "light" | "dark";

const DARK_QUERY = "(prefers-color-scheme: dark)";

// The theme control sets data-theme on <html>; without it the system wins.
function readScheme(): Scheme {
  const forced = document.documentElement.dataset.theme;
  if (forced === "light" || forced === "dark") return forced;
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

function subscribe(onChange: () => void) {
  const media = window.matchMedia(DARK_QUERY);
  media.addEventListener("change", onChange);
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => {
    media.removeEventListener("change", onChange);
    observer.disconnect();
  };
}

// Clerk's screens only render in the browser, so the server needs no colours.
const serverScheme = () => null;

// A token as the browser resolves it for one scheme, as rgb().
function resolve(token: string, scheme: Scheme): string {
  const probe = document.createElement("span");
  probe.style.colorScheme = scheme;
  probe.style.color = `var(${token})`;
  document.body.appendChild(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color;
}

export function ThemedClerkProvider({
  children,
  signInFallbackRedirectUrl,
  signUpFallbackRedirectUrl,
}: {
  children: ReactNode;
  signInFallbackRedirectUrl: string;
  signUpFallbackRedirectUrl: string;
}) {
  const scheme = useSyncExternalStore(subscribe, readScheme, serverScheme);

  const appearance = useMemo(() => {
    const variables: Record<string, string> = { fontFamily: "var(--font-plex-sans)" };
    if (scheme !== null) {
      const color = (token: string) => resolve(token, scheme);
      Object.assign(variables, {
        colorPrimary: color("--accent"),
        colorPrimaryForeground: color("--accent-ink"),
        colorBackground: color("--surface"),
        colorForeground: color("--ink"),
        colorMutedForeground: color("--muted"),
        colorInput: color("--surface"),
        colorInputForeground: color("--ink"),
        // Clerk fades this for its outlines; globals.css redraws the
        // outlines of its fields and buttons at full strength.
        colorBorder: color("--control-edge"),
        // Clerk draws edges, dividers and hover fills from this colour at a
        // low opacity. Left at its default (black), they vanish in dark mode.
        colorNeutral: color("--ink"),
        colorRing: color("--accent"),
        colorDanger: color("--critical"),
        colorSuccess: color("--positive"),
        colorWarning: color("--caution"),
      });
    }
    return { variables };
  }, [scheme]);

  return (
    <ClerkProvider
      signInFallbackRedirectUrl={signInFallbackRedirectUrl}
      signUpFallbackRedirectUrl={signUpFallbackRedirectUrl}
      appearance={appearance}
    >
      {children}
    </ClerkProvider>
  );
}
