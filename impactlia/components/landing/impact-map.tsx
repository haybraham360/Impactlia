"use client";

import { useId, useState } from "react";
import { FileMark, stateTone } from "@/components/landing/file-mark";
import {
  connectedTo,
  exampleEdges,
  exampleFiles,
  stateLabel,
  type ExampleFile,
  type FileState,
} from "@/lib/landing/example";

// Positions are fixed pixels, not a scaled drawing, so labels stay the same
// readable size on every screen. Small screens get their own, narrower
// arrangement instead of a shrunken copy of the wide one.
type Layout = {
  width: number;
  height: number;
  nodeWidth: number;
  tiers: { label: string; x: number }[];
  positions: Record<string, { x: number; y: number }>;
  // Keyed "importer>imported". Drawn from the imported file to its importer:
  // the direction a change travels.
  paths: Record<string, string>;
  dividerY: number;
};

const NODE_HEIGHT = 34;
const STEP_MS = 300;

const wide: Layout = {
  width: 480,
  height: 300,
  nodeWidth: 128,
  tiers: [
    { label: "Changed", x: 0 },
    { label: "1 step away", x: 176 },
    { label: "2 steps away", x: 352 },
  ],
  positions: {
    "src/payments/payment.ts": { x: 0, y: 64 },
    "src/payments/currency.ts": { x: 0, y: 136 },
    "src/checkout/checkout.ts": { x: 176, y: 28 },
    "src/billing/invoice.ts": { x: 176, y: 100 },
    "src/payments/refund.ts": { x: 176, y: 172 },
    "src/api/orders.ts": { x: 352, y: 28 },
    "src/emails/receipt.ts": { x: 352, y: 100 },
    "src/auth/session.ts": { x: 0, y: 266 },
  },
  paths: {
    "src/checkout/checkout.ts>src/payments/payment.ts": "M128 81 C152 81 152 45 176 45",
    "src/billing/invoice.ts>src/payments/payment.ts": "M128 81 C152 81 152 111 176 111",
    "src/payments/refund.ts>src/payments/payment.ts": "M128 81 C152 81 152 189 176 189",
    "src/billing/invoice.ts>src/payments/currency.ts": "M128 153 C152 153 152 123 176 123",
    "src/api/orders.ts>src/checkout/checkout.ts": "M304 45 H352",
    "src/emails/receipt.ts>src/billing/invoice.ts": "M304 117 H352",
  },
  dividerY: 232,
};

const compact: Layout = {
  width: 264,
  height: 318,
  nodeWidth: 112,
  tiers: [],
  positions: {
    "src/payments/payment.ts": { x: 0, y: 0 },
    "src/payments/currency.ts": { x: 152, y: 0 },
    "src/checkout/checkout.ts": { x: 0, y: 76 },
    "src/billing/invoice.ts": { x: 152, y: 76 },
    "src/payments/refund.ts": { x: 76, y: 124 },
    "src/api/orders.ts": { x: 0, y: 200 },
    "src/emails/receipt.ts": { x: 152, y: 200 },
    "src/auth/session.ts": { x: 0, y: 284 },
  },
  paths: {
    "src/checkout/checkout.ts>src/payments/payment.ts": "M40 34 V76",
    "src/billing/invoice.ts>src/payments/payment.ts": "M104 34 C104 58 196 52 196 76",
    "src/payments/refund.ts>src/payments/payment.ts": "M76 34 C76 54 132 50 132 70 V124",
    "src/billing/invoice.ts>src/payments/currency.ts": "M224 34 V76",
    "src/api/orders.ts>src/checkout/checkout.ts": "M40 110 V200",
    "src/emails/receipt.ts>src/billing/invoice.ts": "M224 110 V200",
  },
  dividerY: 252,
};

const nodeClass: Record<FileState, string> = {
  changed: "border-accent bg-accent text-accent-ink",
  affected: "border-incoming/70 bg-surface text-ink",
  unreached: "border-dashed border-edge bg-transparent text-muted",
};

// The order things appear in: changed files, the lines leaving them, the
// files those reach, and so on outwards.
function fileStep(file: ExampleFile): number {
  return file.steps === null ? 6 : 1 + file.steps * 2;
}

const stepOf = new Map(exampleFiles.map((file) => [file.id, fileStep(file)]));

