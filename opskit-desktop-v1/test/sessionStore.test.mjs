import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { listMemoryBackedSessions } from '../src/main/services/memoryManager.mjs';
import {
  appendChatExchange,
  createSessionRecord,
  listSessionRecords,
  loadSessionRecord,
  providerHistoryFromMessages,
  saveSessionRecord,
  toSessionSummary
} from '../src/main/services/sessionStore.mjs';

test('session records persist, list newest first, and reopen with messages', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'opskit-sessions-'));
  const first = createSessionRecord({
    name: 'Older Session',
    slug: 'older-session',
    provider: 'cohere',
    now: new Date('2026-06-16T10:00:00Z')
  });
  first.updatedAt = '2026-06-16T10:00:00.000Z';

  let second = createSessionRecord({
    name: 'Newer Session',
    slug: 'newer-session',
    provider: 'claude',
    memoryFiles: [{ title: '2026-06-17_newer-session.txt', path: '/tmp/memory.txt', text: 'do not persist this text' }],
    now: new Date('2026-06-17T10:00:00Z')
  });
  second = appendChatExchange(second, {
    userDisplayContent: 'Hello with file',
    userProviderContent: 'Hello with extracted file text',
    assistantContent: 'Hi back',
    receipt: { saved: true, bytes: 42 },
    extractedFiles: [{ name: 'brief.txt', characters: 10 }],
    now: new Date('2026-06-17T10:01:00Z')
  });

  await saveSessionRecord(dir, first);
  await saveSessionRecord(dir, second);

  const listed = await listSessionRecords(dir);
  assert.equal(listed.length, 2);
  assert.equal(listed[0].slug, 'newer-session');
  assert.equal(listed[0].historyTurns, 1);
  assert.match(listed[0].lastMessagePreview, /Hi back/);

  const reopened = await loadSessionRecord(dir, second.id);
  assert.equal(reopened.messages.length, 2);
  assert.equal(reopened.messages[0].attachments[0].name, 'brief.txt');

  const savedFile = await fs.readFile(path.join(dir, `${second.id}.json`), 'utf8');
  assert.doesNotMatch(savedFile, /do not persist this text/);
});

test('providerHistoryFromMessages uses providerContent for user turns', () => {
  const summary = toSessionSummary({
    id: 'abc',
    slug: 'demo',
    displayName: 'Demo',
    startedAt: '2026-06-17T00:00:00.000Z',
    updatedAt: '2026-06-17T00:00:00.000Z',
    messages: [
      { role: 'system', content: 'local notice' },
      { role: 'user', content: 'short display', providerContent: 'full context payload' },
      { role: 'assistant', content: 'answer' }
    ]
  }, { includeMessages: true });

  const history = providerHistoryFromMessages(summary.messages);
  assert.deepEqual(history, [
    { role: 'user', content: 'full context payload' },
    { role: 'assistant', content: 'answer' }
  ]);
});

test('listMemoryBackedSessions surfaces receipt-only sessions', async () => {
  const memoryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'opskit-memory-'));
  await fs.writeFile(path.join(memoryDir, '2026-06-16_old-project.txt'), 'old', 'utf8');
  await fs.writeFile(path.join(memoryDir, '2026-06-17_old-project.txt'), 'new', 'utf8');
  await fs.writeFile(path.join(memoryDir, '2026-06-17_known-project.txt'), 'known', 'utf8');

  const sessions = await listMemoryBackedSessions({ memoryDir, excludeSlugs: ['known-project'] });
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].id, 'memory_old-project');
  assert.equal(sessions[0].fileCount, 2);
  assert.equal(sessions[0].source, 'memory');
  assert.equal(sessions[0].updatedAt, '2026-06-17T00:00:00.000Z');
});
