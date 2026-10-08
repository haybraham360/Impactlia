// The one mark for dependency direction, used on the graph's lines, in file
// rows and in the detail pane: solid for what depends on the selection,
// dashed for what the selection depends on.
export function DirectionMark({ direction }: { direction: "incoming" | "outgoing" }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 6"
      className={`h-1.5 w-4 shrink-0 ${
        direction === "incoming" ? "text-incoming" : "text-outgoing"
      }`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M0 3h16" strokeDasharray={direction === "outgoing" ? "4 3" : undefined} />
    </svg>
  );
}
