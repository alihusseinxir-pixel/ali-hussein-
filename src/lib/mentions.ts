export interface Person { id: string; name: string }
export interface MentionSpan { start: number; end: number; id: string }

const isWordChar = (c: string | undefined) => !!c && /[\p{L}\p{N}_]/u.test(c);

/** Find `@Full Name` mentions. Longest names win, so "@Ali Khan" never also matches "@Ali". */
export function mentionSpans(body: string, people: Person[]): MentionSpan[] {
  const taken: MentionSpan[] = [];
  const lower = body.toLowerCase();
  for (const p of [...people].sort((a, b) => b.name.length - a.name.length)) {
    const needle = `@${p.name.toLowerCase()}`;
    for (let from = 0; ; ) {
      const i = lower.indexOf(needle, from);
      if (i < 0) break;
      const end = i + needle.length;
      from = end;
      const overlaps = taken.some((t) => i < t.end && end > t.start);
      if (!overlaps && !isWordChar(body[end]) && !isWordChar(body[i - 1])) taken.push({ start: i, end, id: p.id });
    }
  }
  return taken.sort((a, b) => a.start - b.start);
}

export const extractMentions = (body: string, people: Person[]): string[] => [...new Set(mentionSpans(body, people).map((s) => s.id))];
