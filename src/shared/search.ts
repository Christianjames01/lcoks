// Local, in-memory search over REDACTED entry views. Secret field values are not
// present in EntryView, so they can never be matched (or leaked) by search.
// Queries are never sent anywhere or persisted.

import type { CategoryDef, EntryView } from './types';

function haystack(e: EntryView, categories: CategoryDef[]): string {
  const cat = categories.find((c) => c.id === e.categoryId);
  return [e.title, cat?.name ?? '', ...Object.values(e.fields), ...e.tags, ...e.tags.map((t) => `#${t}`)]
    .join('\n')
    .toLowerCase();
}

/**
 * Every whitespace-separated term must match somewhere. Results are ranked:
 * title prefix > title contains > other fields; then alphabetically.
 */
export function searchEntries(entries: EntryView[], categories: CategoryDef[], query: string): EntryView[] {
  const terms = query.toLowerCase().normalize('NFC').split(/\s+/).filter(Boolean).slice(0, 12);
  if (terms.length === 0) return entries;
  const scored: { e: EntryView; score: number }[] = [];
  for (const e of entries) {
    const hay = haystack(e, categories).normalize('NFC');
    if (!terms.every((t) => hay.includes(t))) continue;
    const title = e.title.toLowerCase();
    let score = 0;
    for (const t of terms) {
      if (title.startsWith(t)) score += 3;
      else if (title.includes(t)) score += 2;
      else score += 1;
    }
    if (e.favorite) score += 0.5;
    scored.push({ e, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.e.title.localeCompare(b.e.title, undefined, { sensitivity: 'base' }))
    .map((s) => s.e);
}
