// packages/core/src/group/filter-prompt.ts

/** 过滤层 system prompt — 硬编码，告诉本地模型做什么 */
export const FILTER_SYSTEM_PROMPT = `你是群组协调助手。你的任务是分析群聊消息，判断是否需要群主介入。

判断准则：
- 有新问题或新需求 → shouldWake: true
- 有人表达困惑或求助 → shouldWake: true
- 出现观点分歧需要决策 → shouldWake: true
- 有重要进展需要确认 → shouldWake: true
- 不确定时一律选 shouldWake: true（宁可多叫不漏叫）
- 成员之间的简单回复、闲聊、已明确的执行中任务 → shouldWake: false

你必须以 JSON 格式回复，不要输出任何其他内容。`;

/** 构建用户 prompt：将最近消息格式化给模型 */
export function buildFilterUserPrompt(
  groupId: string,
  messages: Array<{ fromAgentId: string; content: string; timestamp: number }>,
): string {
  const lines = messages.map(m => {
    const time = new Date(m.timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    return `[${time}] ${m.fromAgentId}: ${m.content}`;
  });

  return `群组 ${groupId} 的最近消息：

${lines.join("\n")}

请判断是否需要群主介入。以 JSON 格式回复：
{"shouldWake": boolean, "reason": "原因", "summary": "摘要", "priority": "high|normal|low"}`;
}

/** JSON grammar 定义 — 强制模型输出符合格式的 JSON */
export const FILTER_JSON_GRAMMAR = `
root   ::= object
object ::= "{" ws pair ("," ws pair)* "}"
pair   ::= key ":" ws value
key    ::= "\"shouldWake\"" | "\"reason\"" | "\"summary\"" | "\"priority\""
value  ::= boolean | string | null
boolean ::= "true" | "false"
string  ::= "\"" [^"]* "\""
null    ::= "null"
ws     ::= [ \\t\\n]*
`;
