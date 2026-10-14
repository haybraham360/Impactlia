import { RepositoryIcon } from "@/components/icons";
import { SubmitButton } from "@/components/submit-button";
import { submitRepository } from "@/lib/ingestion/actions";

export function RepositoryForm() {
  return (
    <form action={submitRepository} className="panel px-5 py-4">
      <label htmlFor="repository-url" className="flex items-center gap-2 text-sm font-medium">
        <RepositoryIcon className="size-4 text-accent" />
        Public GitHub repository
      </label>
      <div className="mt-2 flex flex-wrap gap-2">
        <input
          id="repository-url"
          name="url"
          type="text"
          inputMode="url"
          required
          maxLength={300}
          autoComplete="off"
          spellCheck={false}
          placeholder="https://github.com/owner/repository"
          aria-describedby="repository-url-help"
          className="min-w-0 flex-1 basis-72 rounded-lg border border-line bg-canvas px-3 py-2 font-mono text-[0.8125rem] transition-colors duration-150 placeholder:text-muted/70 hover:border-ink/30 focus-visible:border-accent"
        />
        <SubmitButton pendingLabel="Checking the repository…">Analyze repository</SubmitButton>
      </div>
      <p id="repository-url-help" className="mt-2 max-w-prose text-sm text-muted">
        The default branch is downloaded from GitHub and its TypeScript and JavaScript
        imports are mapped. Nothing in the repository is run, and no GitHub sign-in
        or permission is asked for. A repository that has already been analyzed opens
        its stored analysis.
      </p>
    </form>
  );
}
