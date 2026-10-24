import { idbGetKV, idbSetKV } from '@/persist/idb';

const MASTER_KEY = 'crypto.master';

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function getMasterKey(): Promise<CryptoKey> {
  const stored = await idbGetKV<number[]>(MASTER_KEY);
  if (stored?.length) {
    return crypto.subtle.importKey('raw', new Uint8Array(stored), 'AES-GCM', false, ['encrypt', 'decrypt']);
  }
  const raw = crypto.getRandomValues(new Uint8Array(32));
  await idbSetKV(MASTER_KEY, Array.from(raw));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/**
 * API Key 本地加密。
 * 密钥材料存在 IndexedDB（不可导出 CryptoKey），密文存 localStorage。
 * 这只能保证「磁盘上不是明文」，无法防御同源 XSS —— 已在设置面板明确说明。
 */
export async function encryptString(plain: string): Promise<string> {
  const key = await getMasterKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(plain);
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as unknown as BufferSource }, key, data as unknown as BufferSource);
  return `v1:${toB64(iv)}:${toB64(new Uint8Array(cipher))}`;
}

export async function decryptString(payload: string): Promise<string> {
  if (!payload.startsWith('v1:')) return '';
  const [, ivB64, ctB64] = payload.split(':');
  if (!ivB64 || !ctB64) return '';
  try {
    const key = await getMasterKey();
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64(ivB64) as unknown as BufferSource },
      key,
      fromB64(ctB64) as unknown as BufferSource,
    );
    return new TextDecoder().decode(plain);
  } catch {
    return '';
  }
}
