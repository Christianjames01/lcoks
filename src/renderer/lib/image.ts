import { BANK_ICON_MAX_CHARS } from '../../shared/cards';
import { api } from './api';

/** A user-facing problem with the chosen image (safe to show as-is). */
export class IconImageError extends Error {}

/**
 * Let the user pick an image (e.g. a screenshot of their bank's logo) and turn
 * it into a small square icon (data: URL). Everything happens on the device; the
 * result is stored encrypted inside the vault.
 */
export async function pickIconImage(): Promise<string | null> {
  api.app.suspendAutoLock(true); // the photo picker puts the app in the background
  try {
    const file = await new Promise<File | null>((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/png,image/jpeg,image/webp,image/*';
      input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true });
      input.addEventListener('cancel', () => resolve(null), { once: true });
      input.click();
    });
    if (!file) return null;
    if (file.size > 15 * 1024 * 1024) throw new IconImageError('That image is too large.');
    return await toIcon(file);
  } finally {
    api.app.suspendAutoLock(false);
  }
}

async function toIcon(file: File, size = 96): Promise<string> {
  // Read as a data: URL (the Content-Security-Policy allows data: images, not blob:).
  const url = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new IconImageError('That image could not be read.'));
    r.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new IconImageError('That file is not an image.'));
    i.src = url;
  });
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  // "Contain" the whole logo on a white square so wide logos aren't cropped.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  const scale = Math.min(size / img.width, size / img.height) * 0.9;
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
  let data = canvas.toDataURL('image/png');
  if (data.length > BANK_ICON_MAX_CHARS) data = canvas.toDataURL('image/jpeg', 0.85);
  if (data.length > BANK_ICON_MAX_CHARS) throw new IconImageError('That image could not be made small enough.');
  return data;
}
