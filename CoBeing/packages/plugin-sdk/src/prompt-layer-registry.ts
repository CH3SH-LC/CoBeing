/**
 * PromptLayerRegistry — 插件 Prompt 层注册表（按 priority 排序注入）
 */
import { createLogger } from "@cobeing/shared";

const log = createLogger("prompt-layer-registry");

/** 每个 layer 输出上限为 8000 字符，防止撑爆上下文窗口 */
const MAX_LAYER_OUTPUT = 8000;

export interface PromptLayer {
  id: string;
  priority: number;
  build(context: { agentId: string; groupId?: string }): string;
}

export class PromptLayerRegistry {
  private layers: PromptLayer[] = [];

  register(layer: PromptLayer): void {
    this.layers = this.layers.filter(l => l.id !== layer.id);
    this.layers.push(layer);
    this.layers.sort((a, b) => a.priority - b.priority);
  }

  unregister(id: string): void {
    this.layers = this.layers.filter(l => l.id !== id);
  }

  build(context: { agentId: string; groupId?: string }): string {
    if (this.layers.length === 0) return "";
    const parts: string[] = [];
    for (const layer of this.layers) {
      try {
        let content = layer.build(context);
        if (!content) continue;

        // Truncate oversized layer output
        if (content.length > MAX_LAYER_OUTPUT) {
          log.warn("Prompt layer %s output truncated (%d → %d chars)", layer.id, content.length, MAX_LAYER_OUTPUT);
          content = content.slice(0, MAX_LAYER_OUTPUT) + "\n\n[Layer output truncated — exceeded limit]";
        }

        // Wrap with provenance markers for audit trail and to prevent "last instruction wins"
        parts.push(`## [Plugin: ${layer.id}]\n\n${content}\n\n## [/Plugin: ${layer.id}]`);
      } catch (err: any) {
        log.warn("Prompt layer %s build() threw: %s — skipping", layer.id, err?.message);
      }
    }
    return parts.join("\n\n");
  }

  get count(): number { return this.layers.length; }

  clear(): void { this.layers = []; }
}
