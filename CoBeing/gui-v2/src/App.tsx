import { useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { ErrorBoundary } from "@/components/layout/TitleBar";
import { ThemeProvider } from "@/components/shared/ThemeProvider";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useChatPersistence } from "@/hooks/useChatPersistence";
import { useTray } from "@/hooks/useTray";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { TutorialOverlay, isFirstLaunch, markTutorialDone } from "@/components/tutorial/TutorialOverlay";
import { useChatStore } from "@/stores/chat";

function TutorialController({ onFinished }: { onFinished: () => void }) {
  const [showTutorial, setShowTutorial] = useState(() => isFirstLaunch());

  const handleClose = () => {
    markTutorialDone();
    setShowTutorial(false);
    onFinished();
  };

  // Expose a global method so Settings can re-trigger the tutorial
  const openTutorial = () => setShowTutorial(true);
  (window as any).__cobeingOpenTutorial = openTutorial;

  if (!showTutorial) return null;
  return <TutorialOverlay onClose={handleClose} />;
}

// 管家欢迎消息：首次启动教程关闭后注入一次（对话式首启的入口——
// 不再弹问卷，由管家在对话中主动收集用户信息与对管家的喜好）
let butlerWelcomeInjected = false;

function injectButlerWelcomeMessage() {
  if (butlerWelcomeInjected) return;
  butlerWelcomeInjected = true;
  useChatStore.getState().addMessage(
    {
      direction: "out",
      content:
        "你好，我是你的管家 🤖\n\n日常安排、资料整理、创作、工作杂事……都可以交给我；复杂的事，我会帮你组建合适的智能体团队来处理。\n\n先认识一下吧：你平时最想让我帮你处理哪类事？另外，你希望我怎么称呼你、用什么样的方式和你说话？我可以按你的喜好调整。",
      timestamp: Date.now(),
      senderId: "butler",
      senderName: "管家",
    },
    "butler",
  );
}

function App() {
  useWebSocket();
  useChatPersistence();
  useTray();
  useKeyboardShortcuts();
  // 首启时 tutorial 先展示；关闭后注入管家欢迎消息（由管家对话式引导）
  const [tutorialDone, setTutorialDone] = useState(() => !isFirstLaunch());
  useEffect(() => {
    if (tutorialDone) injectButlerWelcomeMessage();
  }, [tutorialDone]);
  return (
    <ThemeProvider>
      <ErrorBoundary>
        <TutorialController onFinished={() => setTutorialDone(true)} />
        <AppLayout />
      </ErrorBoundary>
    </ThemeProvider>
  );
}

export default App;
