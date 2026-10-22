import { cacheLife } from "next/cache";
import Link from "next/link";
import type { ReactNode } from "react";
import { ChangeImpactScene } from "@/components/landing/change-impact-scene";
import { DiffToImpact } from "@/components/landing/diff-to-impact";
import { ReportPreview } from "@/components/landing/report-preview";
import { RevealOnScroll } from "@/components/landing/reveal-on-scroll";
import { SiteNav } from "@/components/landing/site-nav";
import { Walkthrough } from "@/components/landing/walkthrough";
import { IMPACT_DEPTH } from "@/lib/impact/risk";
import { exampleChecks } from "@/lib/landing/example-report";
import { sectionLinks } from "@/lib/landing/sections";
import { SIGN_IN_PATH, SIGN_UP_PATH } from "@/lib/routes";

// The public page. It reads no session and no data, so it is fully
// prerendered and looks the same whether or not anyone is signed in.
//
// Every product claim on it was checked against the code when it was
// written: public GitHub repositories only, TypeScript and JavaScript, the
// risk signals in lib/impact/risk.ts, and what the database keeps. Change the
// copy when those change.

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p
      data-reveal
      className="text-xs font-semibold tracking-[0.16em] text-accent uppercase"
    >
      {children}
    </p>
  );
}

function SectionHeading({
  id,
  eyebrow,
  children,
  intro,
  center = false,
}: {
  id: string;
  eyebrow: string;
  children: ReactNode;
  intro?: ReactNode;
  center?: boolean;
}) {
  return (
    <div className={center ? "mx-auto max-w-2xl text-center" : "max-w-2xl"}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2
        id={`${id}-heading`}
        data-reveal
        data-reveal-delay="1"
        className="mt-3 text-3xl leading-tight font-semibold tracking-tight text-balance md:text-[2.75rem]"
      >
        {children}
      </h2>
      {intro && (
        <p data-reveal data-reveal-delay="2" className="mt-4 text-lg text-muted text-pretty">
          {intro}
        </p>
      )}
    </div>
  );
}

function Section({
  id,
  children,
  tone = "plain",
}: {
  id: string;
  children: ReactNode;
  tone?: "plain" | "lifted";
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      className={`scroll-mt-16 ${tone === "lifted" ? "border-y border-line bg-surface/40" : ""}`}
    >
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 md:py-28">{children}</div>
    </section>
  );
}

function Hero() {
  return (
    <section aria-labelledby="hero-heading" className="relative overflow-hidden">
      <div aria-hidden="true" className="landing-glow pointer-events-none absolute inset-0" />
      <div aria-hidden="true" className="landing-grid pointer-events-none absolute inset-0" />
      <div className="relative mx-auto max-w-7xl px-4 pt-14 pb-20 sm:px-6 md:pt-24 md:pb-28">
        <div className="mx-auto max-w-3xl text-center">
          <p className="impact-step inline-flex items-center gap-2 rounded-full border border-line bg-white/[0.03] px-3 py-1 text-xs text-muted">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-positive" />
            Early access · Public GitHub repositories · TypeScript and JavaScript
          </p>
          <h1
            id="hero-heading"
            className="impact-step mt-6 text-[2.5rem] leading-[1.04] font-semibold tracking-tight text-balance sm:text-6xl lg:text-7xl"
            style={{ animationDelay: "60ms" }}
          >
            Know what your code changes{" "}
            <span className="text-spectrum">could affect.</span>
          </h1>
          <p
            className="impact-step mx-auto mt-6 max-w-2xl text-lg text-muted text-pretty"
            style={{ animationDelay: "140ms" }}
          >
            Understand the potential blast radius of a pull request. Trace the parts of your
            codebase connected to it, review evidence-based risk signals, and see what may need
            testing before you merge.
          </p>
          <div
            className="impact-step mt-9 flex flex-wrap justify-center gap-3"
            style={{ animationDelay: "220ms" }}
          >
            <Link href={SIGN_UP_PATH} className="btn btn-primary">
              Try Impactlia
            </Link>
            <a href="#how-it-works" className="btn btn-secondary">
              See how it works
            </a>
          </div>
        </div>

        <div className="mt-14 md:mt-20">
          <ChangeImpactScene />
        </div>
      </div>
    </section>
  );
}

