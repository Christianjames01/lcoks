import { cardTheme, type CardTheme } from '../../shared/cards';
import type { EntryView } from '../../shared/types';
import { formatDate } from './format';

/** Categories that get a 3D card on their detail screen and a coloured badge icon. */
export const CARD_CATEGORIES = new Set(['banking', 'cards', 'wallets', 'ids', 'insurance', 'subscriptions']);
export const isCardCategory = (categoryId: string) => CARD_CATEGORIES.has(categoryId);

/** The field that names the brand/agency for an item, used to pick colours. */
export function brandOf(e: Pick<EntryView, 'categoryId' | 'fields'>): string | undefined {
  const f = e.fields;
  switch (e.categoryId) {
    case 'wallets':
    case 'insurance':
      return f.provider;
    case 'ids':
      return f.idType;
    case 'subscriptions':
      return f.service;
    default:
      return f.bankName;
  }
}

export interface CardSpec {
  theme: CardTheme;
  kind: 'bank' | 'wallet' | 'id' | 'insurance' | 'subscription';
  /** Small text, top-right (card type, ID type, plan…). */
  topRight: string;
  /** Header line above the brand (e.g. REPUBLIC OF THE PHILIPPINES). */
  emblem?: string;
  chip: boolean;
  contactless: boolean;
  /** Secret field shown masked on the card with Show/Copy buttons. */
  numberKey?: string;
  /** Non-secret main line when there is no secret number. */
  mainText?: string;
  mainCaption?: string;
  holderCaption: string;
  holder: string;
  extraCaption?: string;
  extra?: string;
  /** Right-bottom badge, e.g. blood type. (Card networks come from the secret meta.) */
  badge?: string;
  /** Secret on the back of the card (CVV). */
  backKey?: string;
}

function maskPhone(p: string | undefined): string | undefined {
  if (!p) return undefined;
  const d = p.replace(/\D/g, '');
  if (d.length < 7) return p;
  return `${d.slice(0, 4)} ••• ${d.slice(-4)}`;
}

export function cardSpec(e: EntryView): CardSpec | null {
  const f = e.fields;
  const theme = cardTheme(brandOf(e), e.title);
  switch (e.categoryId) {
    case 'banking':
      if (!e.secrets.accountNumber?.set && !f.bankName) return null;
      return { theme, kind: 'bank', topRight: '', chip: true, contactless: true, numberKey: 'accountNumber', holderCaption: 'Account name', holder: f.accountName ?? '' };
    case 'cards':
      return {
        theme,
        kind: 'bank',
        topRight: f.cardType ?? '',
        chip: true,
        contactless: true,
        numberKey: 'cardNumber',
        holderCaption: 'Cardholder',
        holder: f.cardholder ?? '',
        extraCaption: f.expiry ? 'Valid thru' : undefined,
        extra: f.expiry,
        backKey: e.secrets.cvv?.set ? 'cvv' : undefined
      };
    case 'wallets':
      return {
        theme,
        kind: 'wallet',
        topRight: 'E-Wallet',
        chip: false,
        contactless: true,
        mainText: maskPhone(f.mobileNumber) ?? '•••• ••• ••••',
        mainCaption: 'Mobile number',
        holderCaption: 'Account name',
        holder: f.accountName ?? ''
      };
    case 'ids':
      return {
        theme,
        kind: 'id',
        emblem: 'Republic of the Philippines',
        topRight: f.idType && f.idType !== theme.label ? f.idType : '',
        chip: false,
        contactless: false,
        numberKey: 'idNumber',
        holderCaption: 'Name',
        holder: f.fullName ?? '',
        extraCaption: f.expiryDate ? 'Valid until' : undefined,
        extra: f.expiryDate ? formatDate(f.expiryDate) : undefined
      };
    case 'insurance':
      return {
        theme,
        kind: 'insurance',
        topRight: f.policyType ?? '',
        chip: false,
        contactless: false,
        numberKey: 'memberNumber',
        holderCaption: 'Member',
        holder: f.insured ?? '',
        extraCaption: f.expiryDate ? 'Valid until' : undefined,
        extra: f.expiryDate ? formatDate(f.expiryDate) : undefined,
        badge: f.bloodType ? `Blood ${f.bloodType}` : undefined
      };
    case 'subscriptions':
      return {
        theme,
        kind: 'subscription',
        topRight: f.billingCycle ?? '',
        chip: false,
        contactless: false,
        mainText: f.plan || 'Subscription',
        mainCaption: 'Plan',
        holderCaption: 'Price',
        holder: f.price ? `${f.price}${f.billingCycle ? ' / ' + f.billingCycle.toLowerCase().replace('monthly', 'month').replace('yearly', 'year') : ''}` : '',
        extraCaption: f.renewalDate ? 'Renews' : undefined,
        extra: f.renewalDate ? formatDate(f.renewalDate) : undefined
      };
    default:
      return null;
  }
}
