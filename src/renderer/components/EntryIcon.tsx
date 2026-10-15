import { siteBadge } from '../../shared/sites';
import type { CategoryDef, EntryView } from '../../shared/types';
import { brandOf, isCardCategory } from '../lib/cardSpec';
import { BankIcon } from './BankIcon';
import { CategoryIcon } from './Icon';

/** Categories whose items are logins to a site or app: they get a letter avatar in the site's colour. */
const LOGIN_CATEGORIES = new Set(['social', 'email', 'software', 'games', 'personal', 'others']);

function websiteOf(entry: EntryView, category: CategoryDef | undefined): string | undefined {
  const urlField = category?.fields.find((f) => f.type === 'url' && entry.fields[f.key]);
  if (urlField) return entry.fields[urlField.key];
  const email = entry.fields.email ?? category?.fields.filter((f) => f.type === 'email').map((f) => entry.fields[f.key]).find(Boolean);
  const domain = email?.split('@')[1];
  return domain || undefined;
}

/**
 * The icon in front of an item: bank badge (cards, banks, IDs…), site avatar
 * (logins) or the category icon. `data-vt` lets the row morph into the detail header.
 */
export function EntryIcon({ entry, category, size = 34 }: { entry: EntryView; category: CategoryDef | undefined; size?: number }) {
  const radius = size >= 44 ? 10 : 7;
  if (isCardCategory(entry.categoryId)) {
    return (
      <span className="entry-icon" data-vt="icon">
        <BankIcon bankName={brandOf(entry)} title={entry.title} size={size} radius={radius} />
      </span>
    );
  }
  const login = LOGIN_CATEGORIES.has(entry.categoryId) || (!category?.builtin && category?.fields.some((f) => f.type === 'url'));
  const badge = login
    ? siteBadge(websiteOf(entry, category), [entry.fields.platform, entry.fields.service, entry.fields.provider, entry.title])
    : null;
  if (badge) {
    const len = badge.text.length;
    return (
      <span className="entry-icon" data-vt="icon" aria-hidden>
        <span
          className="site-badge"
          style={{
            width: size,
            height: size,
            borderRadius: radius,
            background: badge.background,
            color: badge.color,
            fontSize: Math.round(size * (len <= 1 ? 0.5 : len === 2 ? 0.38 : 0.3))
          }}
        >
          {badge.text}
        </span>
      </span>
    );
  }
  return (
    <span className="entry-icon row-icon" data-vt="icon" style={size !== 34 ? { width: size, height: size } : undefined}>
      <CategoryIcon icon={category?.icon} size={size >= 44 ? 22 : undefined} />
    </span>
  );
}
