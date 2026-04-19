/**
 * GroupManager — manages group lifecycle（Phase 8.3 使用 v2 异步引擎）
 */
import type { GroupConfig } from "@myagents/shared";
import type { AgentRegistry } from "../agent/registry.js";
import { Group } from "./group.js";

export class GroupManager {
  private groups = new Map<string, Group>();
  private dataRoot?: string;

  constructor(private registry: AgentRegistry, dataRoot?: string) {
    this.dataRoot = dataRoot;
  }

  create(config: GroupConfig): Group {
    const group = new Group(config, this.registry, this.dataRoot ?? "data");
    this.groups.set(config.id, group);
    return group;
  }

  get(groupId: string): Group | undefined {
    return this.groups.get(groupId);
  }

  list(): Group[] {
    return [...this.groups.values()];
  }

  delete(groupId: string): void {
    this.groups.delete(groupId);
  }
}
