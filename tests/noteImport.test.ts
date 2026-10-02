import { describe, expect, it } from 'vitest';
import { BUILTIN_CATEGORIES } from '../src/shared/categories';
import { classifyNote, importNotes, splitNotes } from '../src/shared/noteImport';

const cats = [...BUILTIN_CATEGORIES];

const PASTE = `BPI Savings
Account number: 1234 5678 9012
Username: juan.dc
Password: Bpi$ecret2024
PIN: 4321

Gmail
Email: juan@gmail.com
Password: g-mail-pass-99
Recovery phone: 09171234567

Facebook
Username: juan.fb
Password: fbPass!77

Home Wi-Fi
SSID: PLDT_HOME_5G
Password: wifiPass123

Windows 11
Product key: ABCDE-FGHIJ-KLMNO-PQRST-UVWXY

Netflix
email: juan@yahoo.com
password: netflixPw1

Grocery list
eggs, milk, bread

Backup codes
8492 1173 5520
9981 0042 7713`;

describe('splitNotes', () => {
  it('splits on blank lines by default', () => {
    expect(splitNotes(PASTE)).toHaveLength(8);
  });
  it('uses --- separators when present (notes may contain blank lines)', () => {
    const t = 'Note A\n\nstill A\n---\nNote B\n===\nNote C';
    expect(splitNotes(t)).toEqual(['Note A\n\nstill A', 'Note B', 'Note C']);
  });
  it('supports two-blank-line mode and Windows line endings', () => {
    expect(splitNotes('A\r\n\r\nA2\r\n\r\n\r\nB', 'blank2')).toEqual(['A\n\nA2', 'B']);
  });
  it('ignores empty input', () => {
    expect(splitNotes('   \n\n  ')).toEqual([]);
  });
});

