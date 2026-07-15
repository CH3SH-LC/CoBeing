import { Component, type ReactNode, useState, useEffect } from "react";

/* ── Error Boundary ── */
interface EBState { hasError: boolean; error?: Error }
export class ErrorBoundary extends Component<{ children: ReactNode }, EBState> {
  state: EBState = { hasError: false };
  static getDerivedStateFromError(error: Error) { return { hasError: true, error }; }
  render() {
    if (this.state.hasError) {
      return (
        <div className="h-screen w-screen flex items-center justify-center bg-surface-solid text-txt p-8">
          <div className="text-center">
            <p className="text-lg font-bold text-danger mb-2">渲染错误</p>
            <p className="text-sm text-txt-muted mb-4">{this.state.error?.message}</p>
            <button
              onClick={() => this.setState({ hasError: false, error: undefined })}
              className="px-4 py-2 rounded-lg bg-accent text-white text-sm"
            >
              重试
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

/* ── Title Bar ── */
export function TitleBar() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const win = getCurrentWindow();
        setMaximized(await win.isMaximized());
        unlisten = await win.onResized(async () => {
          setMaximized(await win.isMaximized());
        });
      } catch { /* browser */ }
    })();
    return () => { unlisten?.(); };
  }, []);

  const handleMinimize = async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().minimize();
    } catch { /* browser */ }
  };

  const handleMaximize = async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().toggleMaximize();
    } catch { /* browser */ }
  };

  const handleClose = async () => {
    try {
      const { exitApp } = await import("@/hooks/useTray");
      await exitApp();
    } catch { /* browser */ }
  };

  return (
    <div
      data-tauri-drag-region
      className="relative flex items-center justify-center bg-surface-solid shrink-0 select-none border-b border-bdr/30"
      style={{ height: 40 }}
    >
      <span
        data-tauri-drag-region
        className="text-sm font-medium text-txt font-display tracking-wide"
      >
        CoBeing
      </span>

      <div className="absolute right-0 flex items-center h-full">
        <button
          onClick={handleMinimize}
          className="flex items-center justify-center text-txt-muted hover:bg-hover transition-colors"
          style={{ width: 46, height: "100%" }}
          title="最小化"
        >
          <svg width="10" height="1" viewBox="0 0 10 1" fill="currentColor"><rect width="10" height="1" /></svg>
        </button>
        <button
          onClick={handleMaximize}
          className="flex items-center justify-center text-txt-muted hover:bg-hover transition-colors"
          style={{ width: 46, height: "100%" }}
          title={maximized ? "向下还原" : "最大化"}
        >
          {maximized ? (
            /* 还原图标: 两个重叠矩形 */
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
              <rect x="2.5" y="0.5" width="7" height="7" />
              <rect x="0.5" y="2.5" width="7" height="7" />
            </svg>
          ) : (
            /* 最大化图标: 单个矩形 */
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
              <rect x="0.5" y="0.5" width="9" height="9" />
            </svg>
          )}
        </button>
        <button
          onClick={handleClose}
          className="flex items-center justify-center text-txt-muted hover:bg-danger hover:text-white transition-colors"
          style={{ width: 46, height: "100%" }}
          title="关闭"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2">
            <line x1="0" y1="0" x2="10" y2="10" />
            <line x1="10" y1="0" x2="0" y2="10" />
          </svg>
        </button>
      </div>
    </div>
  );
}
