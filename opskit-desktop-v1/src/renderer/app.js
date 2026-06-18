const state = {
  settings: null,
  keyPresence: null,
  session: null,
  sessions: [],
  attachments: [],
  busy: false
};

const elements = {
  providerBadge: document.getElementById('providerBadge'),
  sessionBadge: document.getElementById('sessionBadge'),
  statusStrip: document.getElementById('statusStrip'),
  chatLog: document.getElementById('chatLog'),
  dropZone: document.getElementById('dropZone'),
  attachmentList: document.getElementById('attachmentList'),
  messageInput: document.getElementById('messageInput'),
  attachButton: document.getElementById('attachButton'),
  sendButton: document.getElementById('sendButton'),
  settingsButton: document.getElementById('settingsButton'),
  newSessionButton: document.getElementById('newSessionButton'),
  toolbarNewSessionButton: document.getElementById('toolbarNewSessionButton'),
  refreshSessionsButton: document.getElementById('refreshSessionsButton'),
  sessionList: document.getElementById('sessionList'),
  sessionDialog: document.getElementById('sessionDialog'),
  sessionForm: document.getElementById('sessionForm'),
  sessionNameInput: document.getElementById('sessionNameInput'),
  sessionSlugPreview: document.getElementById('sessionSlugPreview'),
  cancelSessionButton: document.getElementById('cancelSessionButton'),
  settingsDialog: document.getElementById('settingsDialog'),
  settingsForm: document.getElementById('settingsForm'),
  activeProviderInput: document.getElementById('activeProviderInput'),
  cohereModelInput: document.getElementById('cohereModelInput'),
  claudeModelInput: document.getElementById('claudeModelInput'),
  maxTokensInput: document.getElementById('maxTokensInput'),
  temperatureInput: document.getElementById('temperatureInput'),
  memoryFileLimitInput: document.getElementById('memoryFileLimitInput'),
  memoryDirInput: document.getElementById('memoryDirInput'),
  quickSetupPathInput: document.getElementById('quickSetupPathInput'),
  cohereKeyInput: document.getElementById('cohereKeyInput'),
  claudeKeyInput: document.getElementById('claudeKeyInput'),
  browseMemoryButton: document.getElementById('browseMemoryButton'),
  browseQuickSetupButton: document.getElementById('browseQuickSetupButton'),
  saveSettingsButton: document.getElementById('saveSettingsButton'),
  runCohereTestButton: document.getElementById('runCohereTestButton'),
  openMemoryButton: document.getElementById('openMemoryButton'),
  keyStatus: document.getElementById('keyStatus'),
  validationOutput: document.getElementById('validationOutput')
};

window.addEventListener('DOMContentLoaded', init);

elements.settingsButton.addEventListener('click', openSettings);
elements.newSessionButton.addEventListener('click', beginNewSession);
elements.toolbarNewSessionButton.addEventListener('click', beginNewSession);
elements.refreshSessionsButton.addEventListener('click', refreshSessions);
elements.cancelSessionButton.addEventListener('click', () => elements.sessionDialog.close());
elements.attachButton.addEventListener('click', attachFiles);
elements.sendButton.addEventListener('click', sendMessage);
elements.messageInput.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    sendMessage();
  }
});

elements.sessionNameInput.addEventListener('input', updateSlugPreview);

elements.sessionForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await startSession(elements.sessionNameInput.value);
});

elements.browseMemoryButton.addEventListener('click', async () => {
  const selected = await window.opskit.selectDirectory();
  if (selected) elements.memoryDirInput.value = selected;
});

elements.browseQuickSetupButton.addEventListener('click', async () => {
  const selected = await window.opskit.selectQuickSetup();
  if (selected) elements.quickSetupPathInput.value = selected;
});

elements.saveSettingsButton.addEventListener('click', saveSettings);
elements.runCohereTestButton.addEventListener('click', runCohereBootTest);
elements.openMemoryButton.addEventListener('click', async () => {
  if (state.settings?.memoryDir) await window.opskit.openPath(state.settings.memoryDir);
});

for (const eventName of ['dragenter', 'dragover']) {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.add('drag-over');
  });
}

for (const eventName of ['dragleave', 'drop']) {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.remove('drag-over');
  });
}

