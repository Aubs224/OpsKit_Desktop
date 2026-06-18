import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  appendReceiptIfPresent,
  extractReceiptBlock,
  selectMemoryFiles,
  slugifySessionName
} from '../src/main/services/memoryManager.mjs';

test('slugifySessionName converts names to kebab-case', () => {
  assert.equal(slugifySessionName('Cohere Desktop App'), 'cohere-desktop-app');
  assert.equal(slugifySessionName('  Weird___Name!! '), 'weird-name');
  assert.equal(slugifySessionName(''), 'untitled-session');
});

test('selectMemoryFiles matches slug and sorts newest first with limit', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'opskit-memory-'));
  await fs.writeFile(path.join(dir, '2026-06-15_cohere-desktop-app.txt'), 'old', 'utf8');
  await fs.writeFile(path.join(dir, '2026-06-17_cohere-desktop-app.txt'), 'new', 'utf8');
  await fs.writeFile(path.join(dir, '2026-06-16_other.txt'), 'other', 'utf8');

  const files = await selectMemoryFiles({ memoryDir: dir, sessionSlug: 'cohere-desktop-app', limit: 1 });
  assert.equal(files.length, 1);
  assert.equal(files[0].title, '2026-06-17_cohere-desktop-app.txt');
  assert.equal(files[0].text, 'new');
});

test('appendReceiptIfPresent appends the receipt block and updates index', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'opskit-memory-'));
  const response = `Useful answer\n\n---\n[::📋::]{ops_kit_receipt::turn:1::2026-06-17}\nHABITS:\n🧰 stepwise_build :: w:0.40 | trigger:user | ctx:build | streak:1 | linked:[goal_focus]\n{📋💾::receipt::turn:1::saved::2026-06-17}\n---`;
  const result = await appendReceiptIfPresent({
    memoryDir: dir,
    sessionSlug: 'cohere-desktop-app',
    responseText: response,
    date: new Date('2026-06-17T12:00:00Z')
  });

  assert.equal(result.saved, true);
  const saved = await fs.readFile(result.path, 'utf8');
  assert.match(saved, /ops_kit_receipt::turn:1/);
  assert.doesNotMatch(saved, /Useful answer/);
  const index = await fs.readFile(path.join(dir, '_index.txt'), 'utf8');
  assert.match(index, /cohere-desktop-app/);
});

test('extractReceiptBlock falls back to glyph tail when dividers are absent', () => {
  const block = extractReceiptBlock('hello [::📋::]{ops_kit_receipt::turn:1::2026-06-17}\nend');
  assert.match(block, /ops_kit_receipt/);
});
