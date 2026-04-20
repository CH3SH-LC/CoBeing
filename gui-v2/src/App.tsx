import { AppLayout } from "@/components/layout/AppLayout";
import { ThemeProvider } from "@/components/shared/ThemeProvider";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useTray } from "@/hooks/useTray";

function App() {
  useWebSocket();
  useTray();
  return (
    <ThemeProvider>
      <AppLayout />
    </ThemeProvider>
  );
}

export default App;
