import { cardTheme } from '../../shared/cards';

/** Fixed icon for Banking / Cards items: a badge in the bank's colours with its short name. */
export function BankIcon({ bankName, title, size = 34, radius = 6 }: { bankName: string | undefined; title: string; size?: number; radius?: number }) {
  const theme = cardTheme(bankName, title);
  const len = theme.short.length;
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        flex: 'none',
        display: 'grid',
        placeItems: 'center',
        background: theme.background,
        color: theme.color,
        fontWeight: 800,
        fontSize: Math.round(size * (len <= 1 ? 0.5 : len === 2 ? 0.38 : len === 3 ? 0.3 : 0.25)),
        letterSpacing: '0.01em',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.18)'
      }}
    >
      {theme.short}
    </span>
  );
}

export const isBankItem = (categoryId: string) => categoryId === 'banking' || categoryId === 'cards';
