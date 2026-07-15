import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SurfaceCardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  tone?: "panel" | "solid" | "elevated" | "input";
  padding?: number | string;
  gap?: number;
}

const toneClass = {
  panel: "bg-surface border border-bdr/40",
  solid: "bg-surface-solid border border-bdr/40",
  elevated: "bg-elevated border border-bdr/30",
  input: "bg-input border border-bdr/30",
};

export function SurfaceCard({
  children,
  tone = "panel",
  padding = 20,
  gap,
  className,
  style,
  ...props
}: SurfaceCardProps) {
  const mergedStyle: CSSProperties = {
    padding,
    boxShadow: tone === "input" ? undefined : "var(--shadow-surface)",
    gap,
    ...style,
  };

  return (
    <div
      className={cn("rounded-xl min-w-0", toneClass[tone], className)}
      style={mergedStyle}
      {...props}
    >
      {children}
    </div>
  );
}

interface WorkbenchLayoutProps {
  header: ReactNode;
  body: ReactNode;
  input?: ReactNode;
  sideRail?: ReactNode;
  fullBleed?: boolean;
}

export function WorkbenchLayout({ header, body, input, sideRail, fullBleed = false }: WorkbenchLayoutProps) {
  return (
    <div
      className="flex-1 grid h-full min-h-0 min-w-0 overflow-hidden"
      style={{
        padding: 20,
        gap: 20,
        gridTemplateRows: "auto minmax(0, 1fr)",
        gridTemplateColumns: sideRail ? "minmax(260px, 300px) minmax(0, 1fr)" : "minmax(0, 1fr)",
      }}
    >
      {sideRail && (
        <div className="min-h-0" style={{ gridRow: "1 / span 2" }}>
          {sideRail}
        </div>
      )}
      <div className="min-w-0">{header}</div>
      <SurfaceCard
        className="flex min-h-0 flex-col overflow-hidden"
        padding={fullBleed ? 0 : 20}
        style={{ minHeight: 0 }}
      >
        <div className="min-h-0 flex-1 overflow-hidden">{body}</div>
        {input && (
          <div
            className="shrink-0 border-t border-bdr/30"
            style={{ padding: "18px 20px 20px" }}
          >
            {input}
          </div>
        )}
      </SurfaceCard>
    </div>
  );
}
