import { Camera, Image as ImageIcon, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import jsQR from 'jsqr';
import { parseScan, parseScanQr, type ScanKind, type ScanResult } from '../../shared/scan';
import { ApiError, api, errorMessage, unwrap } from '../lib/api';
import { useToast } from './Toast';

/** A QR code in the picture (tried at two sizes; small codes need the bigger one). */
function findQr(img: HTMLImageElement): string | null {
  for (const max of [900, 1600]) {
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * scale));
    c.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const code = jsQR(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height, { inversionAttempts: 'attemptBoth' });
    c.width = c.height = 0;
    if (code?.data) return code.data;
  }
  return null;
}

/**
 * Upright JPEG, at most 1800 px on the long side (enough to read a card, small to
 * pass to the phone), and any QR code in it.
 */
async function photoForScan(file: File): Promise<{ jpeg: string; qr: string | null }> {
  // A data: URL (the app's content policy allows no blob: images), like attachments.
  const url = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('This photo could not be read.'));
    r.readAsDataURL(file);
  });
  {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('This photo could not be opened.'));
      i.src = url;
    });
    const scale = Math.min(1, 1800 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * scale));
    c.height = Math.max(1, Math.round(img.naturalHeight * scale));
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    const data = c.toDataURL('image/jpeg', 0.9);
    c.width = c.height = 0;
    let qr: string | null = null;
    try {
      qr = findQr(img);
    } catch {
      /* no QR code */
    }
    return { jpeg: data.slice(data.indexOf(',') + 1), qr };
  }
}

/**
 * Take (or choose) one photo and read it into a JPEG before the app resumes:
 * resuming deletes the camera's temporary file (suspendAutoLock).
 */
async function takePhoto(source: 'camera' | 'gallery'): Promise<{ jpeg: string; qr: string | null } | null> {
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
    return file ? await photoForScan(file) : null;
  } finally {
    api.app.suspendAutoLock(false);
  }
}

const WHAT: Record<ScanKind, string> = {
  cards: 'card',
  ids: 'ID',
  giftcards: 'gift card',
  loyalty: 'card',
  wifiNetwork: 'router sticker'
};

/**
 * "Scan with camera" for the item form (phones only). The photo is read on the
 * phone and thrown away; nothing is attached or uploaded.
 */
export function ScanButton({ kind, onResult }: { kind: ScanKind; onResult: (r: ScanResult) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const scan = async (source: 'camera' | 'gallery') => {
    if (busy) return;
    setBusy(true);
    try {
      const photo = await takePhoto(source);
      if (!photo) return;
      // An exact QR code (router sticker, gift card) wins over reading the printed text.
      const fromQr = parseScanQr(kind, photo.qr);
      const r = fromQr ?? parseScan(kind, await unwrap(api.app.recognizeText(photo.jpeg)));
      if (!Object.keys(r.fields).length) toast(`Nothing readable found. Try again with the ${WHAT[kind]} flat, in good light.`, 'error');
      else onResult(r);
    } catch (e) {
      toast(e instanceof Error && !(e instanceof ApiError) ? e.message : errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="scan-box span-2">
      <div className="scan-row">
        <button type="button" className="btn primary scan-main" onClick={() => void scan('camera')} disabled={busy}>
          {busy ? <span className="spinner" aria-hidden /> : <Camera size={16} aria-hidden />}
          {busy ? 'Reading…' : `Scan ${WHAT[kind]} with camera`}
        </button>
        <button type="button" className="btn" onClick={() => void scan('gallery')} disabled={busy} aria-label="Scan from a photo" title="From a photo">
          <ImageIcon size={16} aria-hidden />
        </button>
      </div>
      <span className="help-text row-flex" style={{ gap: 6 }}>
        <ShieldCheck size={13} aria-hidden /> Read on this phone. Nothing is uploaded, and the photo isn't kept.
      </span>
    </div>
  );
}
