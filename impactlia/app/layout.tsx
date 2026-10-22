import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { START_PATH } from "@/lib/routes";
import { themeScript } from "@/lib/theme";
import "./globals.css";

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400"],
});

export const metadata: Metadata = {
  title: "Impactlia",
  description:
    "Understand what a pull request could affect before it is merged.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The theme script sets data-theme before hydration, so the attribute
    // legitimately differs from the server render.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${plexSans.variable} ${plexMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full font-sans">
        {/* Clerk's own screens use the same colour tokens as the app. */}
        <ClerkProvider
          // Every sign-in and sign-up goes through the start page, which
          // sets up a workspace if there is none and records the person
          // once. Set here so the address has one definition; these win
          // over the environment values.
          signInFallbackRedirectUrl={START_PATH}
          signUpFallbackRedirectUrl={START_PATH}
          appearance={{
            variables: {
              colorPrimary: "var(--accent)",
              colorPrimaryForeground: "var(--accent-ink)",
              colorBackground: "var(--surface)",
              colorForeground: "var(--ink)",
              colorMutedForeground: "var(--muted)",
              colorInput: "var(--surface)",
              colorInputForeground: "var(--ink)",
              colorBorder: "var(--line)",
              fontFamily: "var(--font-plex-sans)",
            },
          }}
        >
          {children}
        </ClerkProvider>
      </body>
    </html>
  );
}
