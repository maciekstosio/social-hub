// Allowlist rules per platform: what stays in the hub, what opens in the locked
// viewer, what goes to the browser, and what is blocked.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import platformsModule from '../dist/main/platforms.js';

const { createPlatforms, unwrapLinkShim, extractUrl, routeLink } = platformsModule;
const config = {
  x: { listId: '123', friends: ['@Alice'] },
  instagram: { viewerUseEmbed: false },
  extraAllow: { instagram: [], facebook: [], x: [] },
};
const [ig, fb, x] = createPlatforms(config);
const kind = (platform, url) => platform.classify(url).kind;
const platforms = [ig, fb, x];
const route = (text) => {
  const r = routeLink(platforms, text);
  return { kind: r.kind, platform: r.platform?.id ?? null, url: r.url };
};

test('Instagram: inbox and login only, shared items in the viewer', () => {
  assert.equal(kind(ig, 'https://www.instagram.com/direct/t/1234/'), 'allow');
  assert.equal(kind(ig, 'https://www.instagram.com/accounts/login/?next=%2Fdirect%2Finbox%2F'), 'allow');
  for (const url of ['https://www.instagram.com/', 'https://www.instagram.com/explore/', 'https://www.instagram.com/reels/', 'https://www.instagram.com/someuser/']) {
    assert.equal(kind(ig, url), 'block', url);
  }
  assert.deepEqual(ig.classify('https://www.instagram.com/reels/ABC/'), { kind: 'viewer', url: 'https://www.instagram.com/reel/ABC/' });
  assert.deepEqual(ig.classify('https://www.instagram.com/someuser/p/XYZ/'), { kind: 'viewer', url: 'https://www.instagram.com/p/XYZ/' });
  assert.equal(kind(ig, 'https://www.instagram.com/stories/bob/31337/'), 'viewer');
  assert.equal(kind(ig, 'https://example.com/article'), 'external');
  assert.equal(kind(ig, 'https://www.facebook.com/'), 'block');
});

test('Instagram: the viewer stays locked to one item', () => {
  assert.equal(ig.itemKey('https://www.instagram.com/reel/ABC/'), ig.itemKey('https://www.instagram.com/u/reel/ABC/embed/'));
  assert.notEqual(ig.itemKey('https://www.instagram.com/reel/ABC/'), ig.itemKey('https://www.instagram.com/reel/DEF/'));
});

test('Facebook: messages, login and calls only', () => {
  assert.equal(kind(fb, 'https://www.facebook.com/messages/e2ee/t/99/'), 'allow');
  assert.equal(kind(fb, 'https://www.facebook.com/two_step_verification/authentication/'), 'allow');
  assert.equal(kind(fb, 'https://www.facebook.com/groupcall/ROOM:123/'), 'call');
  for (const url of ['https://www.facebook.com/', 'https://www.facebook.com/marketplace/', 'https://www.facebook.com/groups/']) {
    assert.equal(kind(fb, url), 'block', url);
  }
  for (const url of ['https://www.facebook.com/watch/?v=5', 'https://www.facebook.com/reel/777', 'https://www.facebook.com/bob/posts/pfbid0abc', 'https://www.facebook.com/share/p/xyz/']) {
    assert.equal(kind(fb, url), 'viewer', url);
  }
});

test('X: friends list, DMs, login and friends\' posts only', () => {
  for (const url of ['https://x.com/i/lists/123', 'https://x.com/messages/1-2', 'https://x.com/i/chat/abc', 'https://x.com/alice/status/42', 'https://x.com/i/jf/onboarding/web?mode=login']) {
    assert.equal(kind(x, url), 'allow', url);
  }
  for (const url of ['https://x.com/home', 'https://x.com/explore', 'https://x.com/i/lists/1234']) {
    assert.equal(kind(x, url), 'block', url);
  }
  assert.equal(kind(x, 'https://x.com/stranger/status/43'), 'viewer');
  assert.equal(kind(x, 'https://t.co/abc'), 'external');
  assert.equal(x.home, 'https://x.com/i/lists/123');
});

