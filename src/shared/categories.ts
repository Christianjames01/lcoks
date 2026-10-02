import type { CategoryDef } from './types';

export const NOTES_FIELD = { key: 'notes', label: 'Notes', type: 'textarea' } as const;

export const BUILTIN_CATEGORIES: readonly CategoryDef[] = [
  {
    id: 'banking',
    name: 'Banking',
    icon: 'bank',
    builtin: true,
    fields: [
      { key: 'bankName', label: 'Bank name', type: 'text' },
      { key: 'accountName', label: 'Account name', type: 'text' },
      { key: 'accountNumber', label: 'Account number', type: 'secret', partialMask: true },
      { key: 'username', label: 'Username', type: 'username' },
      { key: 'password', label: 'Password', type: 'password' },
      { key: 'pin', label: 'PIN', type: 'pin' },
      { key: 'website', label: 'Website', type: 'url' },
      { key: 'customerNumber', label: 'Customer number', type: 'text' },
      { key: 'securityQA', label: 'Security questions & answers', type: 'secretTextarea' },
      { key: 'frontImage', label: 'Card photo · front', type: 'secretImage' },
      { key: 'backImage', label: 'Card photo · back', type: 'secretImage' },
      { ...NOTES_FIELD }
    ]
  },
  {
    id: 'cards',
    name: 'Cards',
    icon: 'card',
    builtin: true,
    fields: [
      { key: 'bankName', label: 'Bank / issuer', type: 'text', placeholder: 'BPI, BDO, GCash…' },
      { key: 'cardType', label: 'Card type', type: 'select', options: ['Debit', 'Credit', 'Prepaid', 'ATM', 'Virtual'] },
      { key: 'cardholder', label: 'Cardholder name', type: 'text' },
      { key: 'cardNumber', label: 'Card number', type: 'secret', partialMask: true },
      { key: 'expiry', label: 'Expiry (MM/YY)', type: 'text', placeholder: 'MM/YY' },
      { key: 'cvv', label: 'CVV / CVC', type: 'pin' },
      { key: 'pin', label: 'PIN', type: 'pin' },
      { key: 'frontImage', label: 'Card photo · front', type: 'secretImage' },
      { key: 'backImage', label: 'Card photo · back', type: 'secretImage' },
      { ...NOTES_FIELD }
    ]
  },
  {
    id: 'wallets',
    name: 'E-Wallets',
    icon: 'wallet',
    builtin: true,
    fields: [
      { key: 'provider', label: 'E-wallet', type: 'text', placeholder: 'GCash, Maya, ShopeePay, GrabPay…' },
      { key: 'mobileNumber', label: 'Registered mobile number', type: 'phone' },
      { key: 'accountName', label: 'Account name', type: 'text' },
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'mpin', label: 'MPIN', type: 'pin' },
      { key: 'password', label: 'Password', type: 'password' },
      { key: 'securityQA', label: 'Security questions & answers', type: 'secretTextarea' },
      { ...NOTES_FIELD }
    ]
  },
  {
    id: 'email',
    name: 'Email',
    icon: 'mail',
    builtin: true,
    fields: [
      { key: 'service', label: 'Service', type: 'text' },
      { key: 'email', label: 'Email address', type: 'email' },
      { key: 'password', label: 'Password', type: 'password' },
      { key: 'recoveryEmail', label: 'Recovery email', type: 'email' },
      { key: 'recoveryPhone', label: 'Recovery phone', type: 'phone' },
      { ...NOTES_FIELD }
    ]
  },
  {
    id: 'social',
    name: 'Social Media',
    icon: 'globe',
    builtin: true,
    fields: [
      { key: 'platform', label: 'Platform', type: 'text' },
      { key: 'username', label: 'Username', type: 'username' },
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'password', label: 'Password', type: 'password' },
      { key: 'profileUrl', label: 'Profile URL', type: 'url' },
      { ...NOTES_FIELD }
    ]
  },
  {
    id: 'software',
    name: 'Software License',
    icon: 'key',
    builtin: true,
    fields: [
      { key: 'product', label: 'Product', type: 'text' },
      { key: 'licenseKey', label: 'License key', type: 'secret', partialMask: true },
      { key: 'username', label: 'Username', type: 'username' },
      { key: 'purchaseDate', label: 'Purchase date', type: 'date' },
      { key: 'expirationDate', label: 'Expiration date', type: 'date' },
      { ...NOTES_FIELD }
    ]
  },
  {
    id: 'games',
    name: 'Games',
    icon: 'gamepad',
    builtin: true,
    fields: [
      {
        key: 'platform',
        label: 'Game / platform',
        type: 'text',
        placeholder: 'Steam, Mobile Legends, Genshin, Roblox…'
      },
      { key: 'username', label: 'Username / in-game name', type: 'username' },
      { key: 'accountId', label: 'Account ID / UID', type: 'text' },
      { key: 'email', label: 'Login email', type: 'email' },
      { key: 'password', label: 'Password', type: 'password' },
      { key: 'website', label: 'Website', type: 'url' },
      { ...NOTES_FIELD }
    ]
  },
  {
    id: 'ids',
    name: 'IDs & Government',
    icon: 'id',
    builtin: true,
    fields: [
      {
        key: 'idType',
        label: 'ID type',
        type: 'select',
        options: [
          'PhilSys National ID',
          'SSS',
          'PhilHealth',
          'Pag-IBIG (HDMF)',
          'TIN (BIR)',
          'UMID',
          'Passport',
          "Driver's License",
          'PRC License',
          'Postal ID',
          "Voter's ID",
          'Other'
        ]
      },
      { key: 'idNumber', label: 'ID number', type: 'secret', partialMask: true },
      { key: 'fullName', label: 'Name on ID', type: 'text' },
      { key: 'issueDate', label: 'Issued', type: 'date' },
      { key: 'expiryDate', label: 'Expires', type: 'date' },
      { key: 'issuedBy', label: 'Issued by / place', type: 'text' },
      { key: 'frontImage', label: 'Card photo · front', type: 'secretImage' },
      { key: 'backImage', label: 'Card photo · back', type: 'secretImage' },
      { ...NOTES_FIELD }
    ]
  },
  {
    id: 'insurance',
    name: 'Insurance & Medical',
    icon: 'health',
    builtin: true,
    fields: [
      { key: 'provider', label: 'Provider', type: 'text', placeholder: 'Maxicare, PhilHealth, Sun Life…' },
      { key: 'policyType', label: 'Type', type: 'select', options: ['HMO', 'PhilHealth', 'Health insurance', 'Life insurance', 'Car insurance', 'Other'] },
      { key: 'memberNumber', label: 'Policy / member number', type: 'secret', partialMask: true },
      { key: 'insured', label: 'Insured person', type: 'text' },
      { key: 'coverage', label: 'Coverage / plan', type: 'text' },
      { key: 'expiryDate', label: 'Valid until', type: 'date' },
      { key: 'bloodType', label: 'Blood type', type: 'select', options: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] },
      { key: 'allergies', label: 'Allergies & medical conditions', type: 'textarea' },
      { key: 'emergencyContacts', label: 'Emergency contacts', type: 'textarea' },
      { key: 'frontImage', label: 'Card photo · front', type: 'secretImage' },
      { key: 'backImage', label: 'Card photo · back', type: 'secretImage' },
      { ...NOTES_FIELD }
    ]
  },
  {
    id: 'subscriptions',
    name: 'Subscriptions',
    icon: 'calendar',
    builtin: true,
    fields: [
      { key: 'service', label: 'Service', type: 'text', placeholder: 'Netflix, Spotify, YouTube Premium…' },
      { key: 'email', label: 'Login email', type: 'email' },
      { key: 'password', label: 'Password', type: 'password' },
      { key: 'plan', label: 'Plan', type: 'text', placeholder: 'Premium, Family…' },
      { key: 'price', label: 'Price', type: 'text', placeholder: '₱549' },
      { key: 'billingCycle', label: 'Billing', type: 'select', options: ['Monthly', 'Yearly', 'Quarterly', 'Weekly', 'One-time'] },
      { key: 'renewalDate', label: 'Next renewal', type: 'date' },
      { key: 'paymentMethod', label: 'Paid with', type: 'text' },
      { ...NOTES_FIELD }
    ]
  },
  {
    id: 'personal',
    name: 'Personal',
    icon: 'user',
    builtin: true,
    fields: [
      { key: 'username', label: 'Username', type: 'username' },
      { key: 'password', label: 'Password', type: 'password' },
      { key: 'website', label: 'Website', type: 'url' },
      { ...NOTES_FIELD }
    ]
  },
  {
    id: 'others',
    name: 'Others',
    icon: 'folder',
    builtin: true,
    fields: [
      { key: 'name', label: 'Name / account', type: 'text' },
      { key: 'username', label: 'Username', type: 'username' },
      { key: 'password', label: 'Password', type: 'password' },
      { key: 'pin', label: 'PIN / code', type: 'pin' },
      { key: 'website', label: 'Website', type: 'url' },
      { ...NOTES_FIELD }
    ]
  },
  {
    id: 'notes',
    name: 'Secure Notes',
    icon: 'note',
    builtin: true,
    fields: [{ key: 'content', label: 'Secure note', type: 'secretTextarea' }]
  }
];

export const BUILTIN_IDS: ReadonlySet<string> = new Set(BUILTIN_CATEGORIES.map((c) => c.id));

/** Field key used to pick a "subtitle" for list rows. */
export function subtitleFor(category: CategoryDef | undefined, fields: Record<string, string>): string {
  if (!category) return '';
  const order = ['cardholder', 'fullName', 'insured', 'mobileNumber', 'plan', 'username', 'email', 'accountName', 'name', 'service', 'platform', 'product', 'accountId', 'website'];
  for (const key of order) {
    const def = category.fields.find((f) => f.key === key);
    if (def && fields[key]) return fields[key];
  }
  for (const def of category.fields) {
    if (['text', 'username', 'email', 'url'].includes(def.type) && fields[def.key]) return fields[def.key];
  }
  return category.name;
}
