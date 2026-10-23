import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { before, test } from "node:test";
import zlib from "node:zlib";
import { coreExclusionRules, oversizedFileRule } from "../../../parser/exclusions";
import { parseRepository } from "../../../parser/parse-repository";
import { parseRepositoryUrl } from "../../github/repository-url";
import { summariseCoverage } from "../../graph/coverage";
import { extractArchive, repositoryPath, type ArchiveLimits } from "../archive";
import { IngestionError } from "../errors";
import { loadGrammars, type Grammars } from "../../../parser/languages/tree-sitter";

// The parser's grammars load asynchronously, once, before any test.
let grammars: Grammars;
before(async () => {
  grammars = await loadGrammars();
});

// Run with `pnpm check:ingestion`. Nothing here touches the network: the
// archives are built below, entry by entry, so each one's contents can be read
// off the test that uses it.

// ── Building archives ──────────────────────────────────────────────────────

type Entry = { name: string; type?: string; content?: string; link?: string };

function header(name: string, size: number, type: string, link = ""): Buffer {
  const block = Buffer.alloc(512);
  block.write(name, 0, 100, "utf8");
  block.write("0000644\0", 100, "latin1");
  block.write("0000000\0", 108, "latin1");
  block.write("0000000\0", 116, "latin1");
  block.write(`${size.toString(8).padStart(11, "0")}\0`, 124, "latin1");
  block.write("00000000000\0", 136, "latin1");
  block.write("        ", 148, "latin1");
  block.write(type, 156, "latin1");
  block.write(link, 157, 100, "utf8");
  block.write("ustar\0" + "00", 257, "latin1");
  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, "latin1");
  return block;
}

function entry({ name, type = "0", content = "", link }: Entry): Buffer {
  const body = Buffer.from(content, "utf8");
  const padding = Buffer.alloc((512 - (body.length % 512)) % 512);
  return Buffer.concat([header(name, body.length, type, link), body, padding]);
}

function paxRecord(key: string, value: string): string {
  const rest = ` ${key}=${value}\n`;
  let length = rest.length + 1;
  while (String(length).length + rest.length !== length) length += 1;
  return `${length}${rest}`;
}

const SHA = "0123456789abcdef0123456789abcdef01234567";

function archive(entries: Entry[], commit: string | null = SHA): Buffer {
  const blocks = entries.map(entry);
  if (commit !== null) {
    blocks.unshift(
      entry({ name: "pax_global_header", type: "g", content: paxRecord("comment", commit) }),
    );
  }
  return zlib.gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
}

const LIMITS: ArchiveLimits = {
  unpackedBytes: 10 * 1024 * 1024,
  writtenBytes: 1024 * 1024,
  entries: 1000,
  sourceFiles: 100,
  typescriptFiles: 100,
  sourceFileBytes: 1024 * 1024,
};

// Each test works in its own directory and removes it, whatever happens.
async function withArchive<T>(
  bytes: Buffer,
  check: (archiveFile: string, destination: string, workspace: string) => Promise<T>,
): Promise<T> {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "impactlia-check-"));
  try {
    const archiveFile = path.join(workspace, "archive.tar.gz");
    fs.writeFileSync(archiveFile, bytes);
    return await check(archiveFile, path.join(workspace, "inner", "source"), workspace);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

function listing(directory: string, prefix = ""): string[] {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((item) => {
      const relative = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.isDirectory()) return [`${relative}/`, ...listing(path.join(directory, item.name), relative)];
      return [relative];
    })
    .sort();
}

// ── Repository addresses ───────────────────────────────────────────────────

test("common forms of one address give the same owner and name", () => {
  const forms = [
    "https://github.com/vercel/next.js",
    "http://github.com/vercel/next.js",
    "https://www.github.com/vercel/next.js/",
    "github.com/vercel/next.js",
    "  https://github.com/vercel/next.js.git  ",
    "git@github.com:vercel/next.js.git",
    "https://GitHub.com/vercel/next.js?tab=readme#top",
  ];
  for (const form of forms) {
    assert.deepEqual(parseRepositoryUrl(form), { owner: "vercel", name: "next.js" }, form);
  }
});

test("anything that is not a GitHub repository address is refused with a reason", () => {
  const refused = [
    "",
    "not a url",
    "https://gitlab.com/owner/repo",
    "https://github.com/owner",
    "https://github.com/owner/repo/tree/main",
    "https://github.com/owner/repo/pull/3",
    "https://github.com/-owner/repo",
    "https://github.com/owner/..",
    "https://github.com/owner/re po",
    "https://user:secret@github.com/owner/repo",
    "ftp://github.com/owner/repo",
    "file:///etc/passwd",
    `https://github.com/owner/${"a".repeat(400)}`,
  ];
  for (const input of refused) {
    assert.throws(() => parseRepositoryUrl(input), IngestionError, input);
  }
});

