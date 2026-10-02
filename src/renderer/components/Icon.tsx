import {
  Briefcase,
  CalendarClock,
  CreditCard,
  FileText,
  Folder,
  Gamepad2,
  Globe,
  HeartPulse,
  House,
  IdCard,
  KeyRound,
  Landmark,
  Lock,
  Mail,
  Phone,
  Server,
  Shield,
  User,
  Wallet,
  Wifi,
  type LucideIcon
} from 'lucide-react';
import type { CategoryIcon as IconName } from '../../shared/types';

export const CATEGORY_ICONS: Record<IconName, LucideIcon> = {
  bank: Landmark,
  mail: Mail,
  globe: Globe,
  wifi: Wifi,
  key: KeyRound,
  user: User,
  note: FileText,
  card: CreditCard,
  lock: Lock,
  briefcase: Briefcase,
  server: Server,
  shield: Shield,
  home: House,
  phone: Phone,
  id: IdCard,
  folder: Folder,
  gamepad: Gamepad2,
  wallet: Wallet,
  health: HeartPulse,
  calendar: CalendarClock
};

export function CategoryIcon({ icon, size = 16 }: { icon: IconName | undefined; size?: number }) {
  const C = CATEGORY_ICONS[icon ?? 'folder'] ?? Folder;
  return <C size={size} strokeWidth={1.75} aria-hidden="true" />;
}
