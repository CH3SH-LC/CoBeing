/**
 * 配置 Schema 定义 — Phase 9 自治配置
 *
 * 根配置仅声明 Agent ID 列表 + 全局资源。
 * Agent 的完整配置存放在 data/agents/{id}/config.json（自治配置）。
 */

import type { NetworkConfig, SecurityConfig, LocalModelConfig } from "@cobeing/shared";

export interface ChannelBindTo {
  type: "agent" | "group";
  agentId?: string;
  groupId?: string;
}

/**
 * 根配置 — 最小化声明：Agent ID 列表 + providers + channels
 */
export interface AppConfig {
  core: {
    logLevel: string;
    dataDir: string;
    skillsDir?: string;
    promptsDir?: string;
    /** 普通 Agent 单次对话最大工具调用轮数 */
    maxToolRounds?: number;
    /** 管家单次对话最大工具调用轮数 */
    butlerMaxToolRounds?: number;
    /** 群组记忆系统配置 */
    groupMemory?: {
      /** current.md 最大消息条数，默认 100 */
      maxCurrentMessages?: number;
    };
    /** 本地小模型过滤层配置 */
    localModel?: LocalModelConfig;
  };
  /** Agent ID 列表 — 完整配置在 data/agents/{id}/config.json */
  agents: string[];
  providers: Record<string, {
    type?: "openai-compat" | "anthropic" | "gemini";
    apiKeyEnv?: string;
    baseURL?: string;
    apiKey?: string;
    plan?: "general" | "coding";
  }>;
  channels: Record<string, {
    enabled: boolean;
    type: "onebot" | "wecom" | "feishu" | "discord" | "qqbot";
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
    // QQ Bot Official API v2
    qqbotAppId?: string;
    qqbotAppSecret?: string;
    qqbotIntents?: number;
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
    owner?: string;
    topic?: string;
  }>;
}

/**
 * Agent 自治配置 — 存放在 data/agents/{id}/config.json
 */
export interface AgentSelfConfig {
  name: string;
  role: string;
  systemPrompt?: string;
  provider: string;
  model: string;
  permissions?: {
    mode: string;
    allow?: string[];
    deny?: string[];
  };
  sandbox?: {
    enabled: boolean;
    filesystem: "isolated" | "host";
    network: NetworkConfig;
    bindings?: string[];
    resources?: {
      memory?: string;
      cpus?: number;
      timeout?: number;
      disk?: string;
    };
    image?: string;
    security?: SecurityConfig;
  };
  tools?: string[];
  skills?: string[];
}
