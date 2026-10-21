import type { RiskAssessment, RiskFactor } from "@/lib/impact/report";
import { LEVEL_RULE } from "@/lib/impact/risk";
import { CONFIDENCE_RULE, FACTOR_RULES, SCORE_RULE } from "@/lib/impact/score";

// How one stored analysis's score was added up. Factors that added points
// come first, each with the measurements behind it; factors that were
// measured and added nothing, or could not be measured, follow, so the reader
// can see what was looked at as well as what was found.

const directionLabels: Record<RiskFactor["direction"], string> = {
  increases_risk: "adds points",
  none_found: "none found",
  reduces_uncertainty: "reduces uncertainty",
  unknown: "not measured",
};

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-muted/50 px-5 py-4 text-sm text-muted">
      {children}
    </p>
  );
}

function Method() {
  return (
    <details className="mt-3 rounded-xl border border-line px-5 py-3 text-sm">
      <summary className="cursor-pointer font-medium">How the score is worked out</summary>
      <p className="mt-3 max-w-prose">{SCORE_RULE}</p>
      <dl className="mt-3 space-y-3">
        {Object.entries(FACTOR_RULES).map(([id, factor]) => (
          <div key={id}>
            <dt className="font-medium">{factor.label}</dt>
            <dd className="text-muted">{factor.rule}</dd>
          </div>
        ))}
      </dl>
      <h3 className="mt-4 font-medium">Confidence</h3>
      <p className="mt-1 max-w-prose text-muted">{CONFIDENCE_RULE}</p>
      <p className="mt-3 max-w-prose text-muted">
        The weights are a first, documented choice and have not been calibrated against the
        outcomes of real pull requests. They will be tuned as they are compared with them.
      </p>
    </details>
  );
}

export function RiskAssessmentDetail({ risk }: { risk: RiskAssessment | null }) {
  if (risk === null) {
    return (
      <>
        <Empty>
          This analysis ran before Impactlia gave a score. Its label is the one worked out then:{" "}
          {LEVEL_RULE} Re-analyze the pull request for a score and the factors behind it.
        </Empty>
        <Method />
      </>
    );
  }
  const adding = risk.factors.filter((factor) => (factor.contribution ?? 0) > 0);
  const rest = risk.factors.filter((factor) => (factor.contribution ?? 0) === 0);
  return (
    <>
      <p className="max-w-prose text-sm">{risk.summary}</p>
      {adding.length > 0 && (
        <ul className="mt-4 space-y-3">
          {adding.map((factor) => (
            <li key={factor.factor} className="panel flex gap-4 px-5 py-4 text-sm">
              <span className="grid h-7 min-w-10 shrink-0 place-items-center rounded-lg border border-caution/50 bg-caution/10 px-1.5 font-mono text-xs text-caution tabular-nums">
                +{factor.contribution}
              </span>
              <div className="min-w-0">
                <p className="text-[0.9375rem] font-medium">{FACTOR_RULES[factor.factor].label}</p>
                <p className="mt-1">{factor.explanation}</p>
                {factor.evidence.length > 0 && (
                  <details className="group mt-2">
                    <summary className="cursor-pointer text-xs text-muted hover:text-ink">
                      <span className="group-open:hidden">Show evidence</span>
                      <span className="hidden group-open:inline">Hide evidence</span>
                    </summary>
                    <ul className="mt-2 list-disc space-y-1 pl-5 break-words text-muted">
                      {factor.evidence.map((fact) => (
                        <li key={fact}>{fact}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {rest.length > 0 && (
        <ul className="panel mt-3 overflow-hidden text-sm">
          {rest.map((factor) => (
            <li
              key={factor.factor}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-line px-5 py-2.5 first:border-t-0"
            >
              <span className="font-medium">{FACTOR_RULES[factor.factor].label}</span>
              <span className="rounded-full border border-line px-2 py-0.5 text-xs text-muted">
                {directionLabels[factor.direction]}
              </span>
              <span className="basis-full text-muted">{factor.explanation}</span>
            </li>
          ))}
        </ul>
      )}
      <div
        className={`mt-3 border-l-2 pl-4 text-sm ${risk.confidence === "high" ? "border-positive" : "border-caution"}`}
      >
        <p>
          <span className="font-medium">Confidence: {risk.confidence}.</span>{" "}
          {risk.confidence === "low"
            ? "Too much could not be analysed to stand behind the number. Treat it as provisional."
            : risk.confidence === "medium"
              ? "Parts of the change or the graph could not be analysed; the score covers the rest."
              : "Every changed source file was analysed and the graph is complete."}
        </p>
        {risk.limitations.length > 0 && (
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted">
            {risk.limitations.map((limitation) => (
              <li key={limitation}>{limitation}</li>
            ))}
          </ul>
        )}
      </div>
      <Method />
    </>
  );
}
