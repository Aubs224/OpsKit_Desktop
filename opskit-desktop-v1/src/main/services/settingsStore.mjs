import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import Store from 'electron-store';
import { DEFAULT_SETTINGS, PROVIDERS } from '../../shared/defaults.mjs';
import { clampFloat, clampInteger, isSupportedProvider } from '../../shared/validators.mjs';

export function defaultQuickSetupPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'assets', 'OpsKit_Quick_Setup.txt');
  }
  return path.resolve(app.getAppPath(), 'assets', 'OpsKit_Quick_Setup.txt');
}

export function defaultMemoryDir() {
  return path.join(os.homedir(), 'opskit_memory');
}

export function createSettingsStore() {
  return new Store({
    name: 'settings',
    defaults: {
      ...DEFAULT_SETTINGS,
      memoryDir: defaultMemoryDir(),
      quickSetupPath: defaultQuickSetupPath()
    },
    schema: {
      activeProvider: { type: 'string', enum: [PROVIDERS.COHERE, PROVIDERS.CLAUDE], default: PROVIDERS.COHERE },
      memoryFileLimit: { type: 'number', minimum: 0, maximum: 50, default: 5 },
      memoryDir: { type: 'string' },
      quickSetupPath: { type: 'string' },
      cohereModel: { type: 'string' },
      claudeModel: { type: 'string' },
      maxTokens: { type: 'number', minimum: 256, maximum: 128000, default: 4000 },
      temperature: { type: 'number', minimum: 0, maximum: 2, default: 0.3 }
    }
  });
}

export function readSettings(store) {
  const current = store.store;
  return sanitizeSettings({
    ...DEFAULT_SETTINGS,
    memoryDir: defaultMemoryDir(),
    quickSetupPath: defaultQuickSetupPath(),
    ...current
  });
}

export function saveSettings(store, nextSettings) {
  const sanitized = sanitizeSettings({ ...readSettings(store), ...nextSettings });
  for (const [key, value] of Object.entries(sanitized)) {
    store.set(key, value);
  }
  return readSettings(store);
}

export function sanitizeSettings(input) {
  const activeProvider = isSupportedProvider(input.activeProvider) ? input.activeProvider : PROVIDERS.COHERE;
  return {
    activeProvider,
    memoryFileLimit: clampInteger(input.memoryFileLimit, 0, 50, 5),
    memoryDir: String(input.memoryDir || defaultMemoryDir()),
    quickSetupPath: String(input.quickSetupPath || defaultQuickSetupPath()),
    cohereModel: String(input.cohereModel || 'command-a-03-2025'),
    claudeModel: String(input.claudeModel || 'claude-sonnet-4-6'),
    maxTokens: clampInteger(input.maxTokens, 256, 128000, 4000),
    temperature: clampFloat(input.temperature, 0, 2, 0.3)
  };
}

export function providerModel(settings) {
  return settings.activeProvider === PROVIDERS.COHERE ? settings.cohereModel : settings.claudeModel;
}
