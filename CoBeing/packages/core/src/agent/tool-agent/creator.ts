/**
 * Agent Creator ToolAgent — 管家/前端创建 Agent 时，生成核心文件内容
 *
 * 轻量 LLM 调用，不依赖 Agent 类。被 butler.ts / ws-server.ts 调用。
 */
import type { LLMProvider } from "@cobeing/providers";
import { createLogger } from "@cobeing/shared";

const log = createLogger("agent-creator");

export type CreatorField = "character" | "job";

export interface AgentCreatorInput {
  name: string;
  role: string;
  fields: CreatorField[];
  /** 管家/用户额外指定的内容（如已部分填写，跳过对应字段） */
  provided?: Partial<Record<CreatorField, string>>;
}

export interface AgentCreatorResult {
  files: Partial<Record<CreatorField, string>>;
}

export interface GroupCreatorMember {
  id: string;
  name: string;
  role?: string;
}

export interface GroupCreatorInput {
  name: string;
  topic?: string;
  members: GroupCreatorMember[];
}

export interface GroupMemberSuggestion {
  role: string;
  reason: string;
  suggestedName?: string;
}

export interface GroupInitialTaskSuggestion {
  title: string;
  assigneeHint?: string;
  acceptance?: string;
}

export interface GroupCreatorResult {
  guide?: string;
  plan?: string;
  memberSuggestions: GroupMemberSuggestion[];
  initialTasks: GroupInitialTaskSuggestion[];
  userConfirmations: string[];
}

const SYSTEM_PROMPT = `你是 Agent 创建专家。你的任务是为一个新 Agent 生成核心文件内容。

核心文件定义：
- character: AI 的人物形象 — 姓名、背景、外观、语言风格。要像一个活生生的人，有口癖、有小习惯、有态度。不要"专业、严谨、有条理"这种空话。必须包含典型表达示例（同意时/拒绝时/遇到困难时/思考时怎么说）、口头禅和习惯用语、绝对不说的话。
- job: AI 的工作范式 — 如何思考、工作流程、决策原则、输出规范。写具体工具和方法论，不只是"完成任务"。

要求：
- character 必须有血有肉：写出背景故事、外貌特征、说话习惯、真实的小癖好。像在介绍一个你认识的人。
- 像个人，不像客服。可以说"嗯"、"说实话"、"我觉得"。回答简洁自然，不堆砌"建议"、"推荐"。
- 性格别太极端——太冷漠或太话多都会影响工作，但要有温度、有态度。
- job 必须具体：思考方式、工作流程（理解→调研→执行→验证）、决策原则、输出规范
- 定位面向技能领域（如"Python 数据分析师"），不面向具体项目（如"XX项目的分析师"）
- 所有内容用中文写`;

const GROUP_SYSTEM_PROMPT = `你是 Group 创建专家，也是管家的临时创建助手。你的任务是把用户要创建的群组，转成可由调用方审查和应用的群组草案。

你不是长期 Agent，不注册到 Agent 列表，不直接安装资源，也不替用户做高风险授权。你只返回结构化草案，由管家或前端决定是否应用。

输出必须是纯 JSON 对象：
{
  "guide": "群组 GUIDE.md 草案，包含协作约定、关键节点回传、工作流边界",
  "plan": "群组 PLAN.md 初始草案，可为空字符串",
  "memberSuggestions": [{"role":"建议补充的成员职责","reason":"为什么需要","suggestedName":"可选名称"}],
  "initialTasks": [{"title":"初始任务","assigneeHint":"建议承担者 id 或角色","acceptance":"验收标准"}],
  "userConfirmations": ["需要用户确认的问题"]
}

要求：
- guide 要能直接写入 GUIDE.md，避免空泛口号。
- initialTasks 只给低风险、可确认的启动任务，不自动开始执行用户未确认的目标。
- memberSuggestions 只提出缺口，不要求静默创建 Agent 或安装 Market 资源。
- userConfirmations 聚焦任务范围、权限、资源和成功标准。
- 所有内容用中文写。`;

function buildUserPrompt(input: AgentCreatorInput): string {
  const fields = input.fields.join(", ");
  return `为 Agent "${input.name}" 生成核心文件。角色：${input.role}。请生成以下字段：${fields}

返回一个纯 JSON 对象，只包含请求的字段，不要其他内容：
{"character": "...", "job": "..."}`;
}

function buildGroupUserPrompt(input: GroupCreatorInput): string {
  const members = input.members
    .map(m => `- ${m.name} (${m.id})${m.role ? `：${m.role}` : ""}`)
    .join("\n");
  return `请为新 Group "${input.name}" 生成创建草案。

主题/用途：${input.topic || "用户尚未明确，需要先澄清"}

现有成员：
${members || "- （暂无）"}

请只返回 JSON 对象，不要 markdown 代码块外的解释。`;
}

