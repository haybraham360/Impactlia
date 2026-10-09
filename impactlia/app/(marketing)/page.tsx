import { cacheLife } from "next/cache";
import Link from "next/link";
import type { ReactNode } from "react";
import { FileMark, stateTone } from "@/components/landing/file-mark";
import { ImpactMap } from "@/components/landing/impact-map";
import { ReportPreview } from "@/components/landing/report-preview";
import { RevealOnScroll } from "@/components/landing/reveal-on-scroll";
import { SiteNav } from "@/components/landing/site-nav";
import {
  REVIEW_FOCUS,
  affectedFiles,
  changedFiles,
  exampleFiles,
  examplePullRequest,
  stateLabel,
  type FileState,
} from "@/lib/landing/example";
import { sectionLinks } from "@/lib/landing/sections";
import { SIGN_IN_PATH, SIGN_UP_PATH } from "@/lib/routes";

// The public page. It reads no session and no data, so it is fully
// prerendered and looks the same whether or not anyone is signed in.

const primaryButton =
  "rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-accent-ink transition duration-150 hover:bg-accent/90 active:bg-accent/80 motion-safe:hover:-translate-y-px";
const secondaryButton =
  "rounded-md border border-line px-4 py-2.5 text-sm font-medium transition duration-150 hover:border-ink/40 active:bg-surface motion-safe:hover:-translate-y-px";

function Section({
  id,
  heading,
  intro,
  children,
}: {
  id: string;
  heading: string;
  intro?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      className="scroll-mt-14 border-t border-line"
    >
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-24">
        <h2
          id={`${id}-heading`}
          data-reveal
          className="max-w-2xl text-3xl font-semibold tracking-tight text-balance md:text-4xl"
        >
          {heading}
        </h2>
        {intro && (
          <p data-reveal data-reveal-delay="1" className="mt-4 max-w-2xl text-lg text-muted">
            {intro}
          </p>
        )}
        <div className="mt-10 md:mt-12">{children}</div>
      </div>
    </section>
  );
}

function ExampleTag({ children = "Example" }: { children?: ReactNode }) {
  return (
    <span className="rounded border border-dashed border-muted px-1.5 text-xs font-normal text-muted">
      {children}
    </span>
  );
}

function Legend() {
  const states: FileState[] = ["changed", "affected", "unreached"];
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
      {states.map((state) => (
        <li key={state} className="flex items-center gap-1.5">
          <span className={stateTone[state]}>
            <FileMark state={state} />
          </span>
          {stateLabel[state]}
        </li>
      ))}
      <li className="flex items-center gap-1.5">
        <svg
          aria-hidden="true"
          viewBox="0 0 20 8"
          className="h-2 w-5 text-incoming"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="M0 4h18M14.5 1l3.5 3-3.5 3" />
        </svg>
        Is imported by
      </li>
    </ul>
  );
}

function HeroVisual() {
  const focus = exampleFiles.find((file) => file.id === REVIEW_FOCUS);
  const summary = [
    { label: "Changed files", value: changedFiles.length },
    { label: "Potentially affected", value: affectedFiles.length },
  ];

  return (
    <figure
      data-reveal="sequence"
      className="rounded-lg border border-line bg-surface sm:w-[522px]"
    >
      <div className="impact-step flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-4 py-3 text-sm sm:px-5">
        <span className="font-mono text-[0.8125rem] text-muted">
          PR #{examplePullRequest.number}
        </span>
        <span className="font-medium">{examplePullRequest.title}</span>
        <span className="ml-auto">
          <ExampleTag />
        </span>
      </div>

      <p className="sr-only">
        An example impact map. The Pull Request changes payment.ts and currency.ts.{" "}
        {affectedFiles.length} other files import them, directly or through another file, and
        are marked as potentially affected. One file, session.ts, is not reached.
      </p>
      <div className="px-2.5 pt-5 pb-3 sm:px-5">
        <ImpactMap />
      </div>

      <dl
        className="impact-step grid grid-cols-3 divide-x divide-line border-t border-line"
        style={{ animationDelay: "2100ms" }}
      >
        {summary.map((item) => (
          <div key={item.label} className="px-3 py-3 sm:px-5">
            <dt className="text-xs text-muted">{item.label}</dt>
            <dd className="mt-0.5 text-lg font-semibold tabular-nums">{item.value}</dd>
          </div>
        ))}
        <div className="px-3 py-3 sm:px-5">
          <dt className="text-xs text-muted">Review focus</dt>
          <dd className="mt-1.5 font-mono text-[0.8125rem]">{focus?.name}</dd>
        </div>
      </dl>

      <figcaption className="space-y-2 border-t border-line px-4 py-3 sm:px-5">
        <Legend />
        <p className="text-xs text-muted">
          An illustration with made-up files, not an analysis of a real repository.
        </p>
      </figcaption>
    </figure>
  );
}