elements.dropZone.addEventListener('drop', (event) => {
  const paths = Array.from(event.dataTransfer.files || [])
    .map((file) => file.path)
    .filter(Boolean)
    .filter(isSupportedPath);

  if (!paths.length) {
    addSystemMessage('No supported local file paths were found in the drop. Use Attach files if your Electron build hides drag-and-drop paths.');
    return;
  }
  addAttachments(paths);
});

async function init() {
  try {
    const bootstrap = await window.opskit.getBootstrap();
    state.settings = bootstrap.settings;
    state.keyPresence = bootstrap.keyPresence;
    state.session = bootstrap.session;
    state.sessions = bootstrap.sessions || [];
    hydrateSettingsForm();
    renderKeyStatus();
    renderStatus();
    renderSessionList();

    if (state.session) {
      renderConversation(`Session '${state.session.slug}' is active.`);
    } else {
      renderConversation('OpsKit Desktop loaded. Open a previous chat from the sidebar or start a new session.');
      if (!state.sessions.length) beginNewSession();
    }
  } catch (error) {
    addSystemMessage(`Startup error: ${error.message}`);
  }
}

function beginNewSession() {
  if (state.busy) return;
  elements.sessionNameInput.value = '';
  updateSlugPreview();
  showModal(elements.sessionDialog);
  elements.sessionNameInput.focus();
}

async function startSession(name) {
  try {
    const result = await window.opskit.startSession(name);
    state.session = result.session;
    state.sessions = result.sessions || [];
    state.attachments = [];
    elements.sessionDialog.close();
    renderAttachments();
    renderStatus();
    renderSessionList();
    renderConversation(`Session '${state.session.slug}' started. Loaded ${state.session.memoryFiles.length} memory file(s).`);
    elements.messageInput.focus();
  } catch (error) {
    addSystemMessage(`Could not start session: ${error.message}`);
  }
}

async function openSession(id) {
  if (state.busy || !id || state.session?.id === id) return;
  try {
    const result = await window.opskit.openSession(id);
    state.session = result.session;
    state.sessions = result.sessions || [];
    state.attachments = [];
    renderAttachments();
    renderStatus();
    renderSessionList();
    renderConversation(`Opened '${state.session.slug}'. Restored ${state.session.historyTurns} turn(s) and loaded ${state.session.memoryFiles.length} memory file(s).`);
    elements.messageInput.focus();
  } catch (error) {
    addSystemMessage(`Could not open session: ${error.message}`);
  }
}

async function refreshSessions() {
  try {
    state.sessions = await window.opskit.listSessions();
    renderSessionList();
  } catch (error) {
    addSystemMessage(`Could not refresh chat history: ${error.message}`);
  }
}

async function attachFiles() {
  try {
    if (!state.session) {
      beginNewSession();
      return;
    }
    const paths = await window.opskit.chooseFiles();
    addAttachments(paths);
  } catch (error) {
    addSystemMessage(`Attach failed: ${error.message}`);
  }
}

function addAttachments(paths) {
  const current = new Set(state.attachments);
  for (const filePath of paths || []) {
    if (isSupportedPath(filePath)) current.add(filePath);
  }
  state.attachments = Array.from(current);
  renderAttachments();
}

function renderAttachments() {
  elements.attachmentList.textContent = '';
  for (const filePath of state.attachments) {
    const pill = document.createElement('span');
    pill.className = 'attachment-pill';
    const label = document.createElement('span');
    label.textContent = basename(filePath);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.title = 'Remove attachment';
    remove.addEventListener('click', () => {
      state.attachments = state.attachments.filter((item) => item !== filePath);
      renderAttachments();
    });
    pill.append(label, remove);
    elements.attachmentList.append(pill);
  }
}

