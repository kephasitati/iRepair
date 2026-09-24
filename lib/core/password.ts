import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';

function scrypt(password: string, salt: Buffer, len: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => scryptCb(password, salt, len, opts, (err, key) => (err ? reject(err) : resolve(key))));
}

const N = 2 ** 15;
const R = 8;
const P = 1;
const LEN = 32;
const MAXMEM = 64 * 1024 * 1024;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, LEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const [alg, n, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: MAXMEM });
  return timingSafeEqual(actual, expected);
}

const COMMON = ['password', 'qwerty', '123456', 'letmein', 'welcome', 'admin', 'iloveyou', 'nairobi', 'kenya'];

/** Staff passwords: at least 12 chars with upper, lower and a digit, not built on a common word. */
export function passwordProblems(password: string): string[] {
  const problems: string[] = [];
  if (password.length < 12) problems.push('min_length');
  if (!/[a-z]/.test(password)) problems.push('lowercase');
  if (!/[A-Z]/.test(password)) problems.push('uppercase');
  if (!/\d/.test(password)) problems.push('digit');
  if (COMMON.some((w) => password.toLowerCase().includes(w))) problems.push('common');
  return problems;
}
