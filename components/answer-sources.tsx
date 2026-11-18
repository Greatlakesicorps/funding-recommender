import { ExternalLink, FileText } from "lucide-react";
import type { FundingSource } from "@/lib/funding-chat";

export function AnswerSources({ sources }: { sources: FundingSource[] }) {
  if (sources.length === 0) return null;

  return (
    <details className="sources">
      <summary>Sources searched ({sources.length})</summary>
      <p className="sources-note">
        These sources were searched for this answer; not every item is cited.
        Confirm details on the funder’s official page.
      </p>
      <ul>
        {sources.map((source) => (
          <li key={source.url ?? `${source.kind}:${source.title}`}>
            {source.url ? (
              <a href={source.url} target="_blank" rel="noreferrer">
                <ExternalLink size={13} aria-hidden="true" />
                <span>{source.title}</span>
                <span className="sr"> (opens in a new tab)</span>
              </a>
            ) : (
              <span className="kb-source">
                <FileText size={13} aria-hidden="true" />
                <span>{source.title}</span>
                <span className="source-kind">Hub knowledge base</span>
              </span>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
