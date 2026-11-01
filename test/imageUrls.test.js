import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  isSafeImageUrl,
  isDiscordAttachmentUrl,
  extractImageUrls,
  DISCORD_ATTACHMENT_RE,
} from '../story/_imageUrls.js';
import { collectImageUrls } from '../story/_exportImages.js';
import { splitAtImages } from '../story/_entryRenderer.js';

// A stored attachment link as it actually appears in entry content: signed, with the
// ?ex=&is=&hm= params Discord requires. Losing those breaks the image.
const CDN = 'https://cdn.discordapp.com/attachments/111/222/pic.png?ex=abc&is=def&hm=deadbeef';

describe('isSafeImageUrl', () => {
  test('accepts https image URLs on named hosts, Discord and external alike', () => {
    for (const url of [
      CDN,
      'https://i.imgur.com/a.png',
      'https://example.org/deep/path/art.jpeg',
      'https://example.org/a.jpg',
      'https://example.org/a.gif',
      'https://example.org/a.webp',
      'https://example.org/a.avif',
      'https://example.org/a.png?width=800',
      'https://EXAMPLE.com/UP.PNG',
    ]) assert.equal(isSafeImageUrl(url), true, `should accept: ${url}`);
  });

  test('rejects anything that is not https', () => {
    for (const url of [
      'http://example.com/a.png',
      'data:image/png;base64,AAAA',
      'file:///etc/passwd.png',
      'ftp://example.com/a.png',
    ]) assert.equal(isSafeImageUrl(url), false, `should reject: ${url}`);
  });

  test('rejects URLs that do not name an image file', () => {
    for (const url of [
      'https://example.com/a.txt',
      'https://example.com/a.html',
      'https://example.com/',
      'https://example.com/a.png.exe',
    ]) assert.equal(isSafeImageUrl(url), false, `should reject: ${url}`);
  });

  // The bot fetches these URLs itself, so a link is a request it will make on someone
  // else's behalf. Addresses inside our own network are refused on shape.
  test('rejects addresses that point back inside the network', () => {
    for (const url of [
      'https://127.0.0.1/a.png',
      'https://10.0.1.1/a.png',
      'https://192.168.1.1/a.png',
      'https://172.16.0.1/a.png',
      'https://169.254.169.254/latest/meta-data.png',
      'https://100.64.0.1/a.png',
      'https://0.0.0.0/a.png',
      'https://localhost/a.png',
      'https://foo.localhost/a.png',
      'https://[::1]/a.png',
      'https://[fe80::1]/a.png',
      'https://[fc00::1]/a.png',
    ]) assert.equal(isSafeImageUrl(url), false, `should reject: ${url}`);
  });

  test('rejects junk without throwing', () => {
    for (const url of [null, undefined, '', 'not a url', 42, {}]) {
      assert.equal(isSafeImageUrl(url), false);
    }
  });
});

describe('extractImageUrls', () => {
  // The regression this guards: a pattern that stops at the extension and drops the signed
  // query string leaves a URL that 404s.
  test('keeps the signed query string on a Discord attachment', () => {
    assert.deepEqual(extractImageUrls(`[a cat](${CDN})`), [CDN]);
    assert.deepEqual(extractImageUrls(`bare ${CDN} trailing`), [CDN]);
  });

  test('finds external images, which the old CDN-only pattern missed', () => {
    assert.deepEqual(
      extractImageUrls('[art](https://i.imgur.com/abc.jpeg) then https://example.org/x/y.webp end'),
      ['https://i.imgur.com/abc.jpeg', 'https://example.org/x/y.webp']
    );
  });

  test('returns images in the order they appear, not markdown-then-bare', () => {
    const content = `first https://example.org/one.png then [two](https://example.org/two.gif)`;
    assert.deepEqual(extractImageUrls(content), [
      'https://example.org/one.png',
      'https://example.org/two.gif',
    ]);
  });

  test('leaves out URLs that fail validation', () => {
    const content = 'ok https://example.org/a.png bad https://127.0.0.1/b.png worse http://example.org/c.png';
    assert.deepEqual(extractImageUrls(content), ['https://example.org/a.png']);
  });

  test('handles empty and image-free content', () => {
    assert.deepEqual(extractImageUrls(''), []);
    assert.deepEqual(extractImageUrls(null), []);
    assert.deepEqual(extractImageUrls('Just prose, and a link to https://example.org/page'), []);
  });
});

describe('the refresh scope stays Discord-only', () => {
  // Only a Discord CDN link has a signature to refresh. Sending an external URL to
  // Discord's refresh endpoint is the bug this separation exists to prevent.
  test('isDiscordAttachmentUrl distinguishes the two', () => {
    assert.equal(isDiscordAttachmentUrl(CDN), true);
    assert.equal(isDiscordAttachmentUrl('https://i.imgur.com/a.png'), false);
    assert.equal(isDiscordAttachmentUrl('https://cdn.discordapp.com/emojis/1.png'), false);
  });

  test('DISCORD_ATTACHMENT_RE matches only the attachment host and path', () => {
    const found = [...`${CDN} and https://i.imgur.com/a.png`.matchAll(DISCORD_ATTACHMENT_RE)].map(m => m[0]);
    assert.deepEqual(found, [CDN]);
  });

  test('collectImageUrls sorts images into refreshable and external', () => {
    const { attachmentUrls, externalUrls, emojiUrls } = collectImageUrls([
      `A photo [cat](${CDN}) and art https://i.imgur.com/abc.jpeg <:wave:111>`,
      `the same photo again ${CDN}`,
    ]);
    assert.deepEqual(attachmentUrls, [CDN], 'Discord links belong in the refresh set');
    assert.deepEqual(externalUrls, ['https://i.imgur.com/abc.jpeg'], 'external links must not be refreshed');
    assert.equal(emojiUrls.length, 1);
  });

  test('collectImageUrls still ignores empty texts', () => {
    const { attachmentUrls, externalUrls, emojiUrls } = collectImageUrls([null, '', undefined]);
    assert.deepEqual(attachmentUrls, []);
    assert.deepEqual(externalUrls, []);
    assert.deepEqual(emojiUrls, []);
  });
});

describe('splitAtImages', () => {
  test('splits at an external image, which previously stayed inline as text', () => {
    const segments = splitAtImages('Before.\n\n[art](https://i.imgur.com/a.png)\n\nAfter.');
    assert.deepEqual(segments.map(s => s.type), ['text', 'image', 'text']);
    assert.equal(segments[1].url, 'https://i.imgur.com/a.png');
    assert.equal(segments[1].caption, 'art');
  });

  // discord.js fetches the URL to upload it, so this is the gate that stops the bot being
  // pointed at an address of someone else's choosing.
  test('leaves an unsafe URL in the prose instead of fetching it', () => {
    const segments = splitAtImages('Before. [x](https://127.0.0.1/a.png) After.');
    assert.deepEqual(segments.map(s => s.type), ['text']);
    assert.ok(segments[0].text.includes('127.0.0.1'), 'the text should pass through untouched');
  });

  test('a safe image alongside an unsafe one splits only at the safe one', () => {
    const segments = splitAtImages(`[bad](http://example.org/b.png) [good](${CDN}) tail`);
    assert.deepEqual(segments.map(s => s.type), ['text', 'image', 'text']);
    assert.equal(segments[1].url, CDN);
  });
});
