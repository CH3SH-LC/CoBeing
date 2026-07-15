import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const auditedFiles = [
  "components/layout/Surface.tsx",
  "components/layout/MainContent.tsx",
  "components/layout/Sidebar.tsx",
  "components/chat/ChatView.tsx",
  "components/chat/GroupChatView.tsx",
  "components/ui/sheet.tsx",
  "components/ui/dialog.tsx",
  "components/tutorial/TutorialOverlay.tsx",
  "components/todo/GlobalTodoPanel.tsx",
  "components/agent/AgentConfigTab.tsx",
  "components/agent/AgentFilesTab.tsx",
  "components/group/GroupDetailPanel.tsx",
  "components/group/GroupMembersTab.tsx",
  "components/group/GroupWorkspaceTab.tsx",
  "components/group/GroupConfigTab.tsx",
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