test('X: list editor', () => {
  for (const url of ['https://x.com/i/lists/123/info', 'https://x.com/i/lists/123/members', 'https://x.com/i/lists/123/members/suggested']) {
    assert.equal(kind(x, url), 'allow', url);
  }
  for (const url of ['https://x.com/i/lists/123/followers', 'https://x.com/i/lists/1234/info']) {
    assert.equal(kind(x, url), 'block', url);
  }
});

test('X: notifications, compose and own profile', () => {
  for (const url of ['https://x.com/notifications', 'https://x.com/notifications/mentions', 'https://x.com/compose/post']) {
    assert.equal(kind(x, url), 'allow', url);
  }
  assert.equal(kind(x, 'https://x.com/me'), 'block');
  assert.equal(kind(x, 'https://x.com/me/status/7'), 'viewer');
  x.setSelf('Me');
  for (const url of ['https://x.com/me', 'https://x.com/Me/with_replies', 'https://x.com/me/media', 'https://x.com/me/status/7']) {
    assert.equal(kind(x, url), 'allow', url);
  }
  for (const url of ['https://x.com/me/followers', 'https://x.com/me/following', 'https://x.com/stranger']) {
    assert.equal(kind(x, url), 'block', url);
  }
});

test('Meta link shims are unwrapped', () => {
  assert.equal(unwrapLinkShim('https://l.instagram.com/?u=https%3A%2F%2Fexample.com%2Fa&e=x'), 'https://example.com/a');
  assert.equal(unwrapLinkShim('https://l.facebook.com/l.php?u=https%3A%2F%2Fexample.com%2Fb'), 'https://example.com/b');
});

test('Pasted links: the URL is found in surrounding text', () => {
  assert.equal(extractUrl('check this out https://x.com/bob/status/42?s=20 so good'), 'https://x.com/bob/status/42?s=20');
  assert.equal(extractUrl('  instagram.com/reel/ABC/  '), 'https://instagram.com/reel/ABC/');
  assert.equal(extractUrl('no link here'), null);
  assert.equal(extractUrl(''), null);
});

test('Pasted links go through the allowlist', () => {
  assert.deepEqual(route('https://www.instagram.com/reel/ABC/?igsh=xyz'), { kind: 'viewer', platform: 'instagram', url: 'https://www.instagram.com/reel/ABC/' });
  assert.deepEqual(route('https://x.com/bob/status/42'), { kind: 'viewer', platform: 'x', url: 'https://x.com/bob/status/42' });
  assert.deepEqual(route('https://twitter.com/alice/status/42'), { kind: 'allow', platform: 'x', url: 'https://twitter.com/alice/status/42' });
  assert.deepEqual(route('https://www.facebook.com/share/r/abc/'), { kind: 'viewer', platform: 'facebook', url: 'https://www.facebook.com/share/r/abc/' });
  assert.deepEqual(route('https://l.instagram.com/?u=https%3A%2F%2Fexample.com%2Fa'), { kind: 'external', platform: null, url: 'https://example.com/a' });
  assert.deepEqual(route('https://www.youtube.com/watch?v=1'), { kind: 'external', platform: null, url: 'https://www.youtube.com/watch?v=1' });
  assert.deepEqual(route('https://www.instagram.com/someuser/'), { kind: 'block', platform: 'instagram', url: 'https://www.instagram.com/someuser/' });
  assert.deepEqual(route('https://x.com/explore'), { kind: 'block', platform: 'x', url: 'https://x.com/explore' });
  assert.deepEqual(route('https://www.threads.net/@bob'), { kind: 'block', platform: null, url: 'https://www.threads.net/@bob' });
  assert.equal(route('hello').kind, 'none');
});
