/**
 * A `?next=` value we may redirect to: a path on this same origin, nothing else. Rejects `//host` and `/\host` (browsers
 * read both as another origin), and any whitespace or control character (browsers strip those, which can turn
 * `/\t/host` into `//host`).
 */
export function isSafeRedirectPath(next: string | null | undefined): next is string {
  return !!next && /^\/(?![/\\])[^\s\\\u0000-\u001f\u007f]*$/.test(next);
}

export function safeRedirectPath(next: string | null | undefined, fallback: string): string {
  return isSafeRedirectPath(next) ? next : fallback;
}
