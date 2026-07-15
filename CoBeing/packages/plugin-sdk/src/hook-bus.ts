/**
 * HookBus — 插件事件总线（notify + intercept + transform 语义）
 */
import { createLogger } from "@cobeing/shared";

const log = createLogger("hook-bus");

export type HookEvent =
  | "agent:create" | "agent:destroy" | "agent:wake" | "agent:sleep"
  | "group:create" | "group:destroy" | "group:archive"
  | "group:addMember" | "group:removeMember"
  | "tool:before" | "tool:after"
  | "message:send" | "message:receive";

type HookHandler = (...args: any[]) => any;

interface HookEntry {
  pluginId: string;
  handler: HookHandler;
}

const NOTIFY_EVENTS: Set<HookEvent> = new Set([
  "agent:create", "agent:destroy", "agent:wake", "agent:sleep",
  "group:create", "group:destroy", "group:archive",
  "group:addMember", "group:removeMember",
  "tool:after", "message:receive",
]);

const INTERCEPT_EVENTS: Set<HookEvent> = new Set([
  "tool:before", "message:send",
]);

export class HookBus {
  private handlers = new Map<HookEvent, HookEntry[]>();

  on(event: HookEvent, pluginId: string, handler: HookHandler): void {
    const list = this.handlers.get(event) || [];
    list.push({ pluginId, handler });
    this.handlers.set(event, list);
  }

  off(event: HookEvent, pluginId: string): void {
    const list = this.handlers.get(event);
    if (!list) return;
    this.handlers.set(event, list.filter(e => e.pluginId !== pluginId));
  }

  async emit(event: HookEvent, ...args: any[]): Promise<any> {
    const list = this.handlers.get(event);
    if (!list || list.length === 0) {
      if (event === "message:send") return { allowed: true, message: args[0] };
      return { allowed: true };
    }

    if (INTERCEPT_EVENTS.has(event)) {
      return this.emitIntercept(event, list, ...args);
    }

    // notify: parallel, ignore errors
    const promises = list.map(entry =>
      Promise.resolve()
        .then(() => entry.handler(...args))
        .catch(err => log.warn("Hook %s plugin %s error: %s", event, entry.pluginId, err?.message))
    );
    await Promise.all(promises);
    return { allowed: true };
  }

  private async emitIntercept(event: HookEvent, list: HookEntry[], ...args: any[]): Promise<any> {
    if (event === "tool:before") {
      for (const entry of list) {
        try {
          const result = await entry.handler(...args);
          if (result && result.allow === false) {
            log.info("tool:before blocked by %s: %s", entry.pluginId, result.reason || "no reason");
            return { allowed: false, reason: result.reason };
          }
        } catch (err: any) {
          log.warn("Hook %s plugin %s error: %s", event, entry.pluginId, err?.message);
        }
      }
      return { allowed: true };
    }

    if (event === "message:send") {
      let message = args[0];
      let ctx = args[1];
      for (const entry of list) {
        try {
          const result = await entry.handler(message, ctx);
          if (result === null) {
            log.info("message:send blocked by %s", entry.pluginId);
            return { allowed: false, reason: "blocked by plugin" };
          }
          if (result && typeof result === "object") {
            // Check for block signal before treating as transformed message
            if (result.allow === false) {
              log.info("message:send blocked by %s: %s", entry.pluginId, result.reason || "no reason");
              return { allowed: false, reason: result.reason || "blocked by plugin" };
            }
            // Only use as transformed message if it has non-empty content
            if (typeof result.content === "string" && result.content.length > 0) {
              message = result;
            }
          }
        } catch (err: any) {
          log.warn("Hook %s plugin %s error: %s", event, entry.pluginId, err?.message);
        }
      }
      return { allowed: true, message };
    }

    return { allowed: true };
  }

  clear(): void { this.handlers.clear(); }
}
