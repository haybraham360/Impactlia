import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import type { ExclusionRule } from "../../parser/exclusions";
import { describeSourceFile } from "../../parser/walk";
import { IngestionError } from "./errors";

// Unpacks a repository archive (.tar.gz) for the parser, treating everything
// in it as untrusted.
//
// What reaches the disk:
//   - directories, and regular files, under the destination and nowhere else;
//   - the full content of source files and of .json files, which are all the
//     parser and its resolver ever read;
//   - every other regular file as an empty file of the same name, so the
//     parser still reports it as left out without its bytes being stored;
//   - a directory the parser's rules exclude as an empty directory, so the
//     parser reports it once, exactly as it would in a checkout, and nothing
//     beneath it is written.
// What never does: symbolic links, hard links, devices, anything with an
// absolute path or a ".." in it. Nothing is made executable and nothing is run.

export type ArchiveLimits = {
  // Bytes read out of the compressed stream, whatever is done with them.
  unpackedBytes: number;
  // Bytes written to disk.
  writtenBytes: number;
  // Entries of any kind in the archive.
  entries: number;
  // Files the parser will turn into nodes.
  sourceFiles: number;
};

export type ExtractedArchive = {
  // The commit the archive says it was built from, when it says so.
  commitSha: string | null;
  sourceFiles: number;
  writtenBytes: number;
  // Entries that were not written: links, special files and unsafe paths.
  ignoredEntries: number;
};

const BLOCK = 512;
// Path and metadata records, which are held in memory. Far above any real one.
const MAX_METADATA_BYTES = 1024 * 1024;

type Header = { name: string; size: number; type: string };

function text(block: Buffer, start: number, length: number): string {
  const field = block.subarray(start, start + length);
  const end = field.indexOf(0);
  return field.toString("utf8", 0, end === -1 ? length : end);
}

function readHeader(block: Buffer): Header {
  // A size with the high bit set is the base-256 form used above 8 GB.
  if (block[124] & 0x80) {
    throw new IngestionError("The archive holds a file too large to analyse.");
  }
  const stored = Number.parseInt(text(block, 148, 8).trim(), 8);
  let sum = 0;
  for (let index = 0; index < BLOCK; index += 1) {
    sum += index >= 148 && index < 156 ? 0x20 : block[index];
  }
  if (!Number.isInteger(stored) || stored !== sum) {
    throw new IngestionError("The archive GitHub returned is damaged and could not be read.");
  }
  const size = Number.parseInt(text(block, 124, 12).trim() || "0", 8);
  if (!Number.isInteger(size) || size < 0) {
    throw new IngestionError("The archive GitHub returned is damaged and could not be read.");
  }
  const prefix = text(block, 257, 5) === "ustar" ? text(block, 345, 155) : "";
  const name = text(block, 0, 100);
  return {
    name: prefix ? `${prefix}/${name}` : name,
    size,
    type: String.fromCharCode(block[156] || 0x30),
  };
}

// "<length> <key>=<value>\n", repeated; the length counts the whole record.
function readPaxRecords(body: Buffer): Map<string, string> {
  const records = new Map<string, string>();
  let offset = 0;
  while (offset < body.length) {
    const space = body.indexOf(0x20, offset);
    if (space === -1) break;
    const length = Number.parseInt(body.toString("utf8", offset, space), 10);
    if (!Number.isInteger(length) || length <= 0 || offset + length > body.length) break;
    const record = body.toString("utf8", space + 1, offset + length - 1);
    const equals = record.indexOf("=");
    if (equals !== -1) records.set(record.slice(0, equals), record.slice(equals + 1));
    offset += length;
  }
  return records;
}

// The path inside the repository, or null when the entry must not be written.
// The first segment is the folder every GitHub archive wraps its contents in.
export function repositoryPath(entryName: string): string[] | null {
  if (entryName.includes("\0") || entryName.includes("\\")) return null;
  if (entryName.startsWith("/")) return null;
  const segments = entryName.split("/").filter((segment) => segment !== "" && segment !== ".");
  if (segments.includes("..")) return null;
  return segments.slice(1);
}

