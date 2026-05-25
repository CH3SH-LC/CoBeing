/**
 * GroupRole — 角色定义与权限检查
 */
import type { GroupConfig } from "@cobeing/shared";

export type GroupRole = "user" | "owner" | "member";

/** 根据 agentId 和 GroupConfig 判断角色 */
export function getRole(agentId: string, config: GroupConfig): GroupRole {
  if (agentId === "user") return "user";
  if (config.owner && agentId === config.owner) return "owner";
  return "member";
}

/** 判断是否有群组管理权限（user + owner） */
export function canManageGroup(agentId: string, config: GroupConfig): boolean {
  const role = getRole(agentId, config);
  return role === "user" || role === "owner";
}
