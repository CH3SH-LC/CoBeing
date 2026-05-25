import { useState, useEffect } from "react";

const TUTORIAL_KEY = "cobeing_tutorial_done";

export function isFirstLaunch(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(TUTORIAL_KEY) !== "true";
}

export function markTutorialDone(): void {
  localStorage.setItem(TUTORIAL_KEY, "true");
}

export function resetTutorial(): void {
  localStorage.removeItem(TUTORIAL_KEY);
}

interface Step {
  title: string;
  subtitle: string;
  content: string;
}

const STEPS: Step[] = [
  {
    title: "欢迎使用 CoBeing",
    subtitle: "多智能体协作框架",
    content: `CoBeing 是一个让 AI Agents 组队干活的平台。

你可以创建不同角色的 AI Agent，让它们单独完成任务，或者组队协作处理复杂项目。

• **管家 (Butler)** — 你的第一联系人，用自然语言管理一切
• **Agent** — 拥有独立性格和能力的 AI 助手
• **群组** — 多个 Agent 组队协作完成复杂任务`,
  },
  {
    title: "和管家对话",
    subtitle: "你的第一联系人",
    content: `左侧列表第一个就是**管家**。它是你的入口。

你可以直接跟管家说：
• "帮我写一个 Python 快排"
• "当前目录下有什么文件？"
• "帮我创建一个前端专家"

管家会直接执行或帮你创建需要的 Agent。

> 提示：管家说话像一个靠谱的朋友，直接回答不啰嗦。`,
  },
  {
    title: "创建 Agent",
    subtitle: "拥有专业能力的 AI 队友",
    content: `有两种方式创建 Agent：

**方式一：让管家创建（推荐）**
直接跟管家说："帮我创建一个前端开发专家"

**方式二：通过 GUI 手动创建**
1. 点击侧边栏底部的 **[+ 创建]** 按钮
2. 填写名称和角色
3. 选择 Provider 和模型

每个 Agent 有独立的性格（SOUL.md）、职责（JOB.md）和经验（EXPERIENCE.md），会在使用中不断成长。`,
  },
  {
    title: "群组协作",
    subtitle: "让 Agent 们组队干活",
    content: `群组是 CoBeing 的核心。多个 Agent 可以在群组中协作完成复杂任务。

**创建群组：**
• 让管家创建："创建一个开发团队"
• 或手动创建：侧边栏切换到 Groups → [+ 创建]

**群组如何工作：**
1. **群主** 分析任务并分解为子任务
2. 各 Agent 领取任务并执行
3. Agent 可主动求助、汇报进度
4. 分歧可通过投票解决
5. 群主审核验收

你可以在群组聊天中实时观看 Agent 们的协作过程。`,
  },
  {
    title: "设置与配置",
    subtitle: "按需连接 LLM",
    content: `点击顶部导航栏的 ⚙ 进入设置页：

**Providers** — 可选配置 AI 模型的 API Key
支持 DeepSeek、智谱 GLM、通义千问、MiniMax、火山引擎/豆包、Moonshot/Kimi、小米 MiMo 共 7 家厂商
> 无 Provider 也能查看界面，发送消息前再配置即可

**QQ Bot** — 接入 QQ 与 Agent 对话
**主题** — 切换 6 种视觉主题`,
  },
  {
    title: "开始探索",
    subtitle: "准备好了！",
    content: `你已经了解了 CoBeing 的核心功能。

**下一步可以试试：**
1. 和管家聊天，让它帮你完成一些任务
2. 创建一个 Agent，给它分配专业角色
3. 组建一个群组，让多个 Agent 协作

> 所有数据存储在本地，不上传云端。
> 遇到问题可以随时在设置 → 关于中重新打开本教程。

祝你使用愉快！ 🎉`,
  },
];

