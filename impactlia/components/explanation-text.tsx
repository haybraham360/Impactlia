"use client";

import { Component, useMemo, type ReactNode } from "react";
import { parseExplanation, type Block, type Inline } from "@/lib/ai/markdown";

// Draws a model's answer. The only elements this can produce are paragraphs,
// bulleted lists, bold text, inline code and a button that selects a file. The
// text is never turned into HTML, so nothing in it can become a link, an image
// or markup.

type SelectFile = (fileId: string) => void;

function Parts({
  parts,
  knownFiles,
  onSelectFile,
}: {
  parts: Inline[];
  knownFiles: ReadonlySet<string>;
  onSelectFile: SelectFile;
}) {
  return parts.map((part, index) => {
    if (part.type === "text") return <span key={index}>{part.text}</span>;
    if (part.type === "bold") {
      return (
        <strong key={index} className="font-medium">
          <Parts parts={part.children} knownFiles={knownFiles} onSelectFile={onSelectFile} />
        </strong>
      );
    }
    // A path becomes a way to select a file only when it is, character for
    // character, a file in the analysis on screen. Anything else a model
    // writes in backticks stays text.
    return knownFiles.has(part.text) ? (
      <button
        key={index}
        type="button"
        title={`Select ${part.text}`}
        onClick={() => onSelectFile(part.text)}
        className="cursor-pointer text-left font-mono text-[0.8125rem] break-all text-accent hover:underline"
      >
        {part.text}
      </button>
    ) : (
      <code key={index} className="font-mono text-[0.8125rem] break-all">
        {part.text}
      </code>
    );
  });
}

function Blocks({
  blocks,
  knownFiles,
  onSelectFile,
}: {
  blocks: Block[];
  knownFiles: ReadonlySet<string>;
  onSelectFile: SelectFile;
}) {
  return (
    <div className="space-y-2 break-words">
      {blocks.map((block, index) =>
        block.type === "paragraph" ? (
          <p key={index}>
            <Parts parts={block.content} knownFiles={knownFiles} onSelectFile={onSelectFile} />
          </p>
        ) : (
          <ul key={index} className="list-disc space-y-1 pl-4 marker:text-muted">
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex}>
                <Parts parts={item} knownFiles={knownFiles} onSelectFile={onSelectFile} />
              </li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}

const PlainText = ({ text }: { text: string }) => (
  <p className="break-words whitespace-pre-wrap">{text}</p>
);

// If drawing the formatted answer throws, the answer is still shown, as the
// text the model wrote.
class PlainTextOnError extends Component<{ text: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <PlainText text={this.props.text} /> : this.props.children;
  }
}

export function ExplanationText({
  text,
  knownFiles,
  onSelectFile,
}: {
  text: string;
  knownFiles: ReadonlySet<string>;
  onSelectFile: SelectFile;
}) {
  const blocks = useMemo(() => {
    try {
      return parseExplanation(text);
    } catch {
      return null;
    }
  }, [text]);
  if (!blocks || blocks.length === 0) return <PlainText text={text} />;
  return (
    // Keyed by the text, so a failure on one answer does not stick to the next.
    <PlainTextOnError key={text} text={text}>
      <Blocks blocks={blocks} knownFiles={knownFiles} onSelectFile={onSelectFile} />
    </PlainTextOnError>
  );
}