// The same small graph four times, one stage further along each time. Shape
// marks the state as well as colour: a diamond is changed, a ring affected,
// and a tick on a ring is a suggested check.
const miniNodes = [
  { x: 24, y: 26, kind: "changed" },
  { x: 24, y: 54, kind: "changed" },
  { x: 100, y: 12, kind: "affected" },
  { x: 100, y: 40, kind: "affected" },
  { x: 100, y: 68, kind: "affected" },
  { x: 176, y: 12, kind: "affected" },
  { x: 176, y: 40, kind: "affected" },
  { x: 176, y: 68, kind: "unreached" },
] as const;
const miniEdges = [
  [0, 2],
  [0, 3],
  [0, 4],
  [1, 3],
  [2, 5],
  [3, 6],
];
const CHECKED = new Set([3, 2]);

function MiniGraph({ stage }: { stage: 1 | 2 | 3 | 4 }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 200 80" className="h-20 w-[200px] max-w-full" fill="none">
      {miniEdges.map(([from, to]) => (
        <path
          key={`${from}-${to}`}
          d={`M${miniNodes[from].x} ${miniNodes[from].y}L${miniNodes[to].x} ${miniNodes[to].y}`}
          stroke={stage >= 3 ? "var(--incoming)" : "var(--edge)"}
          strokeOpacity={stage >= 3 ? 0.7 : 1}
          strokeWidth="1.25"
        />
      ))}
      {miniNodes.map((node, index) => {
        const key = `${node.x}-${node.y}`;
        if (node.kind === "changed" && stage >= 2) {
          return (
            <rect
              key={key}
              x={node.x - 5}
              y={node.y - 5}
              width="10"
              height="10"
              transform={`rotate(45 ${node.x} ${node.y})`}
              fill="var(--accent)"
            />
          );
        }
        const reached = node.kind === "affected" && stage >= 3;
        const checked = stage === 4 && CHECKED.has(index);
        return (
          <g key={key}>
            <circle
              cx={node.x}
              cy={node.y}
              r={checked ? 7 : 5}
              fill={checked ? "var(--outgoing)" : "var(--surface)"}
              stroke={checked ? "var(--outgoing)" : reached ? "var(--incoming)" : "var(--edge)"}
              strokeWidth={reached ? 2 : 1.25}
            />
            {checked && (
              <path
                d={`M${node.x - 3} ${node.y}l2 2 4-4`}
                stroke="var(--accent-ink)"
                strokeWidth="1.5"
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}

const steps: { title: string; text: string; stage: 1 | 2 | 3 | 4 }[] = [
  {
    title: "Connect a repository",
    text: "Add a public GitHub repository by its URL. Impactlia maps the imports between its TypeScript and JavaScript files.",
    stage: 1,
  },
  {
    title: "Select a pull request",
    text: "Pick one of its pull requests, or enter any number. The analysis starts from the files it changes.",
    stage: 2,
  },
  {
    title: "Trace potential impact",
    text: `From each changed file, the import graph is followed outwards, up to ${IMPACT_DEPTH} steps, to find the files that may be affected.`,
    stage: 3,
  },
  {
    title: "Review what to validate",
    text: "Read the signals behind the risk level, the path to each affected file, and the suggested checks.",
    stage: 4,
  },
];

function HowItWorks() {
  return (
    <Section id="how-it-works">
      <SectionHeading
        id="how-it-works"
        eyebrow="How it works"
        intro="Four steps from a pull request to a report you can act on."
      >
        From pull request to a clearer picture.
      </SectionHeading>
      <ol className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((step, index) => {
          const last = index === steps.length - 1;
          return (
            <li
              key={step.title}
              data-reveal
              data-reveal-delay={index * 2}
              className="panel lift relative p-5"
            >
              <div className="flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-full border border-accent/50 bg-accent/10 font-mono text-sm text-accent tabular-nums">
                  {String(index + 1).padStart(2, "0")}
                </span>
                {/* The line on to the next step, drawn as it scrolls in. */}
                {!last && (
                  <span
                    aria-hidden="true"
                    data-reveal="wipe"
                    data-reveal-delay={index * 2 + 1}
                    className="hidden flex-1 items-center text-edge lg:flex"
                  >
                    <span className="h-px flex-1 bg-linear-to-r from-accent/60 to-incoming/60" />
                    <svg
                      viewBox="0 0 6 8"
                      className="-ml-1 h-2 w-1.5 text-incoming/70"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.25"
                    >
                      <path d="M1 1l4 3-4 3" />
                    </svg>
                  </span>
                )}
              </div>
              <div className="mt-5">
                <MiniGraph stage={step.stage} />
              </div>
              <h3 className="mt-4 font-semibold">{step.title}</h3>
              <p className="mt-1.5 text-sm text-muted">{step.text}</p>
            </li>
          );
        })}
      </ol>
    </Section>
  );
}

function StoryPoint({ title, children }: { title: string; children: ReactNode }) {
  return (
    <li data-reveal className="border-l-2 border-line pl-4 transition-colors duration-200 hover:border-accent">
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-muted">{children}</p>
    </li>
  );
}

function DiffStory() {
  return (
    <Section id="product" tone="lifted">
      <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-16">
        <div>
          <SectionHeading
            id="product"
            eyebrow="From diff to blast radius"
            intro="A pull request shows what was edited. It does not show which other parts of the codebase rely on that code. Impactlia follows the imports to find them."
          >
            A changed file is only the beginning.
          </SectionHeading>
          <ul className="mt-8 space-y-5">
            <StoryPoint title="Changed is not the same as affected.">
              The files a pull request edits are marked as changed. Files that import them are
              potentially affected: worth a look, not evidence of a bug.
            </StoryPoint>
            <StoryPoint title="Every connection has a path.">
              A file is on the list only with the chain of imports that reaches it, so you can
              see why it is there.
            </StoryPoint>
          </ul>
          <dl
            data-reveal
            className="mt-8 grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2"
          >
            <div className="bg-canvas p-4">
              <dt className="text-xs text-muted">Code review asks</dt>
              <dd className="mt-1">“What might be wrong with this code?”</dd>
            </div>
            <div className="bg-surface p-4">
              <dt className="text-xs text-muted">Impactlia asks</dt>
              <dd className="mt-1 font-semibold">“What could this change affect?”</dd>
            </div>
          </dl>
        </div>
        <div data-reveal="panel">
          <DiffToImpact />
        </div>
      </div>
    </Section>
  );
}

function RiskStory() {
  return (
    <Section id="risk">
      <SectionHeading
        id="risk"
        eyebrow="Explainable risk"
        intro="A risk level on its own tells you nothing. Each one in Impactlia comes with the signals that produced it, the rule each signal follows, and what the analysis could not check."
      >
        See why an area deserves a closer look.
      </SectionHeading>
      <div data-reveal="panel" className="mt-12">
        <ReportPreview />
      </div>
      <p data-reveal className="mt-3 text-sm text-muted">
        A drawing of the report for the same made-up pull request. The signal names and
        thresholds are the product’s real ones.
      </p>
    </Section>
  );
}

function ValidationStory() {
  return (
    <Section id="validation" tone="lifted">
      <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
        <div data-reveal="panel" className="order-last lg:order-first">
          <div className="panel overflow-hidden">
            <div className="flex items-center gap-2 border-b border-line px-5 py-3 text-xs text-muted">
              <span className="font-medium tracking-wide uppercase">Suggested checks</span>
              <span className="ml-auto rounded-full border border-dashed border-muted/60 px-2 py-0.5">
                Illustrative example
              </span>
            </div>
            <ol className="divide-y divide-line">
              {exampleChecks.map((check, index) => (
                <li
                  key={check.file}
                  data-reveal
                  data-reveal-delay={index + 1}
                  className="flex gap-4 px-5 py-4 transition-colors duration-150 hover:bg-white/[0.03]"
                >
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-outgoing/50 bg-outgoing/10 font-mono text-xs text-outgoing tabular-nums">
                    {index + 1}
                  </span>
                  <div className="text-sm">
                    <p>{check.body}</p>
                    <p className="mt-1 text-xs text-muted">
                      <span className="text-ink/80">Because:</span> {check.reason}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
            <p className="border-t border-line px-5 py-3 text-xs text-muted">
              A starting point for review. Not a test result, and not a guarantee.
            </p>
          </div>
        </div>
        <div>
          <SectionHeading
            id="validation"
            eyebrow="From findings to validation"
            intro="Impact findings help you decide what to open, read and test before you merge. They guide your judgement; they do not replace it."
          >
            Know where to focus your review.
          </SectionHeading>
          <ul className="mt-8 space-y-5">
            <StoryPoint title="Each check names its reason.">
              A suggested check points at a file and the computed fact behind it, such as which
              changed files it imports.
            </StoryPoint>
            <StoryPoint title="Facts first, AI second.">
              Files, imports, signals and checks come from analysis, not from a model. In the
              repository explorer you can ask an AI model to explain a file or folder. Its
              answer is labelled as interpretation, and it cannot add or change dependencies.
            </StoryPoint>
          </ul>
        </div>
      </div>
    </Section>
  );
}

function WalkthroughSection() {
  return (
    <Section id="walkthrough">
      <SectionHeading
        id="walkthrough"
        eyebrow="Walkthrough"
        center
        intro="Step through one analysis. Each stage shows where its information comes from."
      >
        One pull request, start to finish.
      </SectionHeading>
      <div data-reveal="panel" className="mx-auto mt-12 max-w-5xl">
        <Walkthrough />
      </div>
    </Section>
  );
}

const trustFacts = [
  {
    title: "Public repositories only",
    text: "Impactlia reads public GitHub repositories through GitHub’s public API, without a token. It does not ask you to sign in with GitHub or grant repository permissions, and it cannot see private repositories.",
  },
  {
    title: "Source is read, then deleted",
    text: "To build the dependency map, the repository archive is unpacked into a temporary folder. Only source and JSON files are written out, nothing in the repository is run, and the folder is deleted when the run ends.",
  },
  {
    title: "What is kept",
    text: "The dependency map, meaning file paths and which file imports which, and pull request details such as its title, author and changed file paths. Impactlia’s database does not store your files’ contents or the text of the diff.",
  },
  {
    title: "Your organization only",
    text: "Every repository and analysis belongs to one organization. Database access policies, not only application code, decide who can read it.",
  },
];

function Trust() {
  return (
    <Section id="trust" tone="lifted">
      <SectionHeading
        id="trust"
        eyebrow="Trust"
        intro="Repository access is sensitive, so this is exactly what Impactlia reads and keeps today."
      >
        Built to read only what it needs.
      </SectionHeading>
      <ul className="mt-12 grid gap-4 sm:grid-cols-2">
        {trustFacts.map((fact, index) => (
          <li
            key={fact.title}
            data-reveal
            data-reveal-delay={index}
            className="panel lift p-6"
          >
            <h3 className="font-semibold">{fact.title}</h3>
            <p className="mt-2 text-sm text-muted">{fact.text}</p>
          </li>
        ))}
      </ul>
      <p data-reveal className="mt-6 max-w-3xl text-sm text-muted">
        One exception: when you ask for an AI explanation of a file, that file’s source and its
        listed dependencies are sent to an AI model provider to write the answer, and the request
        is recorded in a trace. Nothing is sent unless you ask.
      </p>
    </Section>
  );
}

function EarlyAccess() {
  return (
    <section aria-labelledby="early-access-heading">
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 md:py-28">
        <div
          data-reveal="panel"
          className="panel grid items-center gap-8 p-6 sm:p-10 md:grid-cols-[minmax(0,1fr)_auto]"
        >
          <div className="max-w-2xl">
            <Eyebrow>Early access</Eyebrow>
            <h2
              id="early-access-heading"
              className="mt-3 text-2xl font-semibold tracking-tight md:text-3xl"
            >
              Early access. Real feedback matters.
            </h2>
            <p className="mt-3 text-muted">
              We’re building Impactlia to make change-impact analysis useful in everyday
              engineering work. Try it on a public repository and tell us what helps, what is
              confusing, and what you would want next.
            </p>
          </div>
          <Link href={SIGN_UP_PATH} className="btn btn-secondary justify-self-start">
            Try Impactlia
          </Link>
        </div>
      </div>
    </section>
  );
}

const questions = [
  {
    question: "Is Impactlia another AI code reviewer?",
    answer:
      "No. It does not judge whether code is correct. It shows what a change could affect across the codebase, so review and testing go where they are needed. It complements code review rather than duplicating it.",
  },
  {
    question: "How does Impactlia work out what a change could affect?",
    answer:
      "It parses the repository’s imports into a dependency graph, then follows that graph outwards from the files the pull request changes. The result is only as complete as the imports it can resolve, and the report says which ones it could not.",
  },
  {
    question: "Does Impactlia guarantee a change will not break production?",
    answer:
      "No. It helps you understand potential impact and choose what to review or test. It cannot prove that a change is safe.",
  },
  {
    question: "Which languages and repositories does it support?",
    answer:
      "TypeScript and JavaScript, including CommonJS, with extra understanding of Next.js, React, Express and NestJS files. Only public GitHub repositories for now; private repositories are not supported yet.",
  },
  {
    question: "Can I use it today?",
    answer:
      "Yes, in early access. Create an account, add a public GitHub repository by its URL, and analyse its pull requests.",
  },
];

function Faq() {
  return (
    <Section id="faq">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)]">
        <SectionHeading id="faq" eyebrow="FAQ">
          Questions
        </SectionHeading>
        <div className="border-b border-line">
          {questions.map((item, index) => (
            <details
              key={item.question}
              data-reveal
              data-reveal-delay={index}
              className="faq-item group border-t border-line"
            >
              <summary className="flex cursor-pointer list-none items-center gap-4 py-5 font-medium transition-colors duration-150 hover:text-accent [&::-webkit-details-marker]:hidden">
                {item.question}
                <svg
                  aria-hidden="true"
                  viewBox="0 0 10 10"
                  className="ml-auto size-2.5 shrink-0 text-muted transition-transform duration-200 group-open:rotate-90 motion-reduce:transition-none"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <path d="M3 1l4 4-4 4" />
                </svg>
              </summary>
              <p className="max-w-2xl pb-5 text-muted">{item.answer}</p>
            </details>
          ))}
        </div>
      </div>
    </Section>
  );
}

function FinalCta() {
  return (
    <section aria-labelledby="cta-heading" className="relative overflow-hidden border-t border-line">
      <div aria-hidden="true" className="landing-glow pointer-events-none absolute inset-0 rotate-180" />
      <div className="relative mx-auto max-w-3xl px-4 py-24 text-center sm:px-6 md:py-32">
        <h2
          id="cta-heading"
          data-reveal
          className="text-3xl leading-tight font-semibold tracking-tight text-balance md:text-5xl"
        >
          See what your next pull request <span className="text-spectrum">could reach.</span>
        </h2>
        <p data-reveal data-reveal-delay="1" className="mt-5 text-lg text-muted">
          Trace the change, read the evidence, and decide what to check before you merge.
        </p>
        <div data-reveal data-reveal-delay="2" className="mt-9 flex flex-wrap justify-center gap-3">
          <Link href={SIGN_UP_PATH} className="btn btn-primary">
            Try Impactlia
          </Link>
          <Link href={SIGN_IN_PATH} className="btn btn-secondary">
            Sign in
          </Link>
        </div>
      </div>
    </section>
  );
}

// Reading the clock is not allowed while prerendering, so the year is cached
// and refreshed daily.
async function CopyrightYear() {
  "use cache";
  cacheLife("days");
  return new Date().getFullYear();
}

function Footer() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-7xl flex-wrap items-start justify-between gap-8 px-4 py-10 text-sm sm:px-6">
        <div>
          <p className="text-base font-semibold tracking-tight">Impactlia</p>
          <p className="mt-1 text-muted">Know what your code changes could affect.</p>
          <p className="mt-6 text-xs text-muted">
            © <CopyrightYear /> Impactlia
          </p>
        </div>
        <nav aria-label="Footer">
          <ul className="flex flex-wrap gap-x-6 gap-y-2 text-muted">
            {sectionLinks.map((link) => (
              <li key={link.href}>
                <a href={link.href} className="transition-colors duration-150 hover:text-ink">
                  {link.label}
                </a>
              </li>
            ))}
            <li>
              <Link href={SIGN_IN_PATH} className="transition-colors duration-150 hover:text-ink">
                Sign in
              </Link>
            </li>
          </ul>
        </nav>
      </div>
    </footer>
  );
}

export default function LandingPage() {
  return (
    <div className="landing min-h-screen">
      <RevealOnScroll />
      <SiteNav />
      <main>
        <Hero />
        <HowItWorks />
        <DiffStory />
        <RiskStory />
        <ValidationStory />
        <WalkthroughSection />
        <Trust />
        <EarlyAccess />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}
