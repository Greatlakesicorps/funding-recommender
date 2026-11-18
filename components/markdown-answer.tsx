import type { ReactNode } from "react";

const inlinePattern =
  /\[([^\]]+)\]\(([^)]+)\)|\*\*(.+?)\*\*|__(.+?)__|`([^`]+)`|\*(.+?)\*|_(.+?)_|(https?:\/\/[^\s<]+)/g;
const headingPattern = /^(#{1,6})\s+(.+)$/;
const listPattern = /^\s*(?:[-*+]|(\d+)\.)\s+(.+)$/;
const rulePattern = /^\s*([-*_])(?:\s*\1){2,}\s*$/;
const tableSeparatorPattern =
  /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/;

function isTableStart(lines: string[], index: number): boolean {
  return (
    lines[index].includes("|") &&
    index + 1 < lines.length &&
    tableSeparatorPattern.test(lines[index + 1])
  );
}

function splitTableRow(line: string): string[] {
  const trimmed = line
    .trim()
    .replace(/^\|/, "")
    .replace(/(?<!\\)\|$/, "");
  return trimmed
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

export function MarkdownAnswer({ text }: { text: string }) {
  const lines = text.split(/\r?\n/);
  const blocks: ReactNode[] = [];

  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (/^\s*```/.test(line)) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s*```/.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(
        <pre key={blocks.length}>
          <code>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    const heading = line.match(headingPattern);
    if (heading) {
      const level = Math.min(heading[1].length + 1, 4);
      const Heading = `h${level}` as "h2" | "h3" | "h4";
      blocks.push(
        <Heading key={blocks.length}>{renderInline(heading[2])}</Heading>,
      );
      index += 1;
      continue;
    }

    if (rulePattern.test(line)) {
      blocks.push(<hr key={blocks.length} />);
      index += 1;
      continue;
    }

    if (isTableStart(lines, index)) {
      const header = splitTableRow(line);
      const rows: string[][] = [];
      index += 2;
      while (
        index < lines.length &&
        lines[index].trim() &&
        lines[index].includes("|")
      ) {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }
      blocks.push(
        <div
          className="table-wrap"
          key={blocks.length}
          tabIndex={0}
          role="region"
          aria-label="Table"
        >
          <table>
            <thead>
              <tr>
                {header.map((cell, cellIndex) => (
                  <th key={cellIndex} scope="col">
                    {renderInline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {header.map((_, cellIndex) => (
                    <td key={cellIndex}>
                      {renderInline(row[cellIndex] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        quote.push(lines[index].replace(/^\s*>\s?/, ""));
        index += 1;
      }
      blocks.push(
        <blockquote key={blocks.length}>
          {quote.map((quoteLine, lineIndex) => (
            <span key={lineIndex}>
              {lineIndex > 0 && <br />}
              {renderInline(quoteLine)}
            </span>
          ))}
        </blockquote>,
      );
      continue;
    }

    const listMatch = line.match(listPattern);
    if (listMatch) {
      const ordered = listMatch[1] !== undefined;
      const start = ordered ? Number(listMatch[1]) : undefined;
      const items: string[] = [];
      while (index < lines.length) {
        const item = lines[index].match(listPattern);
        if (!item || (item[1] !== undefined) !== ordered) break;
        items.push(item[2]);
        index += 1;
      }
      const listItems = items.map((item, itemIndex) => (
        <li key={itemIndex}>{renderInline(item)}</li>
      ));
      blocks.push(
        ordered ? (
          <ol key={blocks.length} start={start !== 1 ? start : undefined}>
            {listItems}
          </ol>
        ) : (
          <ul key={blocks.length}>{listItems}</ul>
        ),
      );
      continue;
    }

    const paragraph: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^\s*```/.test(lines[index]) &&
      !headingPattern.test(lines[index]) &&
      !/^\s*>\s?/.test(lines[index]) &&
      !listPattern.test(lines[index]) &&
      !rulePattern.test(lines[index]) &&
      !isTableStart(lines, index)
    ) {
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push(
      <p key={blocks.length}>
        {paragraph.map((paragraphLine, lineIndex) => (
          <span key={lineIndex}>
            {lineIndex > 0 && <br />}
            {renderInline(paragraphLine)}
          </span>
        ))}
      </p>,
    );
  }

  return <div className="markdown-answer">{blocks}</div>;
}

function renderInline(text: string): ReactNode[] {
  const content: ReactNode[] = [];
  let previousIndex = 0;
  let match: RegExpExecArray | null;
  inlinePattern.lastIndex = 0;

  while ((match = inlinePattern.exec(text)) !== null) {
    if (match.index > previousIndex) {
      content.push(text.slice(previousIndex, match.index));
    }

    if (match[1] !== undefined) {
      const href = safeHref(match[2]);
      content.push(
        href ? (
          <a key={match.index} href={href} target="_blank" rel="noreferrer">
            {match[1]}
          </a>
        ) : (
          match[1]
        ),
      );
    } else if (match[3] !== undefined || match[4] !== undefined) {
      content.push(<strong key={match.index}>{match[3] ?? match[4]}</strong>);
    } else if (match[5] !== undefined) {
      content.push(<code key={match.index}>{match[5]}</code>);
    } else if (match[6] !== undefined || match[7] !== undefined) {
      content.push(<em key={match.index}>{match[6] ?? match[7]}</em>);
    } else if (match[8] !== undefined) {
      const { url, suffix } = trimUrlPunctuation(match[8]);
      const href = safeHref(url);
      content.push(
        href ? (
          <a key={match.index} href={href} target="_blank" rel="noreferrer">
            {url}
          </a>
        ) : (
          url
        ),
      );
      if (suffix) content.push(suffix);
    }

    previousIndex = inlinePattern.lastIndex;
  }

  if (previousIndex < text.length) content.push(text.slice(previousIndex));
  return content;
}

function safeHref(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function trimUrlPunctuation(value: string): { url: string; suffix: string } {
  const match = value.match(/^(.*?)([.,!?;:)\]]*)$/);
  return { url: match?.[1] ?? value, suffix: match?.[2] ?? "" };
}
