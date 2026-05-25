/**
 * Shared constants — single source of truth for magic strings and numbers
 */
export const DEFAULT_PROVIDER = "deepseek";
export const DEFAULT_MODEL = "deepseek-v4-flash";
export const DEFAULT_JUDGMENT_MODEL = "deepseek-chat";
export const DEFAULT_WS_PORT = 18765;
export const DEFAULT_TIMEOUT_MS = 30_000;
export const MAX_BASH_OUTPUT = 16_384;
export const MAX_MEMORY_CHARS: Record<string, number> = {
  memory: 3000, experience: 5000, user: 2000, tools: 3000,
};
export const MAX_AGENT_NAME_LENGTH = 64;
export const MAX_GROUP_NAME_LENGTH = 64;
export const MAX_MESSAGE_LENGTH = 100_000;
