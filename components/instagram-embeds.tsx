'use client';

import { useState } from 'react';

/**
 * Instagram's official post embeds, loaded only after the visitor asks for them: embed.js is a third-party script
 * that sets cookies, so it never runs on page load. Post URLs are chosen by the shop in Settings — no Meta API
 * token is needed (the token-based auto-feed is the follow-up if a shop wants it).
 */
export function InstagramEmbeds({ posts, profileUrl }: { posts: string[]; profileUrl?: string }) {
  const [shown, setShown] = useState(false);
  const show = () => {
    setShown(true);
    if (!document.querySelector('script[data-instagram-embed]')) {
      const s = document.createElement('script');
      s.src = 'https://www.instagram.com/embed.js';
      s.async = true;
      s.dataset.instagramEmbed = '1';
      document.body.appendChild(s);
    } else {
      setTimeout(() => (window as unknown as { instgrm?: { Embeds: { process: () => void } } }).instgrm?.Embeds.process(), 50);
    }
  };
  if (!posts.length) return null;
  return (
    <div>
      {!shown ? (
        <div className="tile flex flex-col items-center gap-3 px-6 py-10 text-center">
          <p className="text-[17px] text-ink-2">Latest from Instagram</p>
          <p className="max-w-md text-[14px] text-ink-3">Showing these posts loads content from Instagram, which may set its own cookies.</p>
          <button type="button" onClick={show} className="inline-flex h-11 items-center rounded-full px-6 text-[15px]" style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}>
            Show Instagram posts
          </button>
          {profileUrl ? (
            <a href={profileUrl} target="_blank" rel="noopener" className="text-[14px] text-link hover:underline">
              or open the profile on Instagram
            </a>
          ) : null}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {posts.map((url) => (
            <blockquote key={url} className="instagram-media !m-0 !min-w-0 !max-w-none" data-instgrm-permalink={url} data-instgrm-version="14" style={{ background: '#fff', border: 0, borderRadius: 16, boxShadow: 'none', width: '100%' }}>
              <a href={url} target="_blank" rel="noopener">
                View this post on Instagram
              </a>
            </blockquote>
          ))}
        </div>
      )}
    </div>
  );
}
