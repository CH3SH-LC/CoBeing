import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { ErrorBoundary } from "@/components/layout/TitleBar";
import { ThemeProvider } from "@/components/shared/ThemeProvider";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useChatPersistence } from "@/hooks/useChatPersistence";
import { useTray } from "@/hooks/useTray";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { TutorialOverlay, isFirstLaunch, markTutorialDone } from "@/components/tutorial/TutorialOverlay";

function TutorialController() {
  const [showTutorial, setShowTutorial] = useState(() => isFirstLaunch());

  const handleClose = () => {
    markTutorialDone();
    setShowTutorial(false);
  };

  // Expose a global method so Settings can re-trigger the tutorial
  const openTutorial = () => setShowTutorial(true);
  (window as any).__cobeingOpenTutorial = openTutorial;

  if (!showTutorial) return null;
  return <TutorialOverlay onClose={handleClose} />;
}

function App() {
  useWebSocket();
  useChatPersistence();
  useTray();
  useKeyboardShortcuts();
  return (
    <ThemeProvider>
      <ErrorBoundary>
        <TutorialController />
        <AppLayout />
      </ErrorBoundary>
    </ThemeProvider>
  );
}

export default App;
