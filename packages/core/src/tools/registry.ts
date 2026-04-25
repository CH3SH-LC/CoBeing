/**
 * ToolRegistry — 注册和管理可用工具
 */
import type { Tool, ToolDefinition } from "@cobeing/shared";

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  listDefinitions(): ToolDefinition[] {
    return [...this.tools.values()].map(t => ({
      type: "function" as const,
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
  }

  listAll(): Tool[] {
    return [...this.tools.values()];
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }
}