function Hero() {
  return (
    <section aria-labelledby="hero-heading">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-14 sm:px-6 md:py-20 lg:grid-cols-[minmax(0,1fr)_522px]">
        <div>
          <p className="impact-step text-xs font-medium tracking-[0.14em] text-muted uppercase">
            Code change intelligence
          </p>
          <h1
            id="hero-heading"
            className="impact-step mt-4 text-4xl leading-[1.08] font-semibold tracking-tight text-balance sm:text-5xl"
          >
            Know what your code changes could affect.
          </h1>
          <p
            className="impact-step mt-5 max-w-xl text-lg text-muted"
            style={{ animationDelay: "120ms" }}
          >
            Impactlia maps the relationships inside your codebase to help you understand the
            potential impact of a Pull Request, spot areas that deserve attention, and decide
            what to review or test before you merge.
          </p>
          <div
            className="impact-step mt-8 flex flex-wrap gap-3"
            style={{ animationDelay: "300ms" }}
          >
            <Link href={SIGN_UP_PATH} className={primaryButton}>
              Get started
            </Link>
            <a href="#how-it-works" className={secondaryButton}>
              See how it works
            </a>
          </div>
          <p
            className="impact-step mt-6 max-w-xl text-sm text-muted"
            style={{ animationDelay: "420ms" }}
          >
            In development. The first version is being built for TypeScript and JavaScript
            repositories.
          </p>
        </div>
        <HeroVisual />
      </div>
    </section>
  );
}

const diffLines = [
  { file: "src/payments/payment.ts", added: 42, removed: 17 },
  { file: "src/payments/currency.ts", added: 6, removed: 2 },
];

