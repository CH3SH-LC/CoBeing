import { AppLayout } from "@/components/layout/AppLayout";
import { ErrorBoundary } from "@/components/layout/TitleBar";
import { ThemeProvider } from "@/components/shared/ThemeProvider";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useChatPersistence } from "@/hooks/useChatPersistence";
import { useTray } from "@/hooks/useTray";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";

function App() {
  useWebSocket();
  useChatPersistence();
  useTray();
  useKeyboardShortcuts();
  return (
    <ThemeProvider>
      <ErrorBoundary>
        <AppLayout />
      </ErrorBoundary>
    </ThemeProvider>
  );
}

export default App;
