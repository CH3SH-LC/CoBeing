/**
 * GroupManager — manages group lifecycle + GroupContext
 */
import type { GroupConfig } from "@myagents/shared";
import type { AgentRegistry } from "../agent/registry.js";
import { Group } from "./group.js";
import { GroupContext } from "./context.js";

export class GroupManager {
  private groups = new Map<string, Group>();
  private contexts = new Map<string, GroupContext>();
  private dataRoot?: string;

  constructor(private registry: AgentRegistry, dataRoot?: string) {
    this.dataRoot = dataRoot;
  }

  create(config: GroupConfig): Group {
    const ctx = new GroupContext(config.id, this.dataRoot);
    ctx.saveConfig(config.members, config.protocol);
    this.contexts.set(config.id, ctx);

    const group = new Group(config, this.registry, ctx);
    this.groups.set(config.id, group);

    return group;
  }

  get(groupId: string): Group | undefined {
    return this.groups.get(groupId);
  }

  /** 获取 GroupContext */
  getContext(groupId: string): GroupContext | undefined {
    return this.contexts.get(groupId);
  }

  list(): Group[] {
    return [...this.groups.values()];
  }

  delete(groupId: string): void {
    this.groups.delete(groupId);
    this.contexts.delete(groupId);
  }
}
