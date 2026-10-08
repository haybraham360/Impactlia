import type { FileGroup, RepositoryOverview } from "@/lib/repository-overview";

const numberFormat = new Intl.NumberFormat("en");

function Total({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium tabular-nums">{numberFormat.format(value)}</dd>
    </div>
  );
}

function Groups({ title, groups }: { title: string; groups: FileGroup[] }) {
  return (
    <section className="border-t border-line px-4 py-4">
      <h2 className="mb-2 text-xs font-medium text-muted">{title}</h2>
      <ul className="space-y-1">
        {groups.map((group) => (
          <li
            key={group.label}
            className="flex items-baseline justify-between gap-3"
          >
            <span className="truncate font-mono text-[0.8125rem]" title={group.label}>
              {group.label}
            </span>
            <span className="text-muted tabular-nums">
              {numberFormat.format(group.files)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function RepositoryRail({ overview }: { overview: RepositoryOverview }) {
  return (
    <div className="text-sm">
      <section className="px-4 py-4">
        <h2 className="mb-2 text-xs font-medium text-muted">Repository</h2>
        <dl className="space-y-1">
          <Total label="Source files" value={overview.files} />
          <Total label="Dependencies" value={overview.edges} />
          {/* Always shown, zero included: a graph with unresolved imports is
              missing relationships, and that should never be invisible. */}
          <Total
            label="Unresolved imports"
            value={overview.unresolvedReferences}
          />
          {overview.failedFiles > 0 && (
            <Total label="Files not parsed" value={overview.failedFiles} />
          )}
        </dl>
      </section>
      <Groups title="Top-level directories" groups={overview.topLevelDirectories} />
      <Groups title="File types" groups={overview.fileTypes} />
    </div>
  );
}
