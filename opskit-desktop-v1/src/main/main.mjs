import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import { getProviderAdapter } from './adapters/index.mjs';
import { runCohereBootProbe } from './adapters/cohereAdapter.mjs';
import { assembleContext } from './services/contextAssembler.mjs';
import { extractFiles, prependAttachmentsToMessage } from './services/fileExtractor.mjs';
import {
  appendReceiptIfPresent,
  ensureMemoryDirectory,
  listMemoryBackedSessions,
  selectMemoryFiles,
  sessionFilePath,
  slugifySessionName
} from './services/memoryManager.mjs';
import {
  addTranscriptMessage,
  compareSessionsNewestFirst,
  createSessionRecord,
  defaultSessionHistoryDir,
  ensureSessionHistoryDirectory,
  listSessionRecords,
  loadSessionRecord,
  saveSessionRecord,
  sessionListItem,
  toSessionSummary
} from './services/sessionStore.mjs';
import { createSettingsStore, providerModel, readSettings, saveSettings } from './services/settingsStore.mjs';
import { deleteApiKey, getApiKey, getApiKeyPresence, setApiKey } from './services/keyStore.mjs';
import { PROVIDERS } from '../shared/defaults.mjs';
import { isSupportedAttachment } from '../shared/validators.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow;
let settingsStore;
let sessionHistoryDir;
let currentSession;

function rendererPath(...parts) {
  return path.join(__dirname, '..', 'renderer', ...parts);
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 900,
    minWidth: 980,
    minHeight: 700,
    backgroundColor: '#0f1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  await mainWindow.loadFile(rendererPath('index.html'));
}

function registerIpcHandlers() {
  ipcMain.handle('app:getBootstrap', async () => {
    const settings = readSettings(settingsStore);
    return {
      version: app.getVersion(),
      settings,
      keyPresence: await getApiKeyPresence(),
      session: sessionSummary({ includeMessages: true }),
      sessions: await listSidebarSessions()
    };
  });

  ipcMain.handle('settings:get', async () => readSettings(settingsStore));

  ipcMain.handle('settings:save', async (_event, nextSettings) => {
    const settings = saveSettings(settingsStore, nextSettings || {});
    await ensureMemoryDirectory(settings.memoryDir);
    if (currentSession) {
      await refreshCurrentSessionMemory(settings);
    }
    return settings;
  });

  ipcMain.handle('keys:set', async (_event, { provider, apiKey }) => {
    await setApiKey(provider, apiKey);
    return await getApiKeyPresence();
  });

  ipcMain.handle('keys:delete', async (_event, { provider }) => {
    await deleteApiKey(provider);
    return await getApiKeyPresence();
  });

  ipcMain.handle('keys:presence', async () => await getApiKeyPresence());

  ipcMain.handle('dialog:selectDirectory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select OpsKit memory directory',
      properties: ['openDirectory', 'createDirectory']
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('dialog:selectQuickSetup', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select OpsKit_Quick_Setup.txt',
      properties: ['openFile'],
      filters: [{ name: 'Text files', extensions: ['txt'] }]
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('dialog:chooseFiles', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Attach documents',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Documents', extensions: ['pdf', 'docx', 'txt'] }]
    });
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle('session:list', async () => await listSidebarSessions());

  ipcMain.handle('session:start', async (_event, { name }) => {
    await startNewSession({ name });
    return sessionPayload({ includeMessages: true });
  });

  ipcMain.handle('session:open', async (_event, { id }) => {
    if (String(id || '').startsWith('memory_')) {
      const slug = String(id).replace(/^memory_/, '');
      await startNewSession({ name: slug, source: 'memory' });
    } else {
      await openSavedSession(id);
    }
    return sessionPayload({ includeMessages: true });
  });

  ipcMain.handle('chat:send', async (_event, { message, attachments }) => {
    if (!currentSession) throw new Error('Start a session before sending a message.');

    const settings = readSettings(settingsStore);
    await assertReadableFile(settings.quickSetupPath, 'Quick Setup file');
    const provider = settings.activeProvider;
    const apiKey = await getApiKey(provider);
    if (!apiKey) throw new Error(`Missing ${providerLabel(provider)} API key. Add it in Settings.`);

    const attachmentPaths = normalizeAttachmentPaths(attachments);
    const extractedFiles = await extractFiles(attachmentPaths);
    const fullUserMessage = prependAttachmentsToMessage({ message, extractedFiles });

    const context = await assembleContext({
      settings,
      sessionSlug: currentSession.slug,
      memoryFiles: currentSession.memoryFiles,
      history: currentSession.history,
      userMessage: fullUserMessage
    });

    const adapter = getProviderAdapter(provider);
    const text = await adapter.send({
      apiKey,
      model: providerModel(settings),
      system: context.system,
      documents: context.documents,
      history: context.history,
      userMessage: context.userMessage,
      temperature: settings.temperature,
      maxTokens: settings.maxTokens
    });

    const receipt = await appendReceiptIfPresent({
      memoryDir: settings.memoryDir,
      sessionSlug: currentSession.slug,
      responseText: text
    });

    if (receipt.saved) {
      currentSession.sessionFilePath = receipt.path;
    }

    const attachmentSummaries = extractedFiles.map((file) => ({ name: file.name, characters: file.characters }));
    const userDisplayContent = attachmentSummaries.length
      ? `${String(message || '').trim() || '(file context only)'}\n\nAttachments: ${attachmentSummaries.map((file) => file.name).join(', ')}`
      : fullUserMessage;

    const userCreatedAt = new Date().toISOString();
    addTranscriptMessage(currentSession, {
      role: 'user',
      content: fullUserMessage,
      createdAt: userCreatedAt,
      meta: {
        displayContent: userDisplayContent,
        attachments: attachmentSummaries
      }
    });
    addTranscriptMessage(currentSession, {
      role: 'assistant',
      content: text,
      createdAt: new Date().toISOString(),
      meta: {
        receiptSaved: Boolean(receipt.saved),
        receiptPath: receipt.saved ? receipt.path : null
      }
    });
    currentSession.activeProvider = provider;
    currentSession.cohereModel = settings.cohereModel;
    currentSession.claudeModel = settings.claudeModel;
    await saveSessionRecord({ sessionDir: sessionHistoryDir, session: currentSession });

    return {
      text,
      receipt,
      extractedFiles: attachmentSummaries,
      session: sessionSummary({ includeMessages: true }),
      sessions: await listSidebarSessions()
    };
  });

  ipcMain.handle('validation:cohereBootTest', async () => {
    const settings = readSettings(settingsStore);
    const apiKey = await getApiKey(PROVIDERS.COHERE);
    if (!apiKey) throw new Error('Missing Cohere API key. Add it in Settings before running RISK-01.');
    await assertReadableFile(settings.quickSetupPath, 'Quick Setup file');

    const context = await assembleContext({
      settings,
      sessionSlug: 'risk-01-cohere-boot-probe',
      memoryFiles: [],
      history: [],
      userMessage: 'Hello'
    });

    return await runCohereBootProbe({
      apiKey,
      model: settings.cohereModel,
      system: context.system,
      documents: context.documents,
      temperature: settings.temperature,
      maxTokens: 1600
    });
  });

  ipcMain.handle('shell:openPath', async (_event, targetPath) => {
    if (!targetPath) return 'missing path';
    return await shell.openPath(targetPath);
  });
}

