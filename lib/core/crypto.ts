import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Envelope encryption (DECISIONS D-5). APP_MASTER_KEY (32 bytes, base64) wraps a random per-tenant data key.
 * Ciphertext format: "v1.<iv b64url>.<ciphertext b64url>.<tag b64url>".
 */

const b64u = (b: Buffer) => b.toString('base64url');
const unb64u = (s: string) => Buffer.from(s, 'base64url');

export function parseKey(base64: string): Buffer {
  const key = Buffer.from(base64, 'base64');
  if (key.length !== 32) throw new Error('Encryption key must be 32 bytes (base64)');
  return key;
}

export function generateDataKey(): Buffer {
  return randomBytes(32);
}

export function encrypt(plaintext: string | Buffer, key: Buffer, aad?: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  if (aad) cipher.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return ['v1', b64u(iv), b64u(ct), b64u(cipher.getAuthTag())].join('.');
}

export function decryptToBuffer(token: string, key: Buffer, aad?: string): Buffer {
  const [v, iv, ct, tag] = token.split('.');
  if (v !== 'v1' || !iv || !ct || !tag) throw new Error('Unsupported ciphertext');
  const decipher = createDecipheriv('aes-256-gcm', key, unb64u(iv));
  if (aad) decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(unb64u(tag));
  return Buffer.concat([decipher.update(unb64u(ct)), decipher.final()]);
}

export function decrypt(token: string, key: Buffer, aad?: string): string {
  return decryptToBuffer(token, key, aad).toString('utf8');
}

export function wrapDataKey(dataKey: Buffer, masterKey: Buffer, tenantId: string): string {
  return encrypt(dataKey, masterKey, `tenant-key:${tenantId}`);
}

export function unwrapDataKey(wrapped: string, masterKey: Buffer, tenantId: string): Buffer {
  return decryptToBuffer(wrapped, masterKey, `tenant-key:${tenantId}`);
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Human-friendly code without ambiguous characters (0/O, 1/I/L). */
export function randomCode(length = 8): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(length);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

export function randomDigits(length = 6): string {
  let out = '';
  while (out.length < length) {
    const b = randomBytes(1)[0];
    if (b < 250) out += String(b % 10);
  }
  return out;
}

export function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

export function hmacSha256(key: string | Buffer, data: string | Buffer): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

export function safeEqual(a: string | Buffer, b: string | Buffer): boolean {
  const ab = Buffer.isBuffer(a) ? a : Buffer.from(a);
  const bb = Buffer.isBuffer(b) ? b : Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