async function sendMessage() {
  const message = elements.messageInput.value.trim();
  if (state.busy || (!message && !state.attachments.length)) return;
  if (!state.session) {
    beginNewSession();
    return;
  }

  state.busy = true;
  updateComposerState();

  const attachments = [...state.attachments];
  const userPreview = attachments.length
    ? `${message || '(file context only)'}\n\nAttachments: ${attachments.map(basename).join(', ')}`
    : message;
  addMessage('user', userPreview);
  const pending = addMessage('assistant', 'Thinking…');

  try {
    const result = await window.opskit.sendMessage({
      message,
      attachments,
      displayMessage: userPreview
    });
    pending.querySelector('.message-body').textContent = result.text;
    pending.querySelector('.message-meta').textContent = result.receipt?.saved
      ? `receipt saved · ${result.receipt.bytes} bytes`
      : 'receipt not saved';
    state.session = result.session;
    state.sessions = result.sessions || [];
    state.attachments = [];
    elements.messageInput.value = '';
    renderAttachments();
    renderStatus();
    renderSessionList();
  } catch (error) {
    pending.querySelector('.message-body').textContent = `Error: ${error.message}`;
    pending.querySelector('.message-meta').textContent = 'failed';
  } finally {
    state.busy = false;
    updateComposerState();
    elements.messageInput.focus();
  }
}

function openSettings() {
  hydrateSettingsForm();
  renderKeyStatus();
  elements.validationOutput.textContent = '';
  showModal(elements.settingsDialog);
}

async function saveSettings() {
  try {
    const nextSettings = {
      activeProvider: elements.activeProviderInput.value,
      cohereModel: elements.cohereModelInput.value,
      claudeModel: elements.claudeModelInput.value,
      maxTokens: Number(elements.maxTokensInput.value),
      temperature: Number(elements.temperatureInput.value),
      memoryFileLimit: Number(elements.memoryFileLimitInput.value),
      memoryDir: elements.memoryDirInput.value,
      quickSetupPath: elements.quickSetupPathInput.value
    };

    state.settings = await window.opskit.saveSettings(nextSettings);

    if (elements.cohereKeyInput.value.trim()) {
      state.keyPresence = await window.opskit.setApiKey('cohere', elements.cohereKeyInput.value.trim());
      elements.cohereKeyInput.value = '';
    }
    if (elements.claudeKeyInput.value.trim()) {
      state.keyPresence = await window.opskit.setApiKey('claude', elements.claudeKeyInput.value.trim());
      elements.claudeKeyInput.value = '';
    }

    state.keyPresence = await window.opskit.getKeyPresence();
    hydrateSettingsForm();
    renderKeyStatus();
    renderStatus();
    await refreshSessions();
    elements.validationOutput.textContent = 'Settings saved.';
  } catch (error) {
    elements.validationOutput.textContent = `Save failed: ${error.message}`;
  }
}

async function runCohereBootTest() {
  elements.validationOutput.textContent = 'Running Cohere boot test…';
  try {
    const result = await window.opskit.runCohereBootTest();
    elements.validationOutput.textContent = `${result.passed ? 'PASS' : 'CHECK NEEDED'}\n\n${result.text}`;
  } catch (error) {
    elements.validationOutput.textContent = `Boot test failed: ${error.message}`;
  }
}

function hydrateSettingsForm() {
  if (!state.settings) return;
  elements.activeProviderInput.value = state.settings.activeProvider;
  elements.cohereModelInput.value = state.settings.cohereModel;
  elements.claudeModelInput.value = state.settings.claudeModel;
  elements.maxTokensInput.value = state.settings.maxTokens;
  elements.temperatureInput.value = state.settings.temperature;
  elements.memoryFileLimitInput.value = state.settings.memoryFileLimit;
  elements.memoryDirInput.value = state.settings.memoryDir;
  elements.quickSetupPathInput.value = state.settings.quickSetupPath;
  elements.cohereKeyInput.value = '';
  elements.claudeKeyInput.value = '';
}

function renderKeyStatus() {
  const presence = state.keyPresence;
  if (!presence) return;
  const cohere = presence.providers?.cohere ? '<span class="ok">stored</span>' : '<span class="warn">missing</span>';
  const claude = presence.providers?.claude ? '<span class="ok">stored</span>' : '<span class="warn">missing</span>';
  elements.keyStatus.innerHTML = `Key store: ${escapeHtml(presence.status.message)}<br>Cohere key: ${cohere} · Claude key: ${claude}`;
}