describe('classifyNote', () => {
  const items = importNotes(PASTE, cats);
  const by = (t: string) => items.find((i) => i.title === t)!;

  it('routes each note to the right category', () => {
    expect(items.map((i) => [i.title, i.categoryId])).toEqual([
      ['BPI Savings', 'banking'],
      ['Gmail', 'email'],
      ['Facebook', 'social'],
      ['Home Wi-Fi', 'others'],
      ['Windows 11', 'software'],
      ['Netflix', 'subscriptions'],
      ['Grocery list', 'notes'],
      ['Backup codes', 'notes']
    ]);
  });

  it('fills the matching fields', () => {
    expect(by('BPI Savings').fields).toMatchObject({
      bankName: 'BPI',
      accountNumber: '1234 5678 9012',
      username: 'juan.dc',
      password: 'Bpi$ecret2024',
      pin: '4321'
    });
    expect(by('Gmail').fields).toMatchObject({ email: 'juan@gmail.com', password: 'g-mail-pass-99', recoveryPhone: '09171234567', service: 'Gmail' });
    expect(by('Home Wi-Fi').fields).toMatchObject({ name: 'PLDT_HOME_5G', password: 'wifiPass123' });
    expect(by('Windows 11').fields).toMatchObject({ licenseKey: 'ABCDE-FGHIJ-KLMNO-PQRST-UVWXY' });
    expect(by('Netflix').fields).toMatchObject({ service: 'Netflix', email: 'juan@yahoo.com', password: 'netflixPw1' });
    expect(by('Facebook').fields).toMatchObject({ username: 'juan.fb', password: 'fbPass!77' });
    expect(by('Backup codes').fields.content).toContain('8492 1173 5520');
  });

  it('detects bank cards', () => {
    const c = classifyNote('BDO Visa Debit\nCard number: 4111 1111 1111 1111\nExpiry: 8/2028\nCVV: 123\nName on card: Juan Dela Cruz\nPIN: 9876', cats);
    expect(c.categoryId).toBe('cards');
    expect(c.fields).toMatchObject({ bankName: 'BDO', cardNumber: '4111 1111 1111 1111', expiry: '08/28', cvv: '123', cardholder: 'Juan Dela Cruz', pin: '9876' });
  });

  it('detects e-wallets with MPIN and security questions (kept hidden)', () => {
    const w = classifyNote('GCash\nMobile: 09171234567\nAccount name: Juan Dela Cruz\nMPIN: 1357\nQuestion: First pet?\nAnswer: Bantay', cats);
    expect(w.categoryId).toBe('wallets');
    expect(w.fields).toMatchObject({ provider: 'GCash', mobileNumber: '09171234567', accountName: 'Juan Dela Cruz', mpin: '1357' });
    expect(w.fields.securityQA).toBe('Question: First pet?\nAnswer: Bantay');
    expect(w.fields.notes ?? '').not.toContain('Bantay');
  });

  it('detects government IDs and converts dates', () => {
    const p = classifyNote('Passport\nPassport no: P1234567A\nName on ID: Juan Dela Cruz\nExpiry: 10/05/2030', cats);
    expect(p.categoryId).toBe('ids');
    expect(p.fields).toMatchObject({ idType: 'Passport', idNumber: 'P1234567A', fullName: 'Juan Dela Cruz', expiryDate: '2030-10-05' });
    const sss = classifyNote('SSS\nNumber: 34-1234567-8', cats);
    expect(sss.fields).toMatchObject({ idType: 'SSS', idNumber: '34-1234567-8' });
    expect(classifyNote('TIN: 123-456-789-000', cats).fields.idType).toBe('TIN (BIR)');
  });

  it('detects insurance / medical info', () => {
    const i = classifyNote('Maxicare\nMember ID: 1122334455\nBlood type: o+\nAllergies: Penicillin\nEmergency contact: Maria 0918 000 0000\nValid until: Dec 31, 2026', cats);
    expect(i.categoryId).toBe('insurance');
    expect(i.fields).toMatchObject({ policyType: 'HMO', memberNumber: '1122334455', bloodType: 'O+', allergies: 'Penicillin', emergencyContacts: 'Maria 0918 000 0000', expiryDate: '2026-12-31' });
  });

  it('detects subscriptions with renewal dates', () => {
    const s = classifyNote('Spotify\nEmail: juan@gmail.com\nPassword: sp0t!fy\nPlan: Premium Family\nPrice: ₱279/month\nRenewal: Oct 15, 2026', cats);
    expect(s.categoryId).toBe('subscriptions');
    expect(s.fields).toMatchObject({ service: 'Spotify', plan: 'Premium Family', price: '₱279/month', billingCycle: 'Monthly', renewalDate: '2026-10-15' });
  });

  it('detects game accounts', () => {
    const a = classifyNote('Mobile Legends\nIGN: JuanSlayer\nUID: 123456789 (2034)\nEmail: juan@gmail.com\nPassword: mlbbPass1', cats);
    expect(a.categoryId).toBe('games');
    expect(a.fields).toMatchObject({ platform: 'Mobile Legends', username: 'JuanSlayer', accountId: '123456789 (2034)', email: 'juan@gmail.com', password: 'mlbbPass1' });
    expect(classifyNote('Steam\nUsername: juan_gamer\nPassword: st3am!', cats).categoryId).toBe('games');
    expect(classifyNote('Genshin Impact\nUID: 800123456', cats).categoryId).toBe('games');
  });

  it('never puts an unlabeled secret into a visible field', () => {
    const n = classifyNote('My bank\nUsername: juan\nP@ssw0rd2024 is the password', cats);
    expect(n.categoryId).toBe('notes');
    expect(n.fields.content).toContain('P@ssw0rd2024');
    expect(n.fields.notes).toBeUndefined();
  });

  it('does not mistake an email domain for a website', () => {
    const n = classifyNote('Shop\nUsername: me@gmail.com\nPassword: x1', cats);
    expect(n.fields.website).toBeUndefined();
  });

  it('handles notes without a title line', () => {
    const n = classifyNote('Password: abc123\nUsername: someone', cats, 4);
    expect(n.categoryId).toBe('personal');
    expect(n.title).toBe('Imported Personal 5');
  });

  it('keeps unknown labels as notes and tags items as imported', () => {
    const n = classifyNote('Library card\nUsername: juan\nPassword: sp1\nBranch: Makati', cats);
    expect(n.fields.notes).toBe('Branch: Makati');
    expect(n.tags).toEqual(['imported']);
  });
});
