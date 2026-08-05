import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const auditedFiles = [
  "components/layout/Surface.tsx",
  "components/layout/MainContent.tsx",
  "components/layout/Sidebar.tsx",
  "components/layout/TitleBar.tsx",
  "components/chat/ChatView.tsx",
  "components/chat/GroupChatView.tsx",
  "components/chat/ChatHeader.tsx",
  "components/chat/ChatInput.tsx",
  "components/chat/ChatInputActions.tsx",
  "components/chat/MessageList.tsx",
  "components/chat/GroupMessageBubble.tsx",
  "components/chat/TaskReceiptCard.tsx",
  "components/chat/ToolCallsGroup.tsx",
  "components/chat/TodoInline.tsx",
  "components/chat/ChatAvatar.tsx",
  "components/chat/ChatMessageFrame.tsx",
  "components/ui/sheet.tsx",
  "components/ui/dialog.tsx",
  "components/ui/tabs.tsx",
  "components/tutorial/TutorialOverlay.tsx",
  "components/todo/GlobalTodoPanel.tsx",
  "components/todo/TodoItem.tsx",
  "components/todo/TodoPanel.tsx",
  "components/todo/TodoKanban.tsx",
  "components/todo/TodoForm.tsx",
  "components/todo/Calendar.tsx",
  "components/todo/Clock.tsx",
  "components/agent/AgentConfigTab.tsx",
  "components/agent/AgentFilesTab.tsx",
  "components/agent/AgentDetailPanel.tsx",
  "components/agent/ButlerConfigPanel.tsx",
  "components/agent/CapabilityTab.tsx",
  "components/agent/CreateAgentDialog.tsx",
  "components/agent/GrowthProposalsTab.tsx",
  "components/agent/TaskInboxTab.tsx",
  "components/group/GroupDetailPanel.tsx",
  "components/group/GroupMembersTab.tsx",
  "components/group/GroupWorkspaceTab.tsx",
  "components/group/GroupConfigTab.tsx",
  "components/group/CreateGroupDialog.tsx",
  "components/group/GroupHealthPanel.tsx",
  "components/shared/CodeBlock.tsx",
  "components/shared/SearchInput.tsx",
  "components/shared/ToggleSwitch.tsx",
  "components/observability/DashboardView.tsx",
  "components/observability/ActiveAgentsPanel.tsx",
  "components/observability/AgentActivityCard.tsx",
  "components/observability/LatencyCard.tsx",
  "components/observability/TokenCard.tsx",
  "components/observability/ToolRankCard.tsx",
  "components/extensions/ExtensionsView.tsx",
  "components/extensions/MarketTab.tsx",
  "components/extensions/PluginsTab.tsx",
  "components/extensions/SkillsTab.tsx",
  "components/extensions/McpsTab.tsx",
  "components/sandbox/SandboxMonitor.tsx",
  "components/settings/SettingsView.tsx",
  "components/settings/AgentTimeline.tsx",
  "components/settings/ChatSearch.tsx",
  "components/settings/LogsSection.tsx",
  "components/settings/ThemeSelector.tsx",
  "components/settings/UserProfileSection.tsx",
  "components/settings/WakeQueueSection.tsx",
  "components/settings/WorkspaceBindingSection.tsx",
];

describe("CoBeing surface style contract", () => {
  it("keeps the core app surfaces on the themed layered system", () => {
    const bannedPatterns = [
      /text-\[(?:9|10|11)px\]/,
      /shadow-(?:xl|2xl)/,
      /bg-card2/,
      /border-border/,
    ];

    for (const file of auditedFiles) {
      const source = readFileSync(resolve(srcDir, file), "utf8");

      for (const pattern of bannedPatterns) {
        expect(source, `${file} should not use ${pattern}`).not.toMatch(pattern);
      }

      source.split(/\r?\n/).forEach((line, index) => {
        const afterTagText = line.split(">").slice(1).join(">");
        const trimmed = line.trim();
        const hasLiteralUnicodeEscapeInJsxText =
          (!afterTagText.includes("\"") && !afterTagText.includes("'") && !afterTagText.includes("`") && /\\u[0-9a-fA-F]{4}/.test(afterTagText))
          || (/^\\u[0-9a-fA-F]{4}/.test(trimmed));

        expect(
          hasLiteralUnicodeEscapeInJsxText,
          `${file}:${index + 1} should not render literal unicode escapes in JSX text`,
        ).toBe(false);
      });
    }
  });

  it("uses the shared workbench layout for the main app surface", () => {
    const mainContent = readFileSync(resolve(srcDir, "components/layout/MainContent.tsx"), "utf8");
    const chatView = readFileSync(resolve(srcDir, "components/chat/ChatView.tsx"), "utf8");
    const groupChatView = readFileSync(resolve(srcDir, "components/chat/GroupChatView.tsx"), "utf8");

    expect(mainContent).toContain("WorkbenchLayout");
    expect(chatView).toContain("sideRail={sideRail}");
    expect(groupChatView).toContain("sideRail={sideRail}");
  });
});
