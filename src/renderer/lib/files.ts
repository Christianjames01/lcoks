import type { AttachmentInput } from '../../shared/types';
import { api } from './api';

/** A problem with a chosen file (safe to show to the user as-is). */
export class FileError extends Error {}

/** Same limit as the vault core (core/schema.ts MAX_ATTACHMENT_BYTES). */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
/** Above this size the user is told it may take a moment. */
export const LARGE_FILE_BYTES = 8 * 1024 * 1024;

export type PickSource = 'camera' | 'gallery' | 'file';

const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  gif: 'image/gif',
  pdf: 'application/pdf',
  txt: 'text/plain',
  csv: 'text/csv',
  md: 'text/markdown',
  json: 'application/json',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip'
};

export function mimeOf(file: { name: string; type?: string }): string {
  if (file.type && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(file.type)) return file.type.toLowerCase();
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return EXT_MIME[ext] ?? 'application/octet-stream';
}

export const isImage = (mime: string) => /^image\/(jpeg|png|webp|gif)$/.test(mime);
export const isPdf = (mime: string) => mime === 'application/pdf';
export const isText = (mime: string) => /^text\//.test(mime) || mime === 'application/json';

export function kindLabel(mime: string): string {
  if (isImage(mime)) return 'Image';
  if (isPdf(mime)) return 'PDF document';
  if (isText(mime)) return 'Text file';
  if (/word/.test(mime)) return 'Word document';
  if (/sheet|excel/.test(mime)) return 'Spreadsheet';
  if (/presentation|powerpoint/.test(mime)) return 'Presentation';
  return 'File';
}

/**
 * Open the camera, the photo gallery or the file picker. On Android the app's
 * background lock is paused while the picker is open, and any temporary camera
 * file is deleted as soon as we return.
 */
export async function pickFiles(source: PickSource): Promise<File[]> {
  api.app.suspendAutoLock(true);
  try {
    return await new Promise<File[]>((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      if (source === 'camera') {
        input.accept = 'image/*';
        input.setAttribute('capture', 'environment');
      } else if (source === 'gallery') {
        input.accept = 'image/*';
        input.multiple = true;
      } else {
        input.multiple = true;
      }
      input.addEventListener('change', () => resolve(Array.from(input.files ?? [])), { once: true });
      input.addEventListener('cancel', () => resolve([]), { once: true });
      input.click();
    });
  } finally {
    api.app.suspendAutoLock(false);
  }
}

function readDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new FileError('This file could not be read.'));
    r.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new FileError('This image could not be opened.'));
    i.src = src;
  });
}

/** Small JPEG preview for the attachment grid (the original is kept as-is). */
async function thumbnail(dataUrl: string): Promise<string | undefined> {
  try {
    const img = await loadImage(dataUrl);
    const scale = Math.min(1, 360 / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    for (const q of [0.72, 0.55, 0.4]) {
      const out = canvas.toDataURL('image/jpeg', q);
      if (out.length <= 78_000) return out;
    }
  } catch {
    /* no preview */
  }
  return undefined;
}

/** Read a picked file at original quality, plus a preview for images. */
export async function toAttachmentInput(file: File, extra: Partial<AttachmentInput> = {}): Promise<AttachmentInput> {
  if (file.size === 0) throw new FileError(`"${file.name}" is empty.`);
  if (file.size > MAX_FILE_BYTES) {
    throw new FileError(`"${file.name}" is ${(file.size / 1048576).toFixed(1)} MB. Files can be at most ${MAX_FILE_BYTES / 1048576} MB.`);
  }
  const mime = mimeOf(file);
  const dataUrl = await readDataUrl(file);
  const comma = dataUrl.indexOf(',');
  const data = comma >= 0 ? dataUrl.slice(comma + 1) : '';
  if (!data) throw new FileError(`"${file.name}" could not be read.`);
  const thumb = isImage(mime) ? await thumbnail(dataUrl) : undefined;
  return { name: file.name || 'Attachment', mime, data, ...(thumb ? { thumb } : {}), ...extra };
}

export const dataUrlOf = (mime: string, b64: string) => `data:${mime};base64,${b64}`;

/** Decode base64 text content (UTF-8). */
export function decodeText(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}