function renderStatus() {
  const settings = state.settings;
  elements.providerBadge.textContent = `Provider: ${settings?.activeProvider || '—'}`;
  elements.sessionBadge.textContent = `Session: ${state.session?.slug || 'none'}`;

  if (!state.session) {
    elements.statusStrip.innerHTML = 'No active session. Open a previous chat from the sidebar or start a new session to load Layer 2 memory files.';
    updateComposerState();
    return;
  }

  const files = state.session.memoryFiles || [];
  const memoryList = files.length ? files.map((file) => escapeHtml(file.title)).join(', ') : 'cold boot only';
  elements.statusStrip.innerHTML = `
    <strong>${escapeHtml(state.session.slug)}</strong> · provider <strong>${escapeHtml(settings.activeProvider)}</strong> ·
    loaded memory files: <strong>${files.length}</strong> (${memoryList}) · turns: <strong>${state.session.historyTurns}</strong>
  `;
  updateComposerState();
}

function renderSessionList() {
  elements.sessionList.textContent = '';
  if (!state.sessions.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No saved chats yet. Start a new session to create one.';
    elements.sessionList.append(empty);
    return;
  }

  for (const session of state.sessions) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `session-card${state.session?.id === session.id ? ' active' : ''}`;
    card.addEventListener('click', () => openSession(session.id));

    const title = document.createElement('div');
    title.className = 'session-card-title';
    title.textContent = session.displayName || session.slug;

    const meta = document.createElement('div');
    meta.className = 'session-card-meta';
    meta.textContent = `${session.slug} · ${session.historyTurns} turn${session.historyTurns === 1 ? '' : 's'} · ${formatDateTime(session.updatedAt)}`;

    const preview = document.createElement('div');
    preview.className = 'session-card-preview';
    preview.textContent = session.lastMessagePreview || 'No messages yet';

    card.append(title, meta, preview);
    elements.sessionList.append(card);
  }
}

function renderConversation(systemNotice = '') {
  elements.chatLog.textContent = '';
  if (systemNotice) addSystemMessage(systemNotice);

  if (!state.session) {
    if (!systemNotice) addSystemMessage('No active session. Open a previous chat or start a new one.');
    return;
  }

  const history = state.session.history || state.session.messages || [];
  if (!history.length) {
    if (!systemNotice) addSystemMessage(`Session '${state.session.slug}' is ready. Send a message to begin.`);
    return;
  }

  for (const entry of history) {
    addMessage(entry.role, entry.displayContent || entry.meta?.displayContent || entry.content, (entry.at || entry.createdAt) ? formatDateTime(entry.at || entry.createdAt) : undefined);
  }
}

function updateComposerState() {
  const hasSession = Boolean(state.session);
  elements.messageInput.disabled = state.busy || !hasSession;
  elements.attachButton.disabled = state.busy || !hasSession;
  elements.sendButton.disabled = state.busy || !hasSession;
  elements.messageInput.placeholder = hasSession ? 'Type your message…' : 'Start or open a session to chat…';
}

function addSystemMessage(text) {
  addMessage('system', text);
}

function addMessage(role, text, metaText = new Date().toLocaleTimeString()) {
  const article = document.createElement('article');
  article.className = `message ${role}`;

  const header = document.createElement('div');
  header.className = 'message-header';
  const title = document.createElement('strong');
  title.textContent = role === 'assistant' ? 'Assistant' : role === 'user' ? 'You' : 'System';
  const meta = document.createElement('span');
  meta.className = 'message-meta';
  meta.textContent = metaText || '';
  header.append(title, meta);

  const body = document.createElement('div');
  body.className = 'message-body';
  body.textContent = text;

  article.append(header, body);
  elements.chatLog.append(article);
  elements.chatLog.scrollTop = elements.chatLog.scrollHeight;
  return article;
}

function showModal(dialog) {
  if (!dialog.open) dialog.showModal();
}

function updateSlugPreview() {
  elements.sessionSlugPreview.textContent = `slug: ${slugify(elements.sessionNameInput.value) || '—'}`;
}

function slugify(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function isSupportedPath(filePath) {
  return /\.(pdf|docx|txt)$/i.test(String(filePath || ''));
}

function basename(filePath) {
  return String(filePath || '').split(/[\\/]/).pop();
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
