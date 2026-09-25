/**
 * `server-only` throws when imported outside the React Server environment. Node entry points (worker, seed)
 * share server modules with Next.js, so they import this file first to stub it out.
 *
 * It also loads `.env` here, without a dependency: unlike `next dev`, a plain `tsx` entry point (the worker)
 * never populates `process.env` on its own, so `lib/env.ts`'s validation used to fail immediately with every
 * secret reported as missing. This runs before any other import, so it's set before `lib/env.ts` first reads it.
 */
import { existsSync, readFileSync } from 'node:fs';
import Module from 'node:module';
import path from 'node:path';

const envFile = path.join(__dirname, '..', '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/\s+#.*$/, '');
  }
}

const req = Module.createRequire(__filename);
const resolved = req.resolve('server-only');
const stub = new Module(resolved);
stub.filename = resolved;
stub.loaded = true;
stub.exports = {};
req.cache[resolved] = stub;