/** Safely render inline **bold** formatting */
function FormattedText({ text }: { text: string }) {
  const parts = text.split(/(\*\*.*?\*\*)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return <strong key={i}>{part.slice(2, -2)}</strong>;
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

/** Safely render content with **bold**, bullet lists, and blockquotes */
function SafeContent({ content }: { content: string }) {
  const lines = content.split("\n");
  const nodes: React.ReactNode[] = [];

  let bulletGroup: string[] = [];
  let keyCounter = 0;

  const flushBullets = () => {
    if (bulletGroup.length > 0) {
      nodes.push(
        <ul key={keyCounter++} className="list-disc pl-4 my-2 space-y-0.5">
          {bulletGroup.map((b, i) => (
            <li key={i}>
              <FormattedText text={b} />
            </li>
          ))}
        </ul>
      );
      bulletGroup = [];
    }
  };

  for (const line of lines) {
    if (line.startsWith("• ")) {
      bulletGroup.push(line.slice(2));
    } else {
      flushBullets();
      if (line === "") {
        nodes.push(<div key={keyCounter++} className="h-2" />);
      } else if (line.startsWith("> ")) {
        nodes.push(
          <div key={keyCounter++} className="border-l-2 border-accent pl-3 my-1 italic text-txt-muted">
            <FormattedText text={line.slice(2)} />
          </div>
        );
      } else {
        nodes.push(
          <p key={keyCounter++} className="mb-1">
            <FormattedText text={line} />
          </p>
        );
      }
    }
  }
  flushBullets();

  return <>{nodes}</>;
}

export function TutorialOverlay({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;
  const isFirst = step === 0;

  const handleNext = () => {
    if (isLast) {
      markTutorialDone();
      setVisible(false);
      setTimeout(onClose, 200);
    } else {
      setStep(step + 1);
    }
  };

  const handleSkip = () => {
    markTutorialDone();
    setVisible(false);
    setTimeout(onClose, 200);
  };

  const handlePrev = () => {
    if (!isFirst) setStep(step - 1);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{
        backgroundColor: "var(--overlay)",
        opacity: visible ? 1 : 0,
        transition: "opacity 200ms ease",
      }}
    >
      <div
        className="w-[520px] max-w-[90vw] rounded-2xl shadow-2xl overflow-hidden bg-surface-solid border border-bdr"
        style={{
          transform: visible ? "translateY(0)" : "translateY(20px)",
          transition: "transform 200ms ease",
        }}
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-txt-muted">
              {step + 1} / {STEPS.length}
            </span>
            <button
              onClick={handleSkip}
              className="text-xs px-3 py-1 rounded-lg hover:bg-hover transition-colors text-txt-muted"
            >
              跳过
            </button>
          </div>
          <h2 className="text-2xl font-bold mb-1 text-accent">
            {current.title}
          </h2>
          <p className="text-sm font-medium text-purple">
            {current.subtitle}
          </p>
        </div>

        {/* Content */}
        <div className="px-6 py-4 max-h-[40vh] overflow-y-auto">
          <div className="text-sm leading-relaxed text-txt-sub">
            <SafeContent content={current.content} />
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-5 flex items-center justify-between border-t border-bdr">
          <button
            onClick={handlePrev}
            className="px-4 py-2 rounded-xl text-sm font-medium transition-colors"
            style={{
              color: isFirst ? "var(--color-txt-muted)" : "var(--color-txt-sub)",
              cursor: isFirst ? "default" : "pointer",
              visibility: isFirst ? "hidden" : "visible",
            }}
          >
            ← 上一步
          </button>

          <div className="flex gap-1.5">
            {STEPS.map((_, i) => (
              <div
                key={i}
                className="rounded-full transition-all"
                style={{
                  backgroundColor: i === step ? "var(--color-accent)" : "var(--color-bdr)",
                  height: 6,
                  width: i === step ? 20 : 6,
                }}
              />
            ))}
          </div>

          <button
            onClick={handleNext}
            className="px-5 py-2 rounded-xl text-sm font-semibold transition-colors hover:opacity-90 bg-accent text-white"
          >
            {isLast ? "开始使用" : "下一步 →"}
          </button>
        </div>
      </div>
    </div>
  );
}
