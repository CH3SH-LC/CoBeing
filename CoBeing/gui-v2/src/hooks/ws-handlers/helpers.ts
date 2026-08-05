import { useActivityStore } from "@/stores/activity";

/** 记录活动日志 */
export function emitActivity(
  icon: string,
  text: string,
  level: "info" | "warn" | "error" = "info",
  category: "message" | "tool" | "file" | "todo" | "system" = "system",
  agentId?: string,
  groupId?: string,
  extra?: { agentName?: string; groupName?: string; fileName?: string; mentionTargets?: string[] },
) {
  useActivityStore.getState().addEntry({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: Date.now(),
    icon,
    text,
    level,
    category,
    agentId,
    groupId,
    agentName: extra?.agentName,
    groupName: extra?.groupName,
    fileName: extra?.fileName,
    mentionTargets: extra?.mentionTargets,
  });
}

/** 从内容中提取 @mentions（最少 3 字符，避免误匹配中文短词；
 *  用户别名 @用户/@主人/@老板/@user 不受 3 字符限制，单独识别） */
export function extractMentions(content: string): string[] {
  const matches = content.match(/@([\w一-鿿][\w一-鿿-]{2,})/g);
  const mentions = matches ? [...new Set(matches.map(m => m.slice(1)))] : [];
  for (const alias of USER_MENTION_ALIASES) {
    if (new RegExp(`@${alias}(?![\w一-鿿])`, "i").test(content) && !mentions.includes(alias)) {
      mentions.push(alias);
    }
  }
  return mentions;
}

/** 用户别名：群组内 @ 到这些名称时视为唤醒用户（agent 平时协作不打扰用户） */
const USER_MENTION_ALIASES = ["user", "用户", "主人", "老板", "主人用户"];

/** mentions 列表是否包含用户别名（含大小写归一） */
export function mentionsUser(mentions: string[]): boolean {
  return mentions.some(m => USER_MENTION_ALIASES.includes(m.toLowerCase()));
}
