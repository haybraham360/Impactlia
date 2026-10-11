// Reads a model's answer into the only three things the detail pane renders:
// bulleted lists, bold text and inline code. Everything else Markdown or HTML
// can express is reduced to its plain text, so nothing a model writes can
// become a heading, a link, an image or markup, and no formatting characters
// are left behind as noise.
//
// The result is plain data. Nothing here produces HTML; the component that
// draws it creates elements itself.

export type Inline =
  | { type: "text"; text: string }
  | { type: "code"; text: string }
  | { type: "bold"; children: Inline[] };

export type Block =
  | { type: "paragraph"; content: Inline[] }
  | { type: "list"; items: Inline[][] };

// Outside code, in order: images and links keep their text and lose their
// address, HTML tags and comments go, then leftover emphasis and strike marks.
function plain(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/!?\[([^\]]*)\]\[[^\]]*\]/g, "$1")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\/?[a-zA-Z][^>]*>/g, "")
    .replace(/~~/g, "")
    .replace(/\*\*/g, "")
    .replace(/(^|[^\w*])\*([^*\s][^*]*)\*(?!\w)/g, "$1$2")
    .replace(/(^|[^\w_])_([^_\s][^_]*)_(?!\w)/g, "$1$2");
}

// Splits on inline code first, because nothing inside backticks is formatting.
function codeAndText(text: string, into: Inline[]): void {
  const parts = text.split(/(`+)([^`]+?)\1/g);
  // split() with two groups yields: text, ticks, code, text, ticks, code, …
  for (let index = 0; index < parts.length; index += 3) {
    const before = plain(parts[index]).replace(/`/g, "");
    if (before !== "") into.push({ type: "text", text: before });
    const code = parts[index + 2];
    if (code !== undefined && code.trim() !== "") into.push({ type: "code", text: code.trim() });
  }
}

export function parseInline(text: string): Inline[] {
  const inline: Inline[] = [];
  // Bold is found before code so that **`path`** keeps both. A bold marker
  // inside backticks is still read as bold, which costs nothing: code never
  // legitimately needs ** in an explanation.
  const parts = text.split(/\*\*(?=\S)([\s\S]+?)(?<=\S)\*\*/g);
  parts.forEach((part, index) => {
    if (index % 2 === 0) {
      codeAndText(part, inline);
    } else {
      const children: Inline[] = [];
      codeAndText(part, children);
      if (children.length > 0) inline.push({ type: "bold", children });
    }
  });
  return inline;
}

const BULLET = /^\s*[-*+•]\s+(.*)$/;
const FENCE = /^\s*(```|~~~)/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;

export function parseExplanation(text: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let items: Inline[][] | null = null;
  const closeParagraph = () => {
    if (paragraph.length > 0) {
      const content = parseInline(paragraph.join(" "));
      if (content.length > 0) blocks.push({ type: "paragraph", content });
      paragraph = [];
    }
  };
  const closeList = () => {
    if (items && items.length > 0) blocks.push({ type: "list", items });
    items = null;
  };

  let fenced = false;
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (FENCE.test(raw)) {
      // The fence itself is dropped; each line inside becomes inline code.
      closeParagraph();
      closeList();
      fenced = !fenced;
      continue;
    }
    if (fenced) {
      if (raw.trim() !== "") {
        blocks.push({ type: "paragraph", content: [{ type: "code", text: raw.trim() }] });
      }
      continue;
    }
    if (raw.trim() === "" || RULE.test(raw)) {
      closeParagraph();
      closeList();
      continue;
    }

    const bullet = BULLET.exec(raw);
    if (bullet) {
      closeParagraph();
      const item = parseInline(bullet[1]);
      if (item.length > 0) (items ??= []).push(item);
      continue;
    }
    closeList();
    // A heading or a quotation keeps its words and loses its marker. A heading
    // also ends the paragraph, since it was written as a line of its own.
    const heading = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(raw);
    if (heading) {
      closeParagraph();
      paragraph.push(heading[1]);
      closeParagraph();
      continue;
    }
    paragraph.push(raw.replace(/^\s*(>\s?)+/, "").trim());
  }
  closeParagraph();
  closeList();
  return blocks;
}