// ── Archive paths ──────────────────────────────────────────────────────────

test("the archive's wrapping folder is dropped and unsafe paths are refused", () => {
  assert.deepEqual(repositoryPath("o-r-abc/src/index.ts"), ["src", "index.ts"]);
  assert.deepEqual(repositoryPath("o-r-abc/./src//index.ts"), ["src", "index.ts"]);
  assert.deepEqual(repositoryPath("o-r-abc/"), []);
  assert.equal(repositoryPath("/etc/passwd"), null);
  assert.equal(repositoryPath("o-r-abc/../../etc/passwd"), null);
  assert.equal(repositoryPath("o-r-abc/src/../../x.ts"), null);
  assert.equal(repositoryPath("o-r-abc\\..\\x.ts"), null);
  assert.equal(repositoryPath("o-r-abc/a\0b.ts"), null);
});

// ── Extraction ─────────────────────────────────────────────────────────────

test("extraction writes what the parser reads and reports the archive's commit", async () => {
  const bytes = archive([
    { name: "o-r-abc/", type: "5" },
    { name: "o-r-abc/package.json", content: '{"name":"sample"}' },
    { name: "o-r-abc/src/", type: "5" },
    { name: "o-r-abc/src/index.ts", content: 'import { a } from "./a";\nimport "./missing";\n' },
    { name: "o-r-abc/src/a.ts", content: "export const a = 1;\n" },
    { name: "o-r-abc/README.md", content: "# A long readme that is not stored" },
    { name: "o-r-abc/node_modules/left-pad/index.js", content: "module.exports = 1;" },
    { name: "o-r-abc/.github/workflows/ci.yml", content: "on: push" },
    { name: "o-r-abc/dist/bundle.js", content: "var x;" },
  ]);
  await withArchive(bytes, async (archiveFile, destination) => {
    const result = await extractArchive(fs.createReadStream(archiveFile), destination, coreExclusionRules, LIMITS);
    assert.equal(result.commitSha, SHA);
    assert.equal(result.sourceFiles, 2);
    assert.equal(result.ignoredEntries, 0);
    // Excluded directories exist but are empty; nothing beneath them is written.
    assert.deepEqual(listing(destination), [
      ".github/",
      "README.md",
      "dist/",
      "node_modules/",
      "package.json",
      "src/",
      "src/a.ts",
      "src/index.ts",
    ]);
    // A file the parser never reads keeps its name and loses its bytes.
    assert.equal(fs.readFileSync(path.join(destination, "README.md"), "utf8"), "");
    assert.equal(fs.readFileSync(path.join(destination, "package.json"), "utf8"), '{"name":"sample"}');
    assert.equal(fs.statSync(path.join(destination, "src/index.ts")).mode & 0o111, 0);

    // The existing parser reads the result as it would a checkout.
    const output = parseRepository(destination, grammars);
    assert.deepEqual(output.files.map((file) => file.id), ["src/a.ts", "src/index.ts"]);
    assert.deepEqual(
      output.edges.map((edge) => `${edge.source} -> ${edge.target}`),
      ["src/index.ts -> src/a.ts"],
    );
    assert.deepEqual(
      output.excluded.filter((item) => item.type === "directory").map((item) => item.path),
      [".github", "dist", "node_modules"],
    );

    // One import resolved, one did not: 1 of 2, and the graph is incomplete.
    const coverage = summariseCoverage(output);
    assert.deepEqual(coverage.imports, { resolved: 1, total: 2, percent: 50 });
    assert.equal(coverage.incomplete, true);
    assert.deepEqual(coverage.unresolvedByReason, [{ reason: "file-not-found", count: 1 }]);
    assert.equal(coverage.unsupportedFiles, 2);
  });
});

test("an archive that does not state its commit yields no commit", async () => {
  await withArchive(archive([{ name: "o-r-abc/a.ts", content: "" }], null), async (file, destination) => {
    const result = await extractArchive(fs.createReadStream(file), destination, coreExclusionRules, LIMITS);
    assert.equal(result.commitSha, null);
  });
});

