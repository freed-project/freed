import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { expect, it } from 'vitest';

const script = readFileSync(resolve(process.cwd(), 'src-tauri/src/fb-extract.js'), 'utf8');
function inspect(label: string, extra = '', attributes = '') {
  const dom = new JSDOM(`<div role="main"><div role="article" aria-label="${label}" ${attributes}>
    <h3><a href="https://www.facebook.com/synthetic.author">Synthetic Author</a></h3>
    <a href="https://www.facebook.com/synthetic.author/posts/123456789">1 h</a>
    ${extra}<div dir="auto">Synthetic caption with enough text.</div></div></div>`,
    { url: 'https://www.facebook.com/', runScripts: 'outside-only' });
  dom.window.document.cookie = 'c_user=123';
  let payload: { posts: unknown[]; rejected: { advertising: number; deferredAdvertising: number }; error?: string } | undefined;
  Object.defineProperty(dom.window, '__TAURI__', { value: { event: { emit(name: string, data: typeof payload) {
    if (name === 'fb-feed-data') payload = data;
  } } } });
  dom.window.eval(script);
  dom.window.close();
  expect(payload).toBeDefined();
  expect(payload!.error).toBeUndefined();
  return payload!;
}
it('excludes an exact Sponsored disclosure on the placement root', () => {
  const result = inspect('Sponsored');
  expect(result.posts).toEqual([]);
  expect(result.rejected.advertising).toBe(1);
});
it('defers an incomplete root disclosure', () => {
  const result = inspect('Spons');
  expect(result.posts).toEqual([]);
  expect(result.rejected.deferredAdvertising).toBe(1);
});
it('retains ordinary accessible labels and body prose', () => {
  expect(inspect('Post', '<div dir="auto">How Sponsored posts work is a topic we discussed.</div>').posts).toHaveLength(1);
});
it('keeps disclosure inspection bounded after adding the root', () => {
  const result = inspect('Post', '<span>x</span>'.repeat(100));
  expect(result.posts).toEqual([]);
  expect(result.rejected.deferredAdvertising).toBe(1);
});
it.each(['Post by Sponsored Volunteers', 'Sponsored by local volunteers'])('retains longer root accessibility prose: %s', label => {
  expect(inspect(label).posts).toHaveLength(1);
});
it('does not promote a root reference to body prose into placement evidence', () => {
  expect(inspect('Post', '<div id="caption" dir="auto">Sponsored posts were discussed.</div>', 'aria-labelledby="caption"').posts).toHaveLength(1);
});
it('keeps partial root disclosure deferred despite a reference to body prose', () => {
  const result = inspect('Spons', '<div id="caption" dir="auto">Sponsored posts were discussed.</div>', 'aria-labelledby="caption"');
  expect(result.posts).toEqual([]);
  expect(result.rejected.deferredAdvertising).toBe(1);
  expect(result.rejected.advertising).toBe(0);
});
