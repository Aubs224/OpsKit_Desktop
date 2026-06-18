export const PROVIDERS = Object.freeze({
  COHERE: 'cohere',
  CLAUDE: 'claude'
});

export const DEFAULT_SETTINGS = Object.freeze({
  activeProvider: PROVIDERS.COHERE,
  memoryFileLimit: 5,
  memoryDir: '',
  quickSetupPath: '',
  cohereModel: 'command-a-03-2025',
  claudeModel: 'claude-sonnet-4-6',
  maxTokens: 4000,
  temperature: 0.3
});

export const RECEIPT_GLYPH = '[::📋::]';
export const APP_SERVICE_NAME = 'OpsKit Desktop';
export const SUPPORTED_FILE_EXTENSIONS = Object.freeze(['.pdf', '.docx', '.txt']);
