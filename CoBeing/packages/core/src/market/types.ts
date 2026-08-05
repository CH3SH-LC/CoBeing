/**
 * Market 核心类型 — 市场资源模型 / 信任分级 / 依赖树 / 安装状态
 *
 * 信任分层：official（官方内置）→ certified（官方认证）→ community（社区，需用户确认）→ local（本地私有）
 */
export type MarketResourceType = "agent" | "group" | "skill";

export type MarketTier = "official" | "certified" | "community" | "local";

export type MarketRiskLevel = "low" | "medium" | "high";

export interface MarketDependency {
  type: MarketResourceType;
  id: string;
  version?: string;
}

/** 一个市场资源（来自 market.json 清单） */
export interface MarketResource {
  id: string;
  type: MarketResourceType;
  name: string;
  description: string;
  version: string;
  tier: MarketTier;
  author: string;
  icon?: string;
  tags: string[];
  riskLevel: MarketRiskLevel;
  permissions: string[];
  dependencies: MarketDependency[];
}

/** 面向 UI 的资源视图（带安装状态） */
export interface MarketResourceView extends MarketResource {
  installed: boolean;
}

/** 依赖树节点（安装确认与展示用） */
export interface MarketDepNode {
  id: string;
  type: MarketResourceType;
  name: string;
  tier: MarketTier;
  riskLevel: MarketRiskLevel;
  required: boolean;
  children: MarketDepNode[];
}

export type MarketInstallStatus = "installed" | "approval_required" | "already_installed" | "error";

export interface MarketInstallResult {
  status: MarketInstallStatus;
  id: string;
  type: MarketResourceType;
  name: string;
  message?: string;
  installedIds: string[];
  dependencyTree: MarketDepNode;
  warning?: string;
}

/** installed.json 中的持久化条目 */
export interface InstalledEntry {
  id: string;
  type: MarketResourceType;
  name: string;
  installedAt: string;
  sourceId: string;
  installedIds: string[];
}
