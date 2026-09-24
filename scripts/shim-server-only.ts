/**
 * `server-only` throws when imported outside the React Server environment. Node entry points (worker, seed)
 * share server modules with Next.js, so they import this file first to stub it out.
 */
import Module from 'node:module';

const req = Module.createRequire(__filename);
const resolved = req.resolve('server-only');
const stub = new Module(resolved);
stub.filename = resolved;
stub.loaded = true;
stub.exports = {};
req.cache[resolved] = stub;
