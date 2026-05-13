import { create } from "zustand";

export type ActivityCategory = "message" | "tool" | "file" | "todo" | "system";

export interface ActivityEntry {
  id: string;
  timestamp: number;
  icon: string;
  text: string;
  level: "info" | "warn" | "error";
  category: ActivityCategory;
  /** 关联的 Agent ID */
  agentId?: string;
  /** 关联的群组 ID */
  groupId?: string;
  /** 结构化名称 — 前端直接渲染样式，不依赖文本正则 */
  agentName?: string;
  groupName?: string;
  fileName?: string;
  /** @mention 目标列表 */
  mentionTargets?: string[];
}

/** 工具调用组 —— 连续的工具调用合并为一组 */
export interface ToolCallGroup {
  id: string;
  agentId: string;
  groupId?: string;
  startTime: number;
  endTime: number;
  calls: ToolCallEntry[];
}

export interface ToolCallEntry {
  id: string;
  toolName: string;
  params?: Record<string, unknown>;
  result?: string;
  status: "start" | "complete";
  timestamp: number;
}

export interface FileChangeEntry {
  id: string;
  timestamp: number;
  agentId: string;
  groupId?: string;
  action: "created" | "modified" | "deleted";
  filename: string;
}

export interface TodoChangeEntry {
  id: string;
  timestamp: number;
  action: "added" | "completed" | "removed";
  title: string;
  scope: "agent" | "group";
  agentId?: string;
  groupId?: string;
}

const MAX_ENTRIES = 500;
const TOOL_GROUP_WINDOW = 5000; // 5 秒内的工具调用合并为一组

interface ActivityStore {
  entries: ActivityEntry[];
  toolGroups: ToolCallGroup[];
  fileChanges: FileChangeEntry[];
  todoChanges: TodoChangeEntry[];

  addEntry: (entry: Omit<ActivityEntry, "category"> & { category?: ActivityCategory }) => void;
  addToolCall: (call: ToolCallEntry, agentId: string, groupId?: string) => void;
  addFileChange: (change: Omit<FileChangeEntry, "id" | "timestamp">) => void;
  addTodoChange: (change: Omit<TodoChangeEntry, "id" | "timestamp">) => void;
  clear: () => void;
}

export const useActivityStore = create<ActivityStore>((set) => ({
  entries: [],
  toolGroups: [],
  fileChanges: [],
  todoChanges: [],

  addEntry: (entry) =>
    set((s) => {
      const full: ActivityEntry = {
        ...entry,
        category: entry.category || "system",
      };
      const next = [...s.entries, full];
      return { entries: next.length > MAX_ENTRIES ? next.slice(-MAX_ENTRIES) : next };
    }),

  addToolCall: (call, agentId, groupId) =>
    set((s) => {
      const groups = [...s.toolGroups];
      const lastGroup = groups[groups.length - 1];

      // 如果最后一个组是同一个 agent 且在时间窗口内，追加到该组
      if (
        lastGroup &&
        lastGroup.agentId === agentId &&
        lastGroup.groupId === groupId &&
        call.timestamp - lastGroup.endTime < TOOL_GROUP_WINDOW
      ) {
        lastGroup.calls.push(call);
        lastGroup.endTime = call.timestamp;
        return { toolGroups: groups };
      }

      // 否则创建新组
      groups.push({
        id: `tg-${call.timestamp}-${Math.random().toString(36).slice(2, 6)}`,
        agentId,
        groupId,
        startTime: call.timestamp,
        endTime: call.timestamp,
        calls: [call],
      });

      return { toolGroups: groups.length > 100 ? groups.slice(-100) : groups };
    }),

  addFileChange: (change) =>
    set((s) => {
      const entry: FileChangeEntry = {
        ...change,
        id: `fc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: Date.now(),
      };
      const next = [...s.fileChanges, entry];
      return { fileChanges: next.length > 200 ? next.slice(-200) : next };
    }),

  addTodoChange: (change) =>
    set((s) => {
      const entry: TodoChangeEntry = {
        ...change,
        id: `tc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: Date.now(),
      };
      const next = [...s.todoChanges, entry];
      return { todoChanges: next.length > 200 ? next.slice(-200) : next };
    }),

  clear: () => set({ entries: [], toolGroups: [], fileChanges: [], todoChanges: [] }),
}));
