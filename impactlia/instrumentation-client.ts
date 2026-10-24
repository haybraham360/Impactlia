import posthog from "posthog-js";

// Product analytics is optional: without both values nothing is loaded or
// sent. The host is required rather than defaulted because PostHog runs
// separate US and EU clouds and the project decides which one holds the data.
const key = process.env.NEXT_PUBLIC_POSTHOG_KEY?.trim();
const host = process.env.NEXT_PUBLIC_POSTHOG_HOST?.trim();

if (key && host) {
  posthog.init(key, {
    api_host: host,
    defaults: "2026-08-30",
    // Impactlia's screens show customers' private source code, file paths and
    // pull request titles. Autocapture keeps recording clicks and pageviews,
    // but never the text or attributes of the element clicked, and sessions
    // are never recorded, so none of that code leaves for PostHog.
    mask_all_text: true,
    mask_all_element_attributes: true,
    disable_session_recording: true,
    // Anonymous visitors are counted without creating a person profile.
    person_profiles: "identified_only",
  });
}
