import { X } from 'lucide-react';
import { useState } from 'react';

const SUGGESTED = ['personal', 'work', 'bank', 'important', 'school', 'finance'];

export function normalizeTag(t: string): string {
  return t.trim().toLowerCase().replace(/[\s,]+/g, '-').slice(0, 40);
}

export function TagInput({ id, tags, onChange }: { id: string; tags: string[]; onChange: (t: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const add = (raw: string) => {
    const t = normalizeTag(raw);
    if (t && !tags.includes(t) && tags.length < 30) onChange([...tags, t]);
    setDraft('');
  };
  const suggestions = SUGGESTED.filter((s) => !tags.includes(s));
  return (
    <div>
      <div className="tag-input" onClick={() => document.getElementById(id)?.focus()}>
        {tags.map((t) => (
          <span key={t} className="tag" style={{ cursor: 'default' }}>
            {t}
            <button type="button" className="x" aria-label={`Remove tag ${t}`} onClick={() => onChange(tags.filter((x) => x !== t))}>
              <X size={12} />
            </button>
          </span>
        ))}
        <input
          id={id}
          value={draft}
          placeholder={tags.length ? '' : 'Add a tag and press Enter'}
          onChange={(e) => {
            const v = e.target.value;
            if (v.endsWith(',')) add(v.slice(0, -1));
            else setDraft(v);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft.trim()) {
              e.preventDefault();
              add(draft);
            } else if (e.key === 'Backspace' && !draft && tags.length) {
              onChange(tags.slice(0, -1));
            }
          }}
          onBlur={() => draft.trim() && add(draft)}
          aria-describedby={`${id}-help`}
        />
      </div>
      {suggestions.length > 0 && (
        <div className="tags" style={{ marginTop: 8 }} id={`${id}-help`}>
          {suggestions.map((s) => (
            <button key={s} type="button" className="tag" onClick={() => add(s)} aria-label={`Add tag ${s}`}>
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
