import test from 'node:test';
import assert from 'node:assert/strict';
import { documentsAsCohereDocuments, documentsAsSystemAppendix, normalizeHistory } from '../src/main/services/contextAssembler.mjs';

test('documentsAsCohereDocuments preserves document order with quick setup first', () => {
  const docs = documentsAsCohereDocuments([
    { title: 'OpsKit_Quick_Setup.txt', source: '/a', layer: 1, text: 'grammar' },
    { title: '2026-06-17_chat.txt', source: '/b', layer: 2, text: 'memory' }
  ]);

  assert.equal(docs.length, 2);
  assert.match(docs[0], /^# OpsKit_Quick_Setup\.txt/);
  assert.match(docs[0], /Layer: 1/);
  assert.match(docs[1], /Layer: 2/);
});

test('documentsAsSystemAppendix wraps documents for non-native providers', () => {
  const appendix = documentsAsSystemAppendix([{ title: 'A&B.txt', source: '<local>', layer: 1, text: 'body' }]);
  assert.match(appendix, /opskit_document/);
  assert.match(appendix, /A&amp;B\.txt/);
  assert.match(appendix, /&lt;local&gt;/);
  assert.match(appendix, /body/);
});

test('normalizeHistory keeps only chat roles', () => {
  const history = normalizeHistory([
    { role: 'user', content: 'hello' },
    { role: 'system', content: 'ignore' },
    { role: 'assistant', content: 123 }
  ]);
  assert.deepEqual(history, [
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: '123' }
  ]);
});
