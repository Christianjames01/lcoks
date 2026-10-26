// Reading every line of a receipt: items, VAT, totals, cash and change, store.

import { describe, expect, it } from 'vitest';
import { readReceipt } from '../src/shared/receipt';

describe('readReceipt', () => {
  it('fast food receipt with VAT breakdown and cash', () => {
    const r = readReceipt([
      'JOLLIBEE',
      'SM City Davao',
      'VAT REG TIN 000-123-456-000',
      'OR No. 001234',
      '10/25/2026 12:41 PM',
      '1 Chickenjoy C1 129.00',
      '2 Jolly Spaghetti 70.00 140.00',
      '1 Pineapple Juice 55.00',
      'SUBTOTAL 324.00',
      'VATable Sales 289.29',
      'VAT 12% 34.71',
      'VAT-Exempt 0.00',
      'TOTAL 324.00',
      'CASH 500.00',
      'CHANGE 176.00',
      'THANK YOU! COME AGAIN'
    ]);
    expect(r.store).toBe('Jollibee');
    expect(r.branch).toBe('SM City Davao');
    expect(r.number).toBe('001234');
    expect(r.items).toEqual([
      { qty: 1, name: 'Chickenjoy C1', price: 12900, amount: 12900 },
      { qty: 2, name: 'Jolly Spaghetti', price: 7000, amount: 14000 },
      { qty: 1, name: 'Pineapple Juice', price: 5500, amount: 5500 }
    ]);
    expect(r).toMatchObject({ subtotal: 32400, vatable: 28929, vat: 3471, vatExempt: 0, total: 32400, payment: 'Cash', cash: 50000, change: 17600 });
  });

  it('coffee shop: "2 x Iced Latte @120.00 240.00", item numbers on the next line, discount, GCash', () => {
    const r = readReceipt([
      'BO\'S COFFEE',
      'Abreeza Mall',
      '2 x Iced Latte @120.00 240.00',
      'Ensaymada',
      '1 x 65.00 65.00',
      'Sub-Total 305.00',
      'Senior Discount 20.00',
      'Total Amount Due 285.00',
      'GCash 285.00'
    ]);
    expect(r.store).toBe("Bo's Coffee");
    expect(r.items).toEqual([
      { qty: 2, name: 'Iced Latte', price: 12000, amount: 24000 },
      { qty: 1, name: 'Ensaymada', price: 6500, amount: 6500 }
    ]);
    expect(r).toMatchObject({ subtotal: 30500, discount: 2000, total: 28500, payment: 'GCash', cash: 0, change: 0 });
  });

  it('labels and values on separate lines; change worked out when missing', () => {
    const r = readReceipt(['7-ELEVEN', 'Bread 45.00', 'Water 25.00', 'TOTAL', '70.00', 'CASH', '100.00']);
    expect(r.store).toBe('7-Eleven');
    expect(r.items.map((i) => i.name)).toEqual(['Bread', 'Water']);
    expect(r).toMatchObject({ total: 7000, cash: 10000, change: 3000 });
  });

  it('"name qty price" lines and big amounts', () => {
    const r = readReceipt(['MANG INASAL', 'Rice 1 129.00', 'Halo-halo 2 95.00 190.00', 'Family Pack 1,250.00', 'TOTAL 1,569.00']);
    expect(r.items).toEqual([
      { qty: 1, name: 'Rice', price: 12900, amount: 12900 },
      { qty: 2, name: 'Halo-Halo', price: 9500, amount: 19000 },
      { qty: 1, name: 'Family Pack', price: 125000, amount: 125000 }
    ]);
    expect(r.total).toBe(156900);
  });

  it('no total printed: from the items', () => {
    const r = readReceipt(['Kape Tayo', 'Iced latte 120.00', 'Cookie 50.00']);
    expect(r).toMatchObject({ store: 'Kape Tayo', subtotal: 17000, total: 17000 });
  });
});

describe('receipt details in the vault', () => {
  it('saved with the expense, encrypted, kept after unlock; damaged details cleaned', async () => {
    const { promises: fs } = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const { VaultService } = await import('../src/main/vault/vaultService');
    const { validateReceipt } = await import('../src/shared/receipt');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vaultlocks-receipt-'));
    try {
      const file = path.join(dir, 'vault', 'vault.vault');
      const v = new VaultService(file);
      await v.create('Receipt-Details-Test-Pass-2026!', null);
      const receipt = readReceipt(['JOLLIBEE', '1 Chickenjoy C1 129.00', '2 Jolly Spaghetti 70.00 140.00', 'TOTAL 269.00', 'CASH 500.00']);
      const t = await v.saveTransaction({ kind: 'expense', amount: 26900, category: 'food', note: 'Jollibee', date: '2026-10-25', receipt });
      expect(t.receipt?.items).toHaveLength(2);
      expect(await fs.readFile(file, 'utf8')).not.toContain('Chickenjoy');
      v.lock();
      await v.unlock('Receipt-Details-Test-Pass-2026!');
      expect(v.snapshot().transactions[0]!.receipt).toMatchObject({ store: 'Jollibee', total: 26900, payment: 'Cash', cash: 50000, change: 23100 });
      // Editing without details removes them.
      await v.saveTransaction({ id: t.id, kind: 'expense', amount: 26900, category: 'food', note: 'Jollibee', date: '2026-10-25' });
      expect(v.snapshot().transactions[0]!.receipt).toBeUndefined();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
    expect(validateReceipt({ items: [{ qty: -3, name: '  Sisig\n  rice ', price: 1.5, amount: 100 }], total: 'x' })).toMatchObject({ items: [{ qty: 1, name: 'Sisig rice', price: 0, amount: 100 }], total: 0 });
    expect(validateReceipt('nope')).toBeUndefined();
  });
});