test("nothing is written outside the destination, and links are never created", async () => {
  const bytes = archive([
    { name: "o-r-abc/ok.ts", content: "export {};" },
    { name: "o-r-abc/../../escaped.ts", content: "escaped" },
    { name: "/tmp/impactlia-absolute.ts", content: "escaped" },
    { name: "o-r-abc/link.ts", type: "2", link: "/etc/passwd" },
    { name: "o-r-abc/hard.ts", type: "1", link: "o-r-abc/ok.ts" },
    { name: "o-r-abc/device", type: "3" },
    // A path too long for the header, carried by a pax record, is checked too.
    { name: "PaxHeader", type: "x", content: paxRecord("path", "o-r-abc/../../pax-escaped.ts") },
    { name: "o-r-abc/short.ts", content: "escaped" },
  ]);
  await withArchive(bytes, async (archiveFile, destination, workspace) => {
    const result = await extractArchive(fs.createReadStream(archiveFile), destination, coreExclusionRules, LIMITS);
    assert.equal(result.ignoredEntries, 6);
    assert.deepEqual(listing(destination), ["ok.ts"]);
    // The directories above the destination hold only what the test put there.
    assert.deepEqual(listing(workspace), ["archive.tar.gz", "inner/", "inner/source/", "inner/source/ok.ts"]);
    assert.equal(fs.existsSync("/tmp/impactlia-absolute.ts"), false);
  });
});

test("each limit stops extraction with a message naming it", async () => {
  const many = Array.from({ length: 5 }, (_, index) => ({
    name: `o-r-abc/f${index}.ts`,
    content: "export {};",
  }));
  const cases: [string, Buffer, Partial<ArchiveLimits>, RegExp][] = [
    ["source files", archive(many), { sourceFiles: 4 }, /more than 4 source files in supported languages/],
    ["TypeScript files", archive(many), { typescriptFiles: 4 }, /more than 4 TypeScript and JavaScript files/],
    ["entries", archive(many), { entries: 3 }, /more than 3 files and folders/],
    [
      "written bytes",
      // JSON is written in full and held only to the total; a source file this
      // large is left out by the per-file limit instead (tested below).
      archive([{ name: "o-r-abc/big.json", content: "x".repeat(3 * 1024 * 1024) }]),
      { writtenBytes: 2 * 1024 * 1024 },
      /larger than 2 MB/,
    ],
    [
      // A file that is never stored still counts against what is unpacked.
      "unpacked bytes",
      archive([{ name: "o-r-abc/big.bin", content: "\0".repeat(3 * 1024 * 1024) }]),
      { unpackedBytes: 1024 * 1024 },
      /unpacks to more than 1 MB/,
    ],
  ];
  for (const [label, bytes, limit, message] of cases) {
    await withArchive(bytes, async (archiveFile, destination) => {
      await assert.rejects(
        extractArchive(fs.createReadStream(archiveFile), destination, coreExclusionRules, { ...LIMITS, ...limit }),
        (error) => error instanceof IngestionError && message.test(error.message),
        label,
      );
    });
  }
});

test("a damaged archive fails with a message rather than a partial result", async () => {
  const whole = archive([{ name: "o-r-abc/a.ts", content: "x".repeat(5000) }]);
  const corruptHeader = zlib.gzipSync(Buffer.concat([Buffer.alloc(512, 1), Buffer.alloc(1024)]));
  for (const bytes of [whole.subarray(0, whole.length - 20), Buffer.from("not gzip at all"), corruptHeader]) {
    await withArchive(bytes, async (archiveFile, destination) => {
      await assert.rejects(
        extractArchive(fs.createReadStream(archiveFile), destination, coreExclusionRules, LIMITS),
        IngestionError,
      );
    });
  }
});

test("a source file over the size limit is named, not written, and the parser lists it as left out", async () => {
  const bytes = archive([
    { name: "o-r-abc/small.ts", content: 'import "./big";\n' },
    { name: "o-r-abc/big.ts", content: "x".repeat(2048) },
    { name: "o-r-abc/big.json", content: JSON.stringify({ data: "y".repeat(2048) }) },
  ]);
  await withArchive(bytes, async (archiveFile, destination) => {
    const result = await extractArchive(fs.createReadStream(archiveFile), destination, coreExclusionRules, {
      ...LIMITS,
      sourceFileBytes: 1024,
    });
    assert.deepEqual(result.oversized, ["big.ts"]);
    assert.equal(fs.statSync(path.join(destination, "big.ts")).size, 0);
    // Only source files are held to the per-file limit.
    assert.ok(fs.statSync(path.join(destination, "big.json")).size > 2000);
    const output = parseRepository(destination, grammars, [], {
      excludedFiles: new Map(result.oversized.map((file) => [file, oversizedFileRule.id])),
    });
    assert.deepEqual(output.files.map((file) => file.path), ["small.ts"]);
    assert.deepEqual(
      output.excluded.filter((entry) => entry.rule === "oversized-file"),
      [{ path: "big.ts", type: "file", rule: "oversized-file" }],
    );
    // The import of it is accounted for as an import of an excluded file.
    assert.deepEqual(
      output.unlinkedReferences.map((reference) => [reference.specifier, reference.status]),
      [["./big", "excluded"]],
    );
  });
});