function Problem() {
  return (
    <Section
      id="problem"
      heading="A small change can reach much further than it looks."
      intro="A Pull Request shows what was edited. It does not always show which other parts of the application rely on the code that changed."
    >
      <div
        data-reveal="panel"
        className="grid gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-2"
      >
        <div className="bg-surface p-5 sm:p-6">
          <h3 className="flex items-center gap-3 font-semibold">
            What a diff shows <ExampleTag />
          </h3>
          <p className="mt-1 text-sm text-muted">The files changed in the Pull Request.</p>
          <ul className="mt-5 space-y-2 font-mono text-[0.8125rem]">
            {diffLines.map((line) => (
              <li key={line.file} className="flex flex-wrap items-center gap-x-2">
                <span className="text-accent">
                  <FileMark state="changed" />
                </span>
                <span className="break-all">{line.file}</span>
                <span className="ml-auto tabular-nums">
                  <span className="text-positive">+{line.added}</span>{" "}
                  <span className="text-critical">−{line.removed}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="bg-surface p-5 sm:p-6">
          <h3 className="font-semibold">What a developer still needs to know</h3>
          <p className="mt-1 text-sm text-muted">What sits on the other side of those files.</p>
          <ul className="mt-5 space-y-2 text-sm">
            <li>Which other files or modules depend on them?</li>
            <li>How far does the change reach?</li>
            <li>What deserves additional review?</li>
          </ul>
        </div>
      </div>
    </Section>
  );
}

// The same small graph three times, one stage further along each time.
const miniNodes = [
  { x: 24, y: 26, stage: 2 },
  { x: 24, y: 54, stage: 2 },
  { x: 100, y: 12, stage: 3 },
  { x: 100, y: 40, stage: 3 },
  { x: 100, y: 68, stage: 3 },
  { x: 176, y: 12, stage: 3 },
  { x: 176, y: 40, stage: 3 },
  { x: 176, y: 68, stage: 0 },
];
const miniEdges = [
  [0, 2],
  [0, 3],
  [0, 4],
  [1, 3],
  [2, 5],
  [3, 6],
];

function MiniGraph({ stage }: { stage: 1 | 2 | 3 }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 200 80" className="h-20 w-[200px] max-w-full" fill="none">
      {miniEdges.map(([from, to]) => (
        <path
          key={`${from}-${to}`}
          d={`M${miniNodes[from].x} ${miniNodes[from].y}L${miniNodes[to].x} ${miniNodes[to].y}`}
          stroke={stage === 3 ? "var(--incoming)" : "var(--edge)"}
          strokeWidth="1.25"
        />
      ))}
      {miniNodes.map((node) => {
        const key = `${node.x}-${node.y}`;
        if (node.stage === 2 && stage >= 2) {
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
        const reached = node.stage === 3 && stage === 3;
        return (
          <circle
            key={key}
            cx={node.x}
            cy={node.y}
            r="5"
            fill="var(--surface)"
            stroke={reached ? "var(--incoming)" : "var(--edge)"}
            strokeWidth={reached ? 2 : 1.25}
          />
        );
      })}
    </svg>
  );
}

const steps: { title: string; text: string; stage: 1 | 2 | 3 }[] = [
  {
    title: "Connect a repository",
    text: "Impactlia starts with the structure of a supported codebase and its real dependency relationships.",
    stage: 1,
  },
  {
    title: "Inspect a Pull Request",
    text: "The analysis begins with the files changed by a PR and traces their relationships through the repository.",
    stage: 2,
  },
  {
    title: "Understand the potential impact",
    text: "Review the affected areas, the reasons they matter, and the parts of the change that may deserve more testing or attention.",
    stage: 3,
  },
];

function HowItWorks() {
  return (
    <Section
      id="how-it-works"
      heading="From Pull Request to a clearer picture."
      intro="This is the workflow Impactlia is being built around. It is in development, so there is nothing to run from this page yet."
    >
      <ol className="grid md:grid-cols-3 md:gap-8">
        {steps.map((step, index) => {
          const last = index === steps.length - 1;
          return (
            <li
              key={step.title}
              data-reveal
              data-reveal-delay={index * 3}
              className="group relative pb-10 pl-11 last:pb-0 md:p-0"
            >
              {/* The line that joins one step to the next: down the side on
                  small screens, across the top on wide ones. */}
              {!last && (
                <span
                  aria-hidden="true"
                  className="absolute top-8 bottom-0 left-3.5 w-px bg-line md:hidden"
                />
              )}
              <div className="flex items-center gap-3">
                <span className="absolute left-0 flex size-7 items-center justify-center rounded-full border border-line bg-surface text-sm font-medium tabular-nums transition-colors duration-200 group-hover:border-ink/40 md:static">
                  {index + 1}
                </span>
                {!last && (
                  <span
                    aria-hidden="true"
                    data-reveal="wipe"
                    data-reveal-delay={index * 3 + 2}
                    className="hidden flex-1 items-center text-edge md:flex"
                  >
                    <span className="h-px flex-1 bg-current" />
                    <svg
                      viewBox="0 0 6 8"
                      className="-ml-1.5 h-2 w-1.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.25"
                    >
                      <path d="M1 1l4 3-4 3" />
                    </svg>
                  </span>
                )}
              </div>
              <div className="md:mt-5">
                <MiniGraph stage={step.stage} />
              </div>
              <h3 className="mt-4 font-semibold">{step.title}</h3>
              <p className="mt-1.5 max-w-sm text-sm text-muted">{step.text}</p>
            </li>
          );
        })}
      </ol>
    </Section>
  );
}

function ProductPreview() {
  return (
    <Section
      id="preview"
      heading="See beyond the changed files."
      intro="When a Pull Request changes a file, the files that use it can be affected too. An impact report lists both, and shows how each one is connected to the change."
    >
      <div data-reveal="panel">
        <ReportPreview />
      </div>
      <p data-reveal className="mt-3 text-sm text-muted">
        This is a drawing of the report, using the same made-up Pull Request as above. It is
        not output from a real repository.
      </p>
    </Section>
  );
}

const valuePoints = [
  {
    title: "See the reach of a change.",
    text: "Trace direct and indirect relationships across the codebase.",
  },
  {
    title: "Understand why an area matters.",
    text: "Make the relationship between a changed file and a potentially affected file visible.",
  },
  {
    title: "Know where to look next.",
    text: "Use the analysis to guide review and validation, not to replace engineering judgement.",
  },
];

function WhyImpactlia() {
  return (
    <Section id="why-impactlia" heading="Not just what changed. What it could affect.">
      <ul className="grid gap-8 md:grid-cols-3">
        {valuePoints.map((point, index) => (
          <li key={point.title} data-reveal data-reveal-delay={index}>
            <h3 className="font-semibold">{point.title}</h3>
            <p className="mt-1.5 text-muted">{point.text}</p>
          </li>
        ))}
      </ul>
      <dl
        data-reveal="panel"
        className="mt-12 grid gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-2"
      >
        <div className="bg-canvas p-5 sm:p-6">
          <dt className="text-sm text-muted">General code review asks</dt>
          <dd className="mt-2 text-xl">“What might be wrong with this code?”</dd>
        </div>
        <div className="bg-surface p-5 sm:p-6">
          <dt className="text-sm text-muted">Impactlia asks</dt>
          <dd className="mt-2 text-xl font-semibold">“What could this change affect?”</dd>
        </div>
      </dl>
    </Section>
  );
}

const principles = [
  {
    title: "Real code relationships",
    text: "Connections are read from the imports in your repository, not guessed.",
  },
  {
    title: "Traceable impact paths",
    text: "A file is listed as potentially affected only with the path that leads to it.",
  },
  {
    title: "Explainable signals",
    text: "An attention level comes with the signals it is based on.",
  },
  {
    title: "Visible analysis limitations",
    text: "An import that cannot be resolved is reported, not quietly dropped.",
  },
];

function Evidence() {
  return (
    <Section
      id="evidence"
      heading="Useful analysis starts with real code relationships."
      intro="Impactlia uses code structure and dependency relationships as the foundation for its analysis. Explanations and recommendations are grounded in that evidence. When a relationship cannot be resolved, the product says so instead of pretending to know."
    >
      <dl className="grid gap-x-8 sm:grid-cols-2 lg:grid-cols-4">
        {principles.map((principle, index) => (
          <div
            key={principle.title}
            data-reveal
            data-reveal-delay={index}
            className="border-t border-line py-5 transition-colors duration-200 hover:border-ink/40"
          >
            <dt className="font-semibold">{principle.title}</dt>
            <dd className="mt-1.5 text-sm text-muted">{principle.text}</dd>
          </div>
        ))}
      </dl>
      <p data-reveal className="mt-6 max-w-2xl text-sm text-muted">
        The scope today is TypeScript and JavaScript. Some relationships cannot be read from
        source code, such as an import path that is built at runtime. Those are shown as
        unresolved, and what lies behind them is not counted.
      </p>
    </Section>
  );
}

const audiences = [
  {
    title: "Developers in unfamiliar or complex codebases",
    text: "See what depends on a file before you change it, without tracing every import by hand.",
  },
  {
    title: "Teams shipping changes frequently",
    text: "Give each Pull Request a quick answer to how far it reaches.",
  },
  {
    title: "Teams using AI-assisted coding tools",
    text: "When code is written faster, knowing what each change touches is worth more.",
  },
  {
    title: "Engineering leads",
    text: "Point review time at the areas a change could actually reach.",
  },
];

function Audience() {
  return (
    <Section id="who-it-is-for" heading="Built for teams moving quickly through code.">
      <ul className="grid gap-x-8 sm:grid-cols-2">
        {audiences.map((audience, index) => (
          <li
            key={audience.title}
            data-reveal
            data-reveal-delay={index % 2}
            className="border-t border-line py-5 transition-colors duration-200 hover:border-ink/40"
          >
            <h3 className="font-semibold">{audience.title}</h3>
            <p className="mt-1.5 text-sm text-muted">{audience.text}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}

const questions = [
  {
    question: "Is Impactlia another AI code reviewer?",
    answer:
      "No. Impactlia focuses on understanding the potential impact of a change across the codebase. It is designed to complement code review, not duplicate it.",
  },
  {
    question: "How does Impactlia understand what a change could affect?",
    answer:
      "It uses repository structure and dependency relationships to trace how changed files connect to other parts of the codebase. The quality of the result depends on what the analysis can resolve.",
  },
  {
    question: "Does Impactlia guarantee a change will not break production?",
    answer:
      "No. It helps teams understand potential impact and identify areas for review or testing. It cannot guarantee that a change is safe.",
  },
  {
    question: "Which languages does it support?",
    answer:
      "TypeScript and JavaScript. Other languages are not supported yet, and there is no date for them.",
  },
  {
    question: "Can I use it today?",
    answer:
      "Partly. Impactlia is still being built. Today you can create an account and set up a workspace for your team. Connecting a repository and analysing a Pull Request are not available yet.",
  },
];

function Faq() {
  return (
    <Section id="faq" heading="Questions">
      <div className="max-w-3xl border-b border-line">
        {questions.map((item, index) => (
          <details
            key={item.question}
            data-reveal
            data-reveal-delay={index}
            className="faq-item group border-t border-line"
          >
            <summary className="flex cursor-pointer list-none items-center gap-4 py-4 font-medium transition-colors duration-150 hover:text-accent [&::-webkit-details-marker]:hidden">
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
    </Section>
  );
}

function FinalCta() {
  return (
    <section aria-labelledby="cta-heading" className="border-t border-line bg-surface">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-24">
        <h2
          id="cta-heading"
          data-reveal
          className="max-w-2xl text-3xl font-semibold tracking-tight text-balance md:text-4xl"
        >
          Understand the change before it ships.
        </h2>
        <p data-reveal data-reveal-delay="1" className="mt-4 max-w-2xl text-lg text-muted">
          Make the potential reach of a Pull Request easier to see, explain, and review.
        </p>
        <Link
          href={SIGN_UP_PATH}
          data-reveal
          data-reveal-delay="2"
          className={`mt-8 inline-block ${primaryButton}`}
        >
          Get started
        </Link>
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
      <div className="mx-auto flex max-w-6xl flex-wrap items-start justify-between gap-8 px-4 py-10 text-sm sm:px-6">
        <div>
          <p className="text-base font-semibold tracking-tight">Impactlia</p>
          <p className="mt-1 text-muted">Code change intelligence for engineering teams.</p>
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
    <>
      <RevealOnScroll />
      <SiteNav />
      <main>
        <Hero />
        <Problem />
        <HowItWorks />
        <ProductPreview />
        <WhyImpactlia />
        <Evidence />
        <Audience />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
    </>
  );
}