export async function extractArchive(
  archiveFile: string,
  destination: string,
  rules: ExclusionRule[],
  limits: ArchiveLimits,
): Promise<ExtractedArchive> {
  fs.mkdirSync(destination, { recursive: true });
  const root = fs.realpathSync.native(destination);
  const directoryRule = (name: string) =>
    rules.some((rule) => rule.appliesTo === "directory" && rule.matches(name));

  const result: ExtractedArchive = {
    commitSha: null,
    sourceFiles: 0,
    writtenBytes: 0,
    ignoredEntries: 0,
  };
  let entries = 0;
  let unpackedBytes = 0;
  const madeDirectories = new Set<string>();

  function inside(segments: string[]): string {
    const absolute = path.join(root, ...segments);
    // Already guaranteed by repositoryPath; checked again where it matters.
    if (absolute !== root && !absolute.startsWith(root + path.sep)) {
      throw new Error(`Refusing to write outside the extraction directory: ${segments.join("/")}`);
    }
    return absolute;
  }
  function makeDirectory(segments: string[]): void {
    const key = segments.join("/");
    if (madeDirectories.has(key)) return;
    fs.mkdirSync(inside(segments), { recursive: true });
    madeDirectories.add(key);
  }

  // What to do with the entry being read.
  let sink:
    | { kind: "skip" }
    | { kind: "file"; descriptor: number }
    | { kind: "metadata"; type: string; chunks: Buffer[] } = { kind: "skip" };
  let remaining = 0;
  let padding = 0;
  // Set by a metadata entry, for the entry that follows it.
  let nextPath: string | null = null;
  let nextSize: number | null = null;

  function open(header: Header): void {
    entries += 1;
    if (entries > limits.entries) {
      throw new IngestionError(
        `The repository has more than ${limits.entries.toLocaleString("en")} files and folders, which is over the limit for one analysis.`,
      );
    }

    if (header.type === "g" || header.type === "x" || header.type === "L" || header.type === "K") {
      if (header.size > MAX_METADATA_BYTES) {
        throw new IngestionError("The archive GitHub returned could not be read.");
      }
      sink = { kind: "metadata", type: header.type, chunks: [] };
      remaining = header.size;
      return;
    }

    const name = nextPath ?? header.name;
    const size = nextSize ?? header.size;
    nextPath = null;
    nextSize = null;
    sink = { kind: "skip" };
    remaining = size;

    const isDirectory = header.type === "5";
    const isFile = header.type === "0" || header.type === "7";
    const segments = repositoryPath(name);
    if (segments === null || (!isDirectory && !isFile)) {
      result.ignoredEntries += 1;
      return;
    }
    if (segments.length === 0) return;

    const folders = isDirectory ? segments : segments.slice(0, -1);
    const excludedAt = folders.findIndex(directoryRule);
    if (excludedAt !== -1) {
      makeDirectory(folders.slice(0, excludedAt + 1));
      return;
    }
    makeDirectory(folders);
    if (isDirectory) return;

    const fileName = segments[segments.length - 1];
    const isSource = describeSourceFile(fileName) !== null;
    if (isSource) {
      result.sourceFiles += 1;
      if (result.sourceFiles > limits.sourceFiles) {
        throw new IngestionError(
          `The repository has more than ${limits.sourceFiles.toLocaleString("en")} TypeScript and JavaScript files, which is over the limit for one analysis.`,
        );
      }
    }
    // 0o644: readable, never executable.
    const descriptor = fs.openSync(inside(segments), "w", 0o644);
    if (isSource || path.extname(fileName).toLowerCase() === ".json") {
      sink = { kind: "file", descriptor };
    } else {
      fs.closeSync(descriptor);
    }
  }

  function consume(chunk: Buffer): void {
    if (sink.kind === "file") {
      result.writtenBytes += chunk.length;
      if (result.writtenBytes > limits.writtenBytes) {
        throw new IngestionError(
          `The repository's source is larger than ${Math.round(limits.writtenBytes / 1024 / 1024)} MB, which is over the limit for one analysis.`,
        );
      }
      fs.writeSync(sink.descriptor, chunk);
    } else if (sink.kind === "metadata") {
      sink.chunks.push(chunk);
    }
  }

  function close(): void {
    if (sink.kind === "file") {
      fs.closeSync(sink.descriptor);
    } else if (sink.kind === "metadata") {
      const body = Buffer.concat(sink.chunks);
      if (sink.type === "L") {
        nextPath = body.toString("utf8").replace(/\0+$/, "");
      } else if (sink.type === "x") {
        const records = readPaxRecords(body);
        nextPath = records.get("path") ?? nextPath;
        const size = records.get("size");
        if (size !== undefined && /^\d+$/.test(size)) nextSize = Number(size);
      } else if (sink.type === "g") {
        // `git archive` of a commit states the commit here.
        const comment = readPaxRecords(body).get("comment");
        if (comment && /^[0-9a-f]{40}$/.test(comment)) result.commitSha = comment;
      }
    }
    sink = { kind: "skip" };
  }

  // A failed run can stop in the middle of a file.
  function abandon(): void {
    if (sink.kind === "file") fs.closeSync(sink.descriptor);
    sink = { kind: "skip" };
  }

  let pending: Buffer = Buffer.alloc(0);
  let inEntry = false;

  function feed(chunk: Buffer): void {
    let data = pending.length > 0 ? Buffer.concat([pending, chunk]) : chunk;
    for (;;) {
      if (inEntry) {
        if (remaining > 0) {
          if (data.length === 0) break;
          const take = Math.min(remaining, data.length);
          consume(data.subarray(0, take));
          data = data.subarray(take);
          remaining -= take;
          if (remaining > 0) break;
        }
        if (data.length < padding) {
          padding -= data.length;
          data = Buffer.alloc(0);
          break;
        }
        data = data.subarray(padding);
        close();
        inEntry = false;
      }
      if (data.length < BLOCK) break;
      const block = data.subarray(0, BLOCK);
      data = data.subarray(BLOCK);
      // Blocks of zeros mark the end of the archive.
      if (block.every((byte) => byte === 0)) continue;
      open(readHeader(block));
      padding = (BLOCK - (remaining % BLOCK)) % BLOCK;
      inEntry = true;
    }
    // Copied, because `data` is a view of a chunk the stream may reuse.
    pending = Buffer.from(data);
  }

  const compressed = fs.createReadStream(archiveFile);
  const unpacked = compressed.pipe(zlib.createGunzip());
  // pipe() does not pass a read error on, and the loop below would wait forever.
  compressed.on("error", (error) => unpacked.destroy(error));
  try {
    for await (const chunk of unpacked) {
      const bytes = chunk as Buffer;
      unpackedBytes += bytes.length;
      if (unpackedBytes > limits.unpackedBytes) {
        throw new IngestionError(
          `The repository unpacks to more than ${Math.round(limits.unpackedBytes / 1024 / 1024)} MB, which is over the limit for one analysis.`,
        );
      }
      feed(bytes);
    }
  } catch (error) {
    if (error instanceof IngestionError) throw error;
    // zlib reports a truncated or corrupt stream with an error code.
    if (error instanceof Error && "code" in error && String(error.code).startsWith("Z_")) {
      throw new IngestionError("The archive GitHub returned is damaged and could not be unpacked.");
    }
    throw error;
  } finally {
    compressed.destroy();
    unpacked.destroy();
    abandon();
  }
  if (inEntry && remaining > 0) {
    throw new IngestionError("The archive GitHub returned ended early and could not be unpacked.");
  }
  return result;
}
