"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { sectionLinks } from "@/lib/landing/sections";
import { SIGN_IN_PATH, SIGN_UP_PATH } from "@/lib/routes";

const MENU_ID = "site-menu";

export function SiteNav() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-canvas/90 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-8 px-4 sm:px-6">
        <Link href="/" className="text-base font-semibold tracking-tight">
          Impactlia
        </Link>

        <nav aria-label="Sections" className="hidden md:block">
          <ul className="flex gap-6 text-sm text-muted">
            {sectionLinks.map((link) => (
              <li key={link.href}>
                <a href={link.href} className="transition-colors duration-150 hover:text-ink">
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="ml-auto flex items-center gap-2 sm:gap-4">
          <Link
            href={SIGN_IN_PATH}
            className="hidden px-2 py-1.5 text-sm text-muted transition-colors duration-150 hover:text-ink sm:block"
          >
            Sign in
          </Link>
          <Link
            href={SIGN_UP_PATH}
            className="rounded-md bg-accent px-3.5 py-1.5 text-sm font-medium text-accent-ink transition-colors duration-150 hover:bg-accent/90 active:bg-accent/80"
          >
            Get started
          </Link>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={MENU_ID}
            onClick={() => setOpen((current) => !current)}
            className="flex size-9 cursor-pointer items-center justify-center rounded-md border border-line transition-colors duration-150 hover:border-ink/40 md:hidden"
          >
            <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
            <svg
              aria-hidden="true"
              viewBox="0 0 16 16"
              className="size-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d={open ? "M3 3l10 10M13 3L3 13" : "M2 4.5h12M2 8h12M2 11.5h12"} />
            </svg>
          </button>
        </div>
      </div>

      <nav
        id={MENU_ID}
        aria-label="Menu"
        hidden={!open}
        className="border-t border-line px-4 py-3 sm:px-6 md:hidden"
      >
        <ul className="text-sm">
          {sectionLinks.map((link) => (
            <li key={link.href}>
              <a href={link.href} onClick={() => setOpen(false)} className="block py-2.5">
                {link.label}
              </a>
            </li>
          ))}
          <li className="sm:hidden">
            <Link href={SIGN_IN_PATH} className="block py-2.5 text-muted">
              Sign in
            </Link>
          </li>
        </ul>
      </nav>
    </header>
  );
}