function extractJsonObject(raw: string): Record<string, unknown> | null {
  let jsonStr = raw.trim();

  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  }

  const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    jsonStr = jsonMatch[0];
  }

  try {
    const parsed = JSON.parse(jsonStr);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function parseResult(raw: string, fields: CreatorField[]): Partial<Record<CreatorField, string>> {
  try {
    const parsed = extractJsonObject(raw) as Record<string, string> | null;
    if (!parsed) return {};
    const result: Partial<Record<CreatorField, string>> = {};
    for (const f of fields) {
      if (parsed[f] && typeof parsed[f] === "string" && parsed[f].trim().length > 0) {
        result[f] = parsed[f].trim();
      }
    }
    return result;
  } catch {
    log.warn("Failed to parse agent creator JSON output");
    return {};
  }
}

function parseGroupResult(raw: string): GroupCreatorResult {
  const parsed = extractJsonObject(raw);
  if (!parsed) {
    log.warn("Failed to parse group creator JSON output");
    return { memberSuggestions: [], initialTasks: [], userConfirmations: [] };
  }

  const memberSuggestions = Array.isArray(parsed.memberSuggestions)
    ? parsed.memberSuggestions
      .filter((item): item is Record<string, unknown> => item && typeof item === "object" && !Array.isArray(item))
      .map(item => ({
        role: typeof item.role === "string" ? item.role.trim() : "",
        reason: typeof item.reason === "string" ? item.reason.trim() : "",
        suggestedName: typeof item.suggestedName === "string" && item.suggestedName.trim() ? item.suggestedName.trim() : undefined,
      }))
      .filter(item => item.role && item.reason)
    : [];

  const initialTasks = Array.isArray(parsed.initialTasks)
    ? parsed.initialTasks
      .filter((item): item is Record<string, unknown> => item && typeof item === "object" && !Array.isArray(item))
      .map(item => ({
        title: typeof item.title === "string" ? item.title.trim() : "",
        assigneeHint: typeof item.assigneeHint === "string" && item.assigneeHint.trim() ? item.assigneeHint.trim() : undefined,
        acceptance: typeof item.acceptance === "string" && item.acceptance.trim() ? item.acceptance.trim() : undefined,
      }))
      .filter(item => item.title)
    : [];

  const userConfirmations = Array.isArray(parsed.userConfirmations)
    ? parsed.userConfirmations.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map(item => item.trim())
    : [];

  return {
    guide: typeof parsed.guide === "string" && parsed.guide.trim() ? parsed.guide.trim() : undefined,
    plan: typeof parsed.plan === "string" && parsed.plan.trim() ? parsed.plan.trim() : undefined,
    memberSuggestions,
    initialTasks,
    userConfirmations,
  };
}

async function collectText(
  provider: LLMProvider,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  abortSignal?: AbortSignal,
): Promise<string> {
  let content = "";
  for await (const chunk of provider.chat({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.7,
    maxTokens: 4096,
    abortSignal,
  })) {
    if (abortSignal?.aborted) break;
    if (chunk.type === "content" && chunk.content) {
      content += chunk.content;
    }
  }
  return content;
}

export async function runAgentCreator(
  provider: LLMProvider,
  model: string,
  input: AgentCreatorInput,
  abortSignal?: AbortSignal,
): Promise<AgentCreatorResult> {
  // 跳过已提供的字段
  const needed = input.fields.filter(f => !input.provided?.[f]);
  if (needed.length === 0) {
    return { files: {} };
  }

  const effectiveInput: AgentCreatorInput = { ...input, fields: needed };
  const userPrompt = buildUserPrompt(effectiveInput);

  log.info("Generating agent core files for %s: %s", input.name, needed.join(", "));

  try {
    const content = await collectText(provider, model, SYSTEM_PROMPT, userPrompt, abortSignal);
    const files = parseResult(content, needed);
    log.info("Agent creator generated %d/%d fields for %s", Object.keys(files).length, needed.length, input.name);
    return { files };
  } catch (err) {
    log.warn("Agent creator LLM call failed for %s: %s", input.name, err);
    return { files: {} };
  }
}

export async function runGroupCreator(
  provider: LLMProvider,
  model: string,
  input: GroupCreatorInput,
  abortSignal?: AbortSignal,
): Promise<GroupCreatorResult> {
  const userPrompt = buildGroupUserPrompt(input);
  log.info("Generating group draft for %s", input.name);

  try {
    const content = await collectText(provider, model, GROUP_SYSTEM_PROMPT, userPrompt, abortSignal);
    const result = parseGroupResult(content);
    log.info(
      "Group creator generated draft for %s: guide=%s plan=%s tasks=%d suggestions=%d",
      input.name,
      result.guide ? "yes" : "no",
      result.plan ? "yes" : "no",
      result.initialTasks.length,
      result.memberSuggestions.length,
    );
    return result;
  } catch (err) {
    log.warn("Group creator LLM call failed for %s: %s", input.name, err);
    return { memberSuggestions: [], initialTasks: [], userConfirmations: [] };
  }
}
