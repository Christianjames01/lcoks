import type { VaultApi } from '../../shared/api';
import type { Result } from '../../shared/types';

declare global {
  interface Window {
    vault: VaultApi;
  }
}

export const api: VaultApi = window.vault;

/** Error thrown in the renderer for a failed IPC call; message is already user-safe. */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
  }
  /** Field name for VALIDATION:<field> errors, so forms can show inline errors. */
  get field(): string | null {
    return this.code.startsWith('VALIDATION:') ? this.code.slice('VALIDATION:'.length) : null;
  }
}

export async function unwrap<T>(p: Promise<Result<T>>): Promise<T> {
  const r = await p;
  if (!r || typeof r !== 'object') throw new ApiError('INTERNAL', 'Something went wrong.');
  if (!r.ok) throw new ApiError(r.code, r.message);
  return r.value;
}

export function errorMessage(e: unknown): string {
  return e instanceof ApiError ? e.message : 'Something went wrong.';
}