function Canvas({
  layout,
  className,
  lit,
  shownId,
  pinned,
  onPreview,
  onPin,
  onClear,
}: {
  layout: Layout;
  className: string;
  lit: ReadonlySet<string> | null;
  shownId: string | null;
  pinned: string | null;
  onPreview: (id: string | null) => void;
  onPin: (id: string) => void;
  onClear: () => void;
}) {
  const arrow = useId();

  return (
    <div
      className={`relative mx-auto ${className}`}
      style={{ width: layout.width, height: layout.height }}
      // A click on the empty part of the map lets go of the selection.
      onClick={(event) => {
        if (event.target === event.currentTarget) onClear();
      }}
    >
      <svg
        aria-hidden="true"
        width={layout.width}
        height={layout.height}
        className="pointer-events-none absolute inset-0 text-incoming"
        fill="none"
      >
        <defs>
          <marker
            id={arrow}
            markerUnits="userSpaceOnUse"
            markerWidth="7"
            markerHeight="7"
            refX="7"
            refY="3.5"
            orient="auto"
          >
            <path d="M0 0L7 3.5L0 7z" fill="currentColor" />
          </marker>
        </defs>
        {exampleEdges.map((edge) => {
          const key = `${edge.source}>${edge.target}`;
          const onPath = lit !== null && lit.has(edge.source) && lit.has(edge.target);
          const dimmed = lit !== null && !onPath;
          return (
            <path
              key={key}
              d={layout.paths[key]}
              pathLength={1}
              stroke="currentColor"
              markerEnd={`url(#${arrow})`}
              className="impact-edge transition-[opacity,stroke-width] duration-150"
              style={{
                animationDelay: `${((stepOf.get(edge.target) ?? 0) + 1) * STEP_MS}ms`,
                opacity: dimmed ? 0.15 : undefined,
                strokeWidth: onPath ? 2 : 1.5,
              }}
            />
          );
        })}
        <path
          d={`M0 ${layout.dividerY} H${layout.width}`}
          className="impact-step text-line"
          stroke="currentColor"
          strokeDasharray="3 4"
          style={{ animationDelay: `${6 * STEP_MS}ms` }}
        />
      </svg>

      {layout.tiers.map((tier) => (
        <span
          key={tier.label}
          className="absolute top-0 text-xs text-muted"
          style={{ left: tier.x }}
        >
          {tier.label}
        </span>
      ))}
      <span
        className="impact-step absolute left-0 text-xs text-muted"
        style={{ top: layout.dividerY + 8, animationDelay: `${6 * STEP_MS}ms` }}
      >
        Not reached from this change
      </span>

      {exampleFiles.map((file) => {
        const position = layout.positions[file.id];
        const dimmed = lit !== null && !lit.has(file.id);
        return (
          <button
            key={file.id}
            type="button"
            aria-pressed={pinned === file.id}
            aria-label={`${file.name}: ${stateLabel[file.state]}. ${file.reason}`}
            onClick={() => onPin(file.id)}
            // Previewing is for a mouse or the keyboard. A touch also fires
            // hover and focus, which would leave a tapped file lit with no
            // way to let go of it, so touch only pins.
            onPointerEnter={(event) => {
              if (event.pointerType === "mouse") onPreview(file.id);
            }}
            onPointerLeave={(event) => {
              if (event.pointerType === "mouse") onPreview(null);
            }}
            onFocus={(event) => {
              if (event.currentTarget.matches(":focus-visible")) onPreview(file.id);
            }}
            onBlur={() => onPreview(null)}
            className={`impact-step absolute flex cursor-pointer items-center gap-1.5 rounded-md border px-2 font-mono text-xs transition-opacity duration-150 aria-pressed:outline-2 aria-pressed:outline-offset-2 aria-pressed:outline-ink ${
              nodeClass[file.state]
            } ${dimmed ? "opacity-30" : ""} ${
              shownId === file.id ? "outline-2 outline-offset-2 outline-ink" : ""
            }`}
            style={{
              left: position.x,
              top: position.y,
              width: layout.nodeWidth,
              height: NODE_HEIGHT,
              animationDelay: `${(stepOf.get(file.id) ?? 0) * STEP_MS}ms`,
            }}
          >
            <FileMark state={file.state} />
            <span className="truncate">{file.name}</span>
          </button>
        );
      })}
    </div>
  );
}

export function ImpactMap() {
  // Pointing at or focusing a file previews it; clicking keeps it.
  const [preview, setPreview] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);

  const shownId = preview ?? pinned;
  const shown = exampleFiles.find((file) => file.id === shownId) ?? null;
  const lit = shownId ? connectedTo(shownId) : null;
  const clear = () => {
    setPreview(null);
    setPinned(null);
  };
  const canvas = {
    lit,
    shownId,
    pinned,
    onPreview: setPreview,
    onPin: (id: string) => setPinned((current) => (current === id ? null : id)),
    onClear: clear,
  };

  return (
    <div
      onKeyDown={(event) => {
        if (event.key === "Escape") clear();
      }}
    >
      <Canvas layout={wide} className="hidden sm:block" {...canvas} />
      <Canvas layout={compact} className="sm:hidden" {...canvas} />

      {/* A fixed height, so the page below does not move as files are
          pointed at. */}
      <div className="mt-4 min-h-17 border-t border-line pt-3 text-[0.8125rem] leading-5">
        {shown ? (
          <>
            <p className="flex flex-wrap items-center gap-x-2">
              <span className="font-mono break-all">{shown.id}</span>
              <span className={`flex items-center gap-1.5 text-xs ${stateTone[shown.state]}`}>
                <FileMark state={shown.state} />
                {stateLabel[shown.state]}
              </span>
              {pinned && (
                <button
                  type="button"
                  onClick={clear}
                  className="ml-auto cursor-pointer text-xs text-muted underline underline-offset-2 transition-colors duration-150 hover:text-ink"
                >
                  Clear selection
                </button>
              )}
            </p>
            <p className="text-muted">{shown.reason}</p>
          </>
        ) : (
          <p className="text-muted">Select a file to see why it is on the map.</p>
        )}
      </div>
    </div>
  );
}
