import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildEntryPages, splitAtImages } from '../story/_entryRenderer.js';

describe('buildEntryPages', () => {
  test('returns a single page numbered 1/1 for short content', () => {
    const pages = buildEntryPages('Once upon a time.', {
      turnNumber: 1, writerName: 'Alice', showAuthors: true, storyEntryId: 100,
    });
    assert.equal(pages.length, 1);
    assert.equal(pages[0].content, 'Once upon a time.');
    assert.equal(pages[0].turnNumber, 1);
    assert.equal(pages[0].writerName, 'Alice');
    assert.equal(pages[0].partIndex, 1);
    assert.equal(pages[0].partCount, 1);
    assert.equal(pages[0].isFirstChunk, true);
  });

  test('computes entryWordCount for the whole entry, matching on every chunk of a split entry', () => {
    const longContent = 'word '.repeat(2000).trim() + '\n\n' + 'more '.repeat(2000).trim();
    const pages = buildEntryPages(longContent, {
      turnNumber: 3, writerName: 'Cass', showAuthors: true, storyEntryId: 102,
    });
    assert.ok(pages.length > 1);
    const expectedCount = longContent.trim().split(/\s+/).filter(Boolean).length;
    for (const page of pages) {
      assert.equal(page.entryWordCount, expectedCount);
    }
  });

  test('hides the writer name when showAuthors is false', () => {
    const pages = buildEntryPages('Content here.', {
      turnNumber: 1, writerName: 'Alice', showAuthors: false, storyEntryId: 100,
    });
    assert.equal(pages[0].writerName, null);
  });

  test('splits long content into multiple numbered pages', () => {
    const longContent = 'a'.repeat(3000) + '\n\n' + 'b'.repeat(3000);
    const pages = buildEntryPages(longContent, {
      turnNumber: 2, writerName: 'Bob', showAuthors: true, storyEntryId: 101,
    });
    assert.ok(pages.length > 1);
    assert.equal(pages[0].partIndex, 1);
    assert.equal(pages[0].partCount, pages.length);
    assert.equal(pages[pages.length - 1].partIndex, pages.length);
  });

  test('only the first chunk carries editInfo', () => {
    const longContent = 'a'.repeat(3000) + '\n\n' + 'b'.repeat(3000);
    const editInfo = { editedByName: 'Alice', editedAt: new Date() };
    const pages = buildEntryPages(longContent, {
      turnNumber: 1, writerName: 'Alice', showAuthors: true, storyEntryId: 100, editInfo,
    });
    assert.equal(pages[0].editInfo, editInfo);
    assert.equal(pages[1].editInfo, null);
  });

  test('applies the scene-break divider before pagination', () => {
    const content = 'Before.\n[[break]]\nAfter.';
    const pages = buildEntryPages(content, {
      turnNumber: 1, writerName: 'Alice', showAuthors: true, storyEntryId: 100,
      sceneBreakDivider: '* * *',
    });
    assert.match(pages[0].content, /\* \* \*/);
    assert.doesNotMatch(pages[0].content, /\[\[break\]\]/);
  });

  test('puts each image on the page whose text contains it', () => {
    const url = 'https://cdn.discordapp.com/attachments/123/456/image.png';
    const content = 'a'.repeat(3000) + '\n\n' + 'b'.repeat(3000) + `\n\n[img](${url})`;
    const pages = buildEntryPages(content, {
      turnNumber: 1, writerName: 'Alice', showAuthors: true, storyEntryId: 100,
    });
    assert.ok(pages.length > 1);
    assert.deepEqual(pages[0].imageUrls, []);
    assert.deepEqual(pages[pages.length - 1].imageUrls, [url]);
  });
});

describe('splitAtImages', () => {
  test('splits content into ordered text and image segments', () => {
    const u1 = 'https://cdn.discordapp.com/attachments/1/2/cat.png?ex=1&is=2&hm=3';
    const u2 = 'https://cdn.discordapp.com/attachments/1/3/dog.png';
    const segs = splitAtImages(`Before.\n\n[a cat](${u1})\n${u2}\n\nAfter.`);
    assert.deepEqual(segs.map(s => s.type), ['text', 'image', 'image', 'text']);
    assert.equal(segs[1].url, u1);
    assert.equal(segs[1].caption, 'a cat');
    assert.equal(segs[2].url, u2);
    assert.equal(segs[2].caption, null);
    assert.equal(segs[3].text, 'After.');
  });

  test('returns one text segment when there are no images', () => {
    assert.deepEqual(splitAtImages('Just words.'), [{ type: 'text', text: 'Just words.' }]);
  });
});
