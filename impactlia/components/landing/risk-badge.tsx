import type { RiskLevel } from "@/lib/impact/report";
import { levelLabel } from "@/lib/landing/example-report";

// The workspace's risk badge, drawn the same way: the bars and the word say
// the level as well as the colour does.
const bars: Record<RiskLevel, number> = { low: 1, medium: 2, high: 3 };
const tone: Record<RiskLevel, string> = {
  low: "text-positive",
  medium: "text-caution",
  high: "text-critical",
};

export function RiskBadge({ level }: { level: RiskLevel }) {
  return (
    <span className={`inline-flex items-center gap-2 font-medium ${tone[level]}`}>
      <span aria-hidden="true" className="flex items-end gap-0.5">
        {[1, 2, 3].map((bar) => (
          <span
            key={bar}
            className={`h-3.5 w-1 rounded-sm bg-current ${bar > bars[level] ? "opacity-20" : ""}`}
          />
        ))}
      </span>
      {levelLabel[level]}
    </span>
  );
}
