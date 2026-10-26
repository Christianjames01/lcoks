import type { CategoryDef } from './types';

import { tr } from './i18n';
export const NOTES_FIELD = { key: 'notes', label: tr("Notes"), type: 'textarea' } as const;

export const BUILTIN_CATEGORIES: readonly CategoryDef[] = [
  {
    id: 'banking',
    name: tr('Banking'),
    icon: 'bank',
    builtin: true,
    fields: [
      { key: 'bankName', label: tr("Bank name"), type: 'text' },
      { key: 'accountName', label: tr("Account name"), type: 'text' },
      { key: 'accountType', label: tr("Account type"), type: 'select', options: ['Savings', 'Checking / Current', 'Payroll', 'Time deposit', 'Joint', 'Other'] },
      { key: 'accountNumber', label: tr("Account number"), type: 'secret', partialMask: true },
      { key: 'username', label: tr("Username"), type: 'username' },
      { key: 'password', label: tr("Password"), type: 'password' },
      { key: 'pin', label: tr("PIN"), type: 'pin' },
      { key: 'website', label: tr("Website"), type: 'url' },
      { key: 'customerNumber', label: tr("Customer number"), type: 'text' },
      { key: 'securityQA', label: tr("Security questions & answers"), type: 'secretTextarea' },
      { ...NOTES_FIELD }
    ]
  },
  {
    id: 'cards',
    name: tr('Cards'),
    icon: 'card',
    builtin: true,
    fields: [
      { key: 'bankName', label: tr("Bank / issuer"), type: 'text', placeholder: tr("BPI, BDO, GCash…") },
      { key: 'cardType', label: tr("Card type"), type: 'select', options: ['Debit', 'Credit', 'Prepaid', 'ATM', 'Virtual'] },
      { key: 'cardholder', label: tr("Cardholder name"), type: 'text' },
      { key: 'cardNumber', label: tr("Card number"), type: 'secret', partialMask: true },
      { key: 'expiry', label: tr("Expiry (MM/YY)"), type: 'text', placeholder: tr("MM/YY") },
      { key: 'cvv', label: tr("CVV / CVC"), type: 'pin' },
      { key: 'pin', label: tr("PIN"), type: 'pin' },
      { ...NOTES_FIELD }
    ]
  },
  {
    id: 'wallets',
    name: tr('E-Wallets'),
    icon: 'wallet',
    builtin: true,
    fields: [
      { key: 'provider', label: tr("E-wallet"), type: 'text', placeholder: tr("GCash, Maya, ShopeePay, GrabPay…") },
      { key: 'mobileNumber', label: tr("Registered mobile number"), type: 'phone' },
      { key: 'accountName', label: tr("Account name"), type: 'text' },
      { key: 'email', label: tr("Email"), type: 'email' },
      { key: 'mpin', label: tr("MPIN"), type: 'pin' },
      { key: 'password', label: tr("Password"), type: 'password' },
      { key: 'securityQA', label: tr("Security questions & answers"), type: 'secretTextarea' },
      { ...NOTES_FIELD }
    ]
  },
  {
    id: 'email',
    name: tr('Email'),
    icon: 'mail',
    builtin: true,
    fields: [
      { key: 'service', label: tr("Service"), type: 'text' },
      { key: 'email', label: tr("Email address"), type: 'email' },
      { key: 'password', label: tr("Password"), type: 'password' },
      { key: 'recoveryEmail', label: tr("Recovery email"), type: 'email' },
      { key: 'recoveryPhone', label: tr("Recovery phone"), type: 'phone' },
      { ...NOTES_FIELD }
    ]
  },
  {
    id: 'social',
    name: tr('Social Media'),
    icon: 'globe',
    builtin: true,
    fields: [
      { key: 'platform', label: tr("Platform"), type: 'text' },
      { key: 'username', label: tr("Username"), type: 'username' },
      { key: 'email', label: tr("Email"), type: 'email' },
      { key: 'password', label: tr("Password"), type: 'password' },
      { key: 'profileUrl', label: tr("Profile URL"), type: 'url' },
      { ...NOTES_FIELD }
    ]
  },
  {
    id: 'software',
    name: tr('Software License'),
    icon: 'key',
    builtin: true,
    fields: [
      { key: 'product', label: tr("Product"), type: 'text' },
      { key: 'licenseKey', label: tr("License key"), type: 'secret', partialMask: true },
      { key: 'username', label: tr("Username"), type: 'username' },
      { key: 'purchaseDate', label: tr("Purchase date"), type: 'date' },
      { key: 'expirationDate', label: tr("Expiration date"), type: 'date' },
      { ...NOTES_FIELD }
    ]
  },
  {
    id: 'games',
    name: tr('Games'),
    icon: 'gamepad',
    builtin: true,
    fields: [
      {
        key: 'platform',
        label: tr("Game / platform"),
        type: 'text',
        placeholder: tr("Steam, Mobile Legends, Genshin, Roblox…")
      },
      { key: 'username', label: tr("Username / in-game name"), type: 'username' },
      { key: 'accountId', label: tr("Account ID / UID"), type: 'text' },
      { key: 'email', label: tr("Login email"), type: 'email' },
      { key: 'password', label: tr("Password"), type: 'password' },
      { key: 'website', label: tr("Website"), type: 'url' },
      { ...NOTES_FIELD }
    ]
  },
  {
    id: 'ids',
    name: tr('IDs & Government'),
    icon: 'id',
    builtin: true,
    fields: [
      {
        key: 'idType',
        label: tr("ID type"),
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
      { key: 'idNumber', label: tr("ID number"), type: 'secret', partialMask: true },
      { key: 'fullName', label: tr("Name on ID"), type: 'text' },
      { key: 'issueDate', label: tr("Issued"), type: 'date' },
      { key: 'expiryDate', label: tr("Expires"), type: 'date' },
      { key: 'issuedBy', label: tr("Issued by / place"), type: 'text' },
      { ...NOTES_FIELD }
    ]
  },
  {
    id: 'insurance',
    name: tr('Insurance & Medical'),
    icon: 'health',
    builtin: true,
    fields: [
      { key: 'provider', label: tr("Provider"), type: 'text', placeholder: tr("Maxicare, PhilHealth, Sun Life…") },
      { key: 'policyType', label: tr("Type"), type: 'select', options: ['HMO', 'PhilHealth', 'Health insurance', 'Life insurance', 'Car insurance', 'Other'] },
      { key: 'memberNumber', label: tr("Policy / member number"), type: 'secret', partialMask: true },
      { key: 'insured', label: tr("Insured person"), type: 'text' },
      { key: 'coverage', label: tr("Coverage / plan"), type: 'text' },
      { key: 'expiryDate', label: tr("Valid until"), type: 'date' },
      { key: 'bloodType', label: tr("Blood type"), type: 'select', options: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] },
      { key: 'allergies', label: tr("Allergies & medical conditions"), type: 'textarea' },
      { key: 'emergencyContacts', label: tr("Emergency contacts"), type: 'textarea' },
      { ...NOTES_FIELD }
    ]
  },
  {
    id: 'subscriptions',
    name: tr('Subscriptions'),
    icon: 'calendar',
    builtin: true,
    fields: [
      { key: 'service', label: tr("Service"), type: 'text', placeholder: tr("Netflix, Spotify, YouTube Premium…") },
      { key: 'email', label: tr("Login email"), type: 'email' },
      { key: 'password', label: tr("Password"), type: 'password' },
      { key: 'plan', label: tr("Plan"), type: 'text', placeholder: tr("Premium, Family…") },
      { key: 'price', label: tr("Price"), type: 'text', placeholder: '₱549' },
      { key: 'billingCycle', label: tr("Billing"), type: 'select', options: ['Monthly', 'Yearly', 'Quarterly', 'Weekly', 'One-time'] },
      { key: 'renewalDate', label: tr("Next renewal"), type: 'date' },
      { key: 'paymentMethod', label: tr("Paid with"), type: 'text' },
      { ...NOTES_FIELD }
    ]
  },
  {
    id: 'loyalty',
    name: tr('Loyalty & Rewards'),
    icon: 'gift',
    builtin: true,
    fields: [
      { key: 'brand', label: tr("Store / brand"), type: 'text', placeholder: tr("Starbucks, Coffee Bean, SM Advantage…") },
      { key: 'memberName', label: tr("Member name"), type: 'text' },
      { key: 'cardNumber', label: tr("Card / member number"), type: 'secret', partialMask: true },
      { key: 'pin', label: tr("PIN"), type: 'pin' },
      { key: 'points', label: tr("Points / stars"), type: 'text', placeholder: tr("120 stars, 3 free drinks…") },
      { key: 'email', label: tr("Login email"), type: 'email' },
      { key: 'password', label: tr("Password"), type: 'password' },
      { key: 'expiryDate', label: tr("Valid until"), type: 'date' },
      { ...NOTES_FIELD }
    ]
  },
  {
    id: 'giftcards',
    name: tr('Gift cards & vouchers'),
    icon: 'ticket',
    builtin: true,
    fields: [
      { key: 'brand', label: tr("Store / brand"), type: 'text', placeholder: tr("Starbucks, SM, Jollibee…") },
      { key: 'cardNumber', label: tr("Card / voucher number"), type: 'secret', partialMask: true },
      { key: 'pin', label: tr("PIN / security code"), type: 'pin' },
      { key: 'balance', label: tr("Balance left"), type: 'text', placeholder: '1,000' },
      { key: 'initialValue', label: tr("Original value"), type: 'text', placeholder: '1,000' },
      { key: 'expiryDate', label: tr("Valid until"), type: 'date' },
      { key: 'history', label: tr("Use history"), type: 'textarea' },
      { ...NOTES_FIELD }
    ]
  },
  {
    id: 'wifiNetwork',
    name: tr('Wi-Fi networks'),
    icon: 'wifi',
    builtin: true,
    fields: [
      { key: 'ssid', label: tr("Network name (SSID)"), type: 'text', placeholder: tr("PLDT-Home 5G") },
      { key: 'password', label: tr("Wi-Fi password"), type: 'password' },
      { key: 'security', label: tr("Security"), type: 'select', options: ['WPA / WPA2 / WPA3', 'WEP', 'None (open)'] },
      { key: 'hidden', label: tr("Hidden network"), type: 'select', options: ['No', 'Yes'] },
      { key: 'adminUrl', label: tr("Router admin page"), type: 'url', placeholder: 'http://192.168.1.1' },
      { key: 'adminUser', label: tr("Router admin username"), type: 'username' },
      { key: 'adminPassword', label: tr("Router admin password"), type: 'password' },
      { ...NOTES_FIELD }
    ]
  },
  {
    id: 'personal',
    name: tr('Passwords'),
    icon: 'user',
    builtin: true,
    fields: [
      { key: 'username', label: tr("Username"), type: 'username' },
      { key: 'password', label: tr("Password"), type: 'password' },
      { key: 'website', label: tr("Website"), type: 'url' },
      { ...NOTES_FIELD }
    ]
  },
  {
    id: 'personalInfo',
    name: tr('Personal Information'),
    icon: 'user',
    builtin: true,
    fields: [
      { key: 'fullName', label: tr("Full name"), type: 'text' },
      { key: 'birthDate', label: tr("Date of birth"), type: 'date' },
      { key: 'phone', label: tr("Phone"), type: 'phone' },
      { key: 'email', label: tr("Email"), type: 'email' },
      { key: 'address', label: tr("Address"), type: 'textarea' },
      { key: 'nationality', label: tr("Nationality"), type: 'text' },
      { ...NOTES_FIELD }
    ]
  },
  {
    id: 'documents',
    name: tr('Documents'),
    icon: 'folder',
    builtin: true,
    fields: [
      {
        key: 'documentType',
        label: tr("Document type"),
        type: 'select',
        options: ['Passport', 'Birth certificate', 'Marriage certificate', 'Diploma / Transcript', 'Contract', 'Certificate', 'Medical record', 'Land title / Deed', 'Receipt / Warranty', 'Other']
      },
      { key: 'documentNumber', label: tr("Document number"), type: 'secret', partialMask: true },
      { key: 'issuedBy', label: tr("Issued by"), type: 'text' },
      { key: 'issueDate', label: tr("Issued"), type: 'date' },
      { key: 'expiryDate', label: tr("Expires"), type: 'date' },
      { ...NOTES_FIELD }
    ]
  },
  {
    id: 'others',
    name: tr('Others'),
    icon: 'folder',
    builtin: true,
    fields: [
      { key: 'name', label: tr("Name / account"), type: 'text' },
      { key: 'username', label: tr("Username"), type: 'username' },
      { key: 'password', label: tr("Password"), type: 'password' },
      { key: 'pin', label: tr("PIN / code"), type: 'pin' },
      { key: 'website', label: tr("Website"), type: 'url' },
      { ...NOTES_FIELD }
    ]
  },
  {
    id: 'notes',
    name: tr('Secure Notes'),
    icon: 'note',
    builtin: true,
    fields: [{ key: 'content', label: tr("Secure note"), type: 'secretTextarea' }]
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
