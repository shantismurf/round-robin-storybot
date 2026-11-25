import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countWords } from '../story/_wordCount.js';

test('countWords: plain prose', () => {
  assert.equal(countWords('The quick brown fox.'), 4);
});

test('countWords: empty, whitespace and null are zero', () => {
  assert.equal(countWords(''), 0);
  assert.equal(countWords('   \n  '), 0);
  assert.equal(countWords(null), 0);
});

test('countWords: bare punctuation is not a word', () => {
  assert.equal(countWords('She paused — then left.\n\n* * *\n\nMorning came ~'), 6);
});

test('countWords: punctuation between words splits them, like AO3', () => {
  assert.equal(countWords('one—two'), 2);
  assert.equal(countWords('well...okay'), 2);
  assert.equal(countWords('one--two'), 2);
});

test('countWords: hyphens and apostrophes join, like AO3', () => {
  assert.equal(countWords("one-word one's it’s"), 3);
});

test('countWords: a number with a comma is two words, like AO3', () => {
  assert.equal(countWords('1,200 miles'), 3);
});

test('countWords: Chinese, Japanese and Thai count per character', () => {
  assert.equal(countWords('你好世界'), 4);
  assert.equal(countWords('こんにちは'), 5);
  assert.equal(countWords('Hello 世界'), 3);
});

test('countWords: scene-break marker lines are skipped', () => {
  assert.equal(countWords('One two.\n[[break]]\nThree four.'), 4);
});

test('countWords: tooltip counts both halves', () => {
  assert.equal(countWords('He said [[mae govannen|well met]] softly.'), 7);
});

test('countWords: image URLs removed, captions kept', () => {
  const text = 'Look here https://cdn.example.com/a/b.png and [the map](https://cdn.example.com/map.jpg) too.';
  // Look, here, and, the, map, too
  assert.equal(countWords(text), 6);
});
