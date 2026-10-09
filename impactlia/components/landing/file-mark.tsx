import type { FileState } from "@/lib/landing/example";

// Each state has its own shape as well as its own colour, so the difference
// between changed and potentially affected never rests on colour alone.
const shape: Record<FileState, string> = {
  changed: "size-2 rotate-45 bg-current",
  affected: "size-2 rounded-full border-[1.5px] border-current",
  unreached: "h-px w-2 bg-current",
};

export const stateTone: Record<FileState, string> = {
  changed: "text-accent",
  affected: "text-incoming",
  unreached: "text-muted",
};

export function FileMark({ state }: { state: FileState }) {
  return (
    <span aria-hidden="true" className="flex size-2.5 shrink-0 items-center justify-center">
      <span className={shape[state]} />
    </span>
  );
}
