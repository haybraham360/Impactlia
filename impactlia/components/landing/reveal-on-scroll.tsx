"use client";

import { useEffect } from "react";

const STATE = "data-reveal-state";

// One observer for every element on the page marked data-reveal, instead of a
// client component around each one, so the sections stay server-rendered.
// The state lives in an attribute React never sets, so a re-render cannot
// undo it. Elements already on screen when this runs are left alone: hiding
// them now would make the page blink.
export function RevealOnScroll() {
  useEffect(() => {
    if (!("IntersectionObserver" in window)) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const { target, isIntersecting, boundingClientRect } of entries) {
          const state = target.getAttribute(STATE);
          if (isIntersecting) {
            if (state === "pending") target.setAttribute(STATE, "shown");
            observer.unobserve(target);
          } else if (state === null) {
            if (boundingClientRect.top >= window.innerHeight) {
              target.setAttribute(STATE, "pending");
            } else {
              observer.unobserve(target);
            }
          }
        }
      },
      // Wait until an element is properly on screen, not just touching it.
      { rootMargin: "0px 0px -40px 0px" },
    );

    for (const element of document.querySelectorAll("[data-reveal]")) {
      observer.observe(element);
    }
    return () => observer.disconnect();
  }, []);

  return null;
}
