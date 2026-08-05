/**
 * Market Butler 工具 — butler-market-recommend / butler-market-install
 * 供 Butler 在对话中搜索市场资源、引导用户安装（社区资源需用户确认）。
 */
import type { Tool, ToolContext, ToolResult } from "@cobeing/shared";
import type { MarketCatalog } from "./catalog.js";
import { RESOURCE_ID_PATTERN } from "./catalog.js";
import type { MarketInstaller } from "./installer.js";
import type { MarketDepNode, MarketResource, MarketResourceType, MarketTier } from "./types.js";

const VALID_TYPES: MarketResourceType[] = ["agent", "group", "skill"];

/** 层级展示顺序：官方 > 认证 > 社区 > 本地 */
const TIER_ORDER: Record<MarketTier, number> = { official: 0, certified: 1, community: 2, local: 3 };

const TIER_LABEL: Record<MarketTier, string> = {
  official: "官方内置",
  certified: "官方认证",
  community: "社区",
  local: "本地",
};

/** 按层级排序（official/certified 优先），社区标注未认证，本地标注默认路径 */
function formatResourceLine(r: MarketResource): string {
  let line = `- [${TIER_LABEL[r.tier]}] ${r.name}（${r.id}）— ${r.description}（版本 ${r.version}，风险 ${r.riskLevel}）`;
  if (r.tier === "community") line += " ⚠️ 未认证，需用户审查后安装";
  if (r.tier === "local") line += "（本地资源，默认路径，无需安装）";
  return line;
}

/** 序列化依赖树为文本 */
function renderTree(node: MarketDepNode, indent = 0): string[] {
  const lines = [
    `${"  ".repeat(indent)}- ${node.name}（${node.id}）[${TIER_LABEL[node.tier]}/${node.riskLevel}]${node.tier === "community" ? " ⚠️ 未认证" : ""}`,
  ];
  for (const child of node.children) lines.push(...renderTree(child, indent + 1));
  return lines;
}

export function makeMarketRecommendTool(
  catalog: MarketCatalog,
  deps: { dataRoot: string; listLocalResources: () => MarketResource[] },
): Tool {
  return {
    name: "butler-market-recommend",
    description: "搜索并推荐 CoBeing 市场资源（技能 / Agent / 群组），给出可安装性结论",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "搜索关键词（匹配 id / 名称 / 描述 / 标签）",
        },
        type: {
          type: "string",
          description: "资源类型筛选: skill / agent / group",
        },
      },
      required: ["query"],
    },
    async execute(params: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
      const query = String(params.query ?? "").trim();
      const typeFilter = VALID_TYPES.includes(params.type as MarketResourceType) ? (params.type as MarketResourceType) : undefined;
      const lines: string[] = [];

      // 市场资源（官方/认证/社区三层）
      const marketResults = catalog.search(query, typeFilter ? { type: typeFilter } : undefined);
      const sorted = [...marketResults].sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || (a.id < b.id ? -1 : 1));
      for (const r of sorted) lines.push(formatResourceLine(r));

      // 本地资源层
      const q = query.toLowerCase();
      const localResults = deps
        .listLocalResources()
        .filter((r) => {
          if (typeFilter && r.type !== typeFilter) return false;
          if (!q) return true;
          return (
            r.id.toLowerCase().includes(q) ||
            r.name.toLowerCase().includes(q) ||
            r.description.toLowerCase().includes(q) ||
            r.tags.some((t) => t.toLowerCase().includes(q))
          );
        })
        .sort((a, b) => (a.id < b.id ? -1 : 1));
      for (const r of localResults) lines.push(formatResourceLine(r));

      // 推荐结论
      const hasCommunity = sorted.some((r) => r.tier === "community");
      let conclusion: string;
      if (sorted.length === 0) {
        conclusion = localResults.length > 0
          ? "推荐结论：市场中没有匹配资源，可先使用本地资源，或建议在本地创建新资源"
          : "推荐结论：未找到匹配资源，建议在本地创建";
      } else if (hasCommunity) {
        conclusion = "推荐结论：需用户确认（结果中包含社区未认证资源，确认后需用户审查）";
      } else {
        conclusion = "推荐结论：可推荐安装";
      }

      const header = `Market 资源推荐（关键词：${query || "（空）"}）\n`;
      const body = lines.length > 0 ? lines.join("\n") : "（无匹配资源）";
      const footer =
        `\n\n${conclusion}\n` +
        `安装路径：市场资源 → ${deps.dataRoot}/market/<tier>/<id>；安装落盘 → skills/agents/groups 目录`;
      return { toolCallId: "", content: header + body + footer };
    },
  };
}

export function makeMarketInstallTool(catalog: MarketCatalog, installer: MarketInstaller): Tool {
  return {
    name: "butler-market-install",
    description: "安装市场资源（技能 / Agent / 群组），含依赖自动安装；社区资源需 confirmed: true 用户确认",
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "市场资源 id",
        },
        confirmed: {
          type: "boolean",
          description: "是否确认安装社区未认证资源（approval_required 时须显式传 true）",
        },
      },
      required: ["id"],
    },
    async execute(params: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
      const id = String(params.id ?? "").trim();
      if (!id || !RESOURCE_ID_PATTERN.test(id)) {
        return { toolCallId: "", content: `错误：非法资源 id：${id}`, isError: true };
      }
      const result = installer.install(id, { confirmed: params.confirmed === true });

      switch (result.status) {
        case "error":
          return { toolCallId: "", content: `错误：${result.message ?? "未知错误"}`, isError: true };
        case "approval_required": {
          const treeLines = renderTree(result.dependencyTree);
          return {
            toolCallId: "",
            content:
              `该资源包含社区未认证资源，需要用户明确确认后才能安装：\n` +
              `\n${treeLines.join("\n")}\n` +
              `\n请向用户说明风险（${result.message ?? "社区资源未经官方审查"}），` +
              `取得确认后调用 butler-market-install 并传入 confirmed: true 重试。`,
          };
        }
        case "already_installed":
          return { toolCallId: "", content: `已安装：${result.name}（${result.id}），无需重复安装。` };
        case "installed": {
          const treeLines = renderTree(result.dependencyTree);
          const installedText = result.installedIds.length > 0 ? result.installedIds.join("、") : result.id;
          const warning = result.warning ? `\n注意：${result.warning}` : "";
          return {
            toolCallId: "",
            content:
              `安装成功：${result.name}（${result.id}）\n` +
              `本次安装：${installedText}\n` +
              `\n依赖结构：\n${treeLines.join("\n")}${warning}`,
          };
        }
      }
    },
  };
}
