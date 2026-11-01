import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleEntryContent } from '../story/_writeFinalize.js';
import { stepImagePage } from '../story/_entryRenderer.js';

const msg = (id, content, attachments = []) => ({
  id, content,
  attachments: new Map(attachments.map((a, i) => [String(i), { contentType: 'image/png', ...a }])),
});

describe('assembleEntryContent', () => {
  const messages = new Map([
    ['1', msg('1', 'Once upon a time.')],
    ['2', msg('2', 'A cat', [{ name: 'cat.png', url: 'https://cdn.discordapp.com/attachments/1/2/cat.png' }])],
    ['3', msg('3', '', [{ name: 'dog.png', url: 'https://cdn.discordapp.com/attachments/1/3/dog.png' }])],
  ]);
  const textFor = m => m.content || null;

  test('joins text posts and image links in posting order', async () => {
    const { content, imageCount } = await assembleEntryContent(messages, textFor, att => att.url);
    assert.equal(content,
      'Once upon a time.\n\n[A cat](https://cdn.discordapp.com/attachments/1/2/cat.png)\n\n[dog.png](https://cdn.discordapp.com/attachments/1/3/dog.png)');
    assert.equal(imageCount, 2);
  });

  test('leaves out images the linker returns null for', async () => {
    const { content, imageCount } = await assembleEntryContent(messages, textFor, () => null);
    assert.equal(content, 'Once upon a time.');
    assert.equal(imageCount, 0);
  });

  test('ignores non-image attachments', async () => {
    const m = new Map([['1', msg('1', 'Text', [{ name: 'a.txt', url: 'x', contentType: 'text/plain' }])]]);
    const { content } = await assembleEntryContent(m, textFor, att => att.url);
    assert.equal(content, 'Text');
  });
});

describe('stepImagePage', () => {
  const urls = Array.from({ length: 9 }, (_, i) => `u${i}`); // 3 image pages of 4
  test('steps forward and back within range', () => {
    assert.equal(stepImagePage(0, urls, 1), 1);
    assert.equal(stepImagePage(2, urls, 1), 2);
    assert.equal(stepImagePage(0, urls, -1), 0);
  });
  test('stays at 0 when the page has no images', () => {
    assert.equal(stepImagePage(0, [], 1), 0);
  });
});
