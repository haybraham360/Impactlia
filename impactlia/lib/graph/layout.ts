import type { GraphModel } from "./model";

// One drawn line between two folders. It stands for `count` real file-to-file
// dependencies and exists only because at least one does.
export type FolderLink = { id: string; source: string; target: string; count: number };

// `header` is the height of the folder's own block; an open folder's files
// are drawn below it.
export type Box = { x: number; y: number; width: number; height: number; header: number };

// Width is the same for every folder, so a long name never looks important.
// Height is the one dimension that carries meaning: it grows in a straight
// line with the folder's fan-in, from HEADER_HEIGHT for none to
// HEADER_HEIGHT + FAN_IN_HEIGHT for the most depended-on folder shown.
export const FOLDER_WIDTH = 232;
export const HEADER_HEIGHT = 80;
export const FAN_IN_HEIGHT = 132;
export const ROW_HEIGHT = 26;
export const COLUMN_WIDTH = 216;
export const GRID_PADDING = 8;

export const linkId = (source: string, target: string) => `${source}\n${target}`;

export function linkFolders(model: GraphModel): FolderLink[] {
  const folderOf = new Map(model.files.map((file) => [file.id, file.folder]));
  const links = new Map<string, FolderLink>();
  for (const edge of model.edges) {
    const source = folderOf.get(edge.source);
    const target = folderOf.get(edge.target);
    if (source === undefined || target === undefined) {
      throw new Error(`Edge ${edge.source} → ${edge.target} points at a file that is not drawn.`);
    }
    // Dependencies inside one folder are not lines; the folder reports them.
    if (source === target) continue;
    const id = linkId(source, target);
    const link = links.get(id);
    if (link) link.count += 1;
    else links.set(id, { id, source, target, count: 1 });
  }
  return [...links.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// An open folder lays its files out in columns so a folder with hundreds of
// files stays roughly screen-shaped instead of becoming one very tall list.
export function fileGrid(fileCount: number): { columns: number; rows: number } {
  const columns = Math.max(1, Math.round(Math.sqrt(fileCount * 0.16)));
  return { columns, rows: Math.ceil(fileCount / columns) };
}

function folderSize(
  fileCount: number,
  header: number,
  open: boolean,
): { width: number; height: number; header: number } {
  if (!open) return { width: FOLDER_WIDTH, height: header, header };
  const { columns, rows } = fileGrid(fileCount);
  return {
    width: Math.max(FOLDER_WIDTH, columns * COLUMN_WIDTH + GRID_PADDING * 2),
    height: header + rows * ROW_HEIGHT + GRID_PADDING * 2,
    header,
  };
}

// Gaps between folders. Columns that belong to different ranks sit further
// apart than columns of the same rank, so the ranks read as groups.
const ROW_GAP = 20;
const COLUMN_GAP = 48;
const RANK_GAP = 136;
// The shape the whole graph aims for. Fixed, not taken from the window, so the
// layout depends on the repository alone.
const TARGET_ASPECT = 4 / 3;
const MOST_COLUMNS_PER_RANK = 12;

// Folders that depend on each other in a cycle have no honest left-to-right
// order, so they are found first and ranked together (Tarjan's algorithm).
// Returns a component number for every folder.
function findCycles(folders: string[], next: Map<string, string[]>): Map<string, number> {
  const order = new Map<string, number>();
  const lowest = new Map<string, number>();
  const component = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  let components = 0;

  function visit(folder: string): void {
    const index = order.size;
    order.set(folder, index);
    lowest.set(folder, index);
    stack.push(folder);
    onStack.add(folder);
    for (const target of next.get(folder) ?? []) {
      if (!order.has(target)) {
        visit(target);
        lowest.set(folder, Math.min(lowest.get(folder) ?? 0, lowest.get(target) ?? 0));
      } else if (onStack.has(target)) {
        lowest.set(folder, Math.min(lowest.get(folder) ?? 0, order.get(target) ?? 0));
      }
    }
    if (lowest.get(folder) !== index) return;
    for (;;) {
      const member = stack.pop();
      if (member === undefined) break;
      onStack.delete(member);
      component.set(member, components);
      if (member === folder) break;
    }
    components += 1;
  }

  for (const folder of folders) if (!order.has(folder)) visit(folder);
  return component;
}

// A folder's rank is the longest chain of dependents leading to it, so a
// folder always sits to the right of everything that depends on it, and
// folders in one cycle share a rank.
function rankFolders(folders: string[], links: FolderLink[]): Map<string, number> {
  const next = new Map<string, string[]>(folders.map((folder) => [folder, []]));
  for (const link of links) next.get(link.source)?.push(link.target);
  const component = findCycles(folders, next);

  const members = new Map<number, string[]>();
  for (const folder of folders) {
    const id = component.get(folder) ?? 0;
    const list = members.get(id);
    if (list) list.push(folder);
    else members.set(id, [folder]);
  }

  const ranks = new Map<number, number>();
  function rankOf(id: number): number {
    const known = ranks.get(id);
    if (known !== undefined) return known;
    let rank = 0;
    for (const link of links) {
      const from = component.get(link.source) ?? 0;
      if (component.get(link.target) === id && from !== id) {
        rank = Math.max(rank, rankOf(from) + 1);
      }
    }
    ranks.set(id, rank);
    return rank;
  }

  const result = new Map<string, number>();
  for (const [id, list] of members) for (const folder of list) result.set(folder, rankOf(id));
  return result;
}

type Sized = { id: string; width: number; height: number; header: number };

// Places every rank as one or more columns no taller than `limit`.
function place(ranks: Sized[][], limit: number): { boxes: Map<string, Box>; width: number; height: number } {
  const columns: { rank: number; items: Sized[]; width: number; height: number }[] = [];
  ranks.forEach((items, rank) => {
    let column: Sized[] = [];
    let height = 0;
    const close = () => {
      if (column.length === 0) return;
      columns.push({
        rank,
        items: column,
        width: Math.max(...column.map((item) => item.width)),
        height,
      });
      column = [];
      height = 0;
    };
    for (const item of items) {
      const added = height === 0 ? item.height : height + ROW_GAP + item.height;
      if (column.length > 0 && added > limit) close();
      height = height === 0 ? item.height : height + ROW_GAP + item.height;
      column.push(item);
    }
    close();
  });

  const tallest = Math.max(0, ...columns.map((column) => column.height));
  const boxes = new Map<string, Box>();
  let x = 0;
  columns.forEach((column, index) => {
    if (index > 0) x += columns[index - 1].rank === column.rank ? COLUMN_GAP : RANK_GAP;
    // Columns are centred on one horizontal line.
    let y = (tallest - column.height) / 2;
    for (const item of column.items) {
      boxes.set(item.id, { x, y, width: item.width, height: item.height, header: item.header });
      y += item.height + ROW_GAP;
    }
    x += column.width;
  });
  return { boxes, width: x, height: tallest };
}

// A layered layout, left to right in the direction of dependency. A tall rank
// is wrapped into several columns so the graph fills a screen-shaped area
// instead of a strip. Nothing is random and nothing depends on the window, so
// the same model and the same open folders always give the same positions.
export function layoutFolders(
  model: GraphModel,
  links: FolderLink[],
  open: ReadonlySet<string>,
): Map<string, Box> {
  const rankOf = rankFolders(
    model.folders.map((folder) => folder.id),
    links,
  );
  const highestFanIn = Math.max(0, ...model.folders.map((folder) => folder.fanIn));
  const ranks: Sized[][] = [];
  // model.folders is sorted, so each rank is filled in sorted order.
  for (const folder of model.folders) {
    const header =
      HEADER_HEIGHT +
      (highestFanIn === 0 ? 0 : Math.round((FAN_IN_HEIGHT * folder.fanIn) / highestFanIn));
    const rank = rankOf.get(folder.id) ?? 0;
    (ranks[rank] ??= []).push({
      id: folder.id,
      ...folderSize(folder.files.length, header, open.has(folder.id)),
    });
  }
  const filled = ranks.filter((rank) => rank !== undefined);

  const rankHeight = (items: Sized[]) =>
    items.reduce((sum, item) => sum + item.height, 0) + ROW_GAP * (items.length - 1);
  const tallestRank = Math.max(0, ...filled.map(rankHeight));

  // Try splitting the tallest rank into 1, 2, 3… columns and keep the split
  // whose overall shape is closest to the target.
  let best = place(filled, tallestRank);
  let bestError = Infinity;
  for (let split = 1; split <= MOST_COLUMNS_PER_RANK; split += 1) {
    const candidate = place(filled, tallestRank / split);
    if (candidate.height === 0) break;
    const error = Math.abs(Math.log(candidate.width / candidate.height / TARGET_ASPECT));
    if (error < bestError) {
      best = candidate;
      bestError = error;
    }
  }
  return best.boxes;
}
