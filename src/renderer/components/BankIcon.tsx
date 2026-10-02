import { bankKey, cardTheme } from '../../shared/cards';

/**
 * Icon for Banking / Cards items: the user's own logo image for that bank if they
 * set one, otherwise a badge in the bank's colour with its short name.
 */
export function BankIcon({
  bankName,
  title,
  icons,
  size = 34,
  radius = 6
}: {
  bankName: string | undefined;
  title: string;
  icons: Record<string, string>;
  size?: number;
  radius?: number;
}) {
  const custom = icons[bankKey(bankName, title)];
  const theme = cardTheme(bankName, title);
  const common = { width: size, height: size, borderRadius: radius, flex: 'none' as const };
  if (custom) {
    return <img src={custom} alt="" aria-hidden style={{ ...common, objectFit: 'cover', background: '#fff', display: 'block' }} />;
  }
  const len = theme.short.length;
  return (
    <span
      aria-hidden
      style={{
        ...common,
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
