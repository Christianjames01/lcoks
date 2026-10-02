import { api } from './api';

/** A problem with the chosen photo (safe to show to the user as-is). */
export class PhotoError extends Error {}

const CARD_RATIO = 1.586; // ID-1 size: bank cards and most IDs
const MAX_CHARS = 380_000; // stays under the vault's 400 KB per-photo limit

/**
 * Take a photo with the camera (`camera`) or pick one (`gallery`) of a card,
 * crop it to card shape around the centre, shrink it, and return a JPEG data URL.
 * Processing happens on the device; the result is stored encrypted in the vault.
 * On Android the temporary camera file is deleted right after (suspendAutoLock).
 */
export async function pickCardPhoto(source: 'camera' | 'gallery'): Promise<string | null> {
  api.app.suspendAutoLock(true);
  try {
    const file = await new Promise<File | null>((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      if (source === 'camera') input.setAttribute('capture', 'environment');
      input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true });
      input.addEventListener('cancel', () => resolve(null), { once: true });
      input.click();
    });
    if (!file) return null;
    if (file.size > 40 * 1024 * 1024) throw new PhotoError('That photo is too large.');
    return await toCardImage(file);
  } finally {
    api.app.suspendAutoLock(false);
  }
}

async function toCardImage(file: File): Promise<string> {
  // data: URL (the Content-Security-Policy allows data: images, not blob:).
  const src = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new PhotoError('That photo could not be read.'));
    r.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new PhotoError('That file is not a photo.'));
    i.src = src;
  });

  // Phones usually shoot portrait: if the card was photographed upright, the
  // card is landscape inside a portrait frame — crop a card-shaped area from the centre.
  let sw = img.width;
  let sh = img.height;
  if (sw / sh > CARD_RATIO) sw = Math.round(sh * CARD_RATIO);
  else sh = Math.round(sw / CARD_RATIO);
  const sx = Math.round((img.width - sw) / 2);
  const sy = Math.round((img.height - sh) / 2);

  for (const [width, quality] of [
    [1000, 0.78],
    [860, 0.72],
    [720, 0.66],
    [600, 0.6]
  ] as const) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(width, sw);
    canvas.height = Math.round(canvas.width / CARD_RATIO);
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    const out = canvas.toDataURL('image/jpeg', quality);
    if (out.length <= MAX_CHARS) return out;
  }
  throw new PhotoError('That photo could not be made small enough.');
}