async function startNewSession({ name, source = 'transcript' }) {
  const settings = readSettings(settingsStore);
  await assertReadableFile(settings.quickSetupPath, 'Quick Setup file');
  await ensureMemoryDirectory(settings.memoryDir);
  await ensureSessionHistoryDirectory(sessionHistoryDir);

  const slug = slugifySessionName(name);
  const memoryFiles = await selectMemoryFiles({
    memoryDir: settings.memoryDir,
    sessionSlug: slug,
    limit: settings.memoryFileLimit
  });

  currentSession = createSessionRecord({
    name: String(name || slug),
    slug,
    memoryFiles,
    settings,
    source,
    sessionFilePath: sessionFilePath(settings.memoryDir, slug)
  });

  await saveSessionRecord({ sessionDir: sessionHistoryDir, session: currentSession });
}

async function openSavedSession(id) {
  const settings = readSettings(settingsStore);
  await assertReadableFile(settings.quickSetupPath, 'Quick Setup file');
  await ensureMemoryDirectory(settings.memoryDir);

  const stored = await loadSessionRecord({ sessionDir: sessionHistoryDir, id });
  const memoryFiles = await selectMemoryFiles({
    memoryDir: settings.memoryDir,
    sessionSlug: stored.slug,
    limit: settings.memoryFileLimit
  });

  currentSession = {
    ...stored,
    memoryFiles,
    sessionFilePath: stored.sessionFilePath || sessionFilePath(settings.memoryDir, stored.slug)
  };
}

async function refreshCurrentSessionMemory(settings = readSettings(settingsStore)) {
  currentSession.memoryFiles = await selectMemoryFiles({
    memoryDir: settings.memoryDir,
    sessionSlug: currentSession.slug,
    limit: settings.memoryFileLimit
  });
  if (!currentSession.sessionFilePath) {
    currentSession.sessionFilePath = sessionFilePath(settings.memoryDir, currentSession.slug);
  }
}

async function sessionPayload({ includeMessages = true } = {}) {
  return {
    session: sessionSummary({ includeMessages }),
    sessions: await listSidebarSessions()
  };
}

async function listSidebarSessions() {
  const settings = readSettings(settingsStore);
  await ensureSessionHistoryDirectory(sessionHistoryDir);
  await ensureMemoryDirectory(settings.memoryDir);

  const saved = await listSessionRecords({ sessionDir: sessionHistoryDir });
  const knownSlugs = new Set(saved.map((session) => session.slug));
  const memoryBacked = await listMemoryBackedSessions({ memoryDir: settings.memoryDir, excludeSlugs: knownSlugs });
  return [...saved, ...memoryBacked].sort(compareSessionsNewestFirst);
}

function sessionSummary({ includeMessages = true } = {}) {
  if (!currentSession) return null;
  return {
    ...toSessionSummary(currentSession, { includeMessages }),
    memoryFiles: currentSession.memoryFiles.map((file) => ({ title: file.title, date: file.date, path: file.path })),
    sessionFilePath: currentSession.sessionFilePath
  };
}

function normalizeAttachmentPaths(attachments = []) {
  return attachments
    .map((item) => (typeof item === 'string' ? item : item?.path))
    .filter(Boolean)
    .filter((filePath) => isSupportedAttachment(filePath));
}

async function assertReadableFile(filePath, label) {
  try {
    await fs.access(filePath);
  } catch {
    throw new Error(`${label} is not readable: ${filePath}`);
  }
}

function providerLabel(provider) {
  return provider === PROVIDERS.COHERE ? 'Cohere' : 'Claude';
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  settingsStore = createSettingsStore();
  sessionHistoryDir = defaultSessionHistoryDir(app.getPath('userData'));
  await ensureMemoryDirectory(readSettings(settingsStore).memoryDir);
  await ensureSessionHistoryDirectory(sessionHistoryDir);
  registerIpcHandlers();
  await createWindow();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
