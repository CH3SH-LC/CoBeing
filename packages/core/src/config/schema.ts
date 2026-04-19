/**
 * 配置 Schema 定义 — Phase 8.1 自治配置
 */

export interface ChannelBindTo {
  type: "agent" | "group";
  agentId?: string;
  groupId?: string;
  role?: "user" | "owner";
}

/**
 * 根配置 — 声明全局资源和默认 Agent（butler）
 */
export interface AppConfig {
  core: {
    logLevel: string;
    dataDir: string;
    skillsDir?: string;     // 全局 Skill 仓库路径，默认 "./skills"
    promptsDir?: string;    // Prompt 模板路径，默认 "./prompts"
  };
  agent: {
    name: string;
    role: string;
    systemPrompt: string;
    provider: string;
    model: string;
    permissions: {
      mode: string;
      allow?: string[];
      deny?: string[];
    };
    sandbox: {
      enabled: boolean;
      filesystem: string;
      network: boolean;
      bindings?: string[];
    };
    tools?: string[];
    toolsConfig?: {
      defaultPermission: string;
      enabled: string[];
      permissions: Record<string, Record<string, string | number>>;
    };
    skillsDir?: string;
  };
  providers: Record<string, {
    type?: "openai-compat" | "anthropic" | "gemini";
    apiKeyEnv?: string;
    baseURL?: string;
    apiKey?: string;
  }>;
  channels: Record<string, {
    enabled: boolean;
    type: "onebot" | "wecom" | "feishu" | "discord";
    // OneBot / QQ
    wsUrl?: string;
    botQQ?: string;
    accessToken?: string;
    allowedGroups?: number[];
    allowedUsers?: number[];
    // WeCom
    wecomCorpId?: string;
    wecomAgentId?: string;
    wecomSecret?: string;
    wecomToken?: string;
    wecomEncodingAesKey?: string;
    wecomPort?: number;
    // Feishu
    feishuAppId?: string;
    feishuAppSecret?: string;
    feishuVerificationToken?: string;
    feishuEncryptKey?: string;
    feishuPort?: number;
    // Discord
    discordBotToken?: string;
    discordGuildId?: string;
    discordAllowedChannels?: string[];
    // Binding
    bindTo?: ChannelBindTo;
  }>;
  gui?: {
    enabled: boolean;
    wsPort: number;
  };
  mcpServers?: Record<string, {
    transport: "stdio" | "http";
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string;
    headers?: Record<string, string>;
  }>;
  groups?: Array<{
    id: string;
    name: string;
    members: string[];
    protocol: string;
    moderator?: string;
    maxRounds?: number;
    topic?: string;
  }>;
}

/**
 * Agent 自治配置 — 存放在 data/agents/{id}/config.json
 */
export interface AgentSelfConfig {
  name: string;
  role: string;
  provider: string;
  model: string;
  permissions?: {
    mode: string;
    allow?: string[];
    deny?: string[];
  };
  sandbox?: {
    enabled: boolean;
    filesystem: string;
    network: boolean;
    bindings?: string[];
  };
  tools?: string[];
  skills?: string[];
  systemPrompt?: string;
}
