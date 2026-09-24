import { getRequestConfig } from 'next-intl/server';

// English only for now. Add messages/sw.json and a locale switch to enable Swahili (Phase 3).
export default getRequestConfig(async () => ({
  locale: 'en',
  timeZone: 'Africa/Nairobi',
  messages: (await import('../messages/en.json')).default,
}));
