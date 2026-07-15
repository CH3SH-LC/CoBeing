import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ChatAvatar } from "./ChatAvatar";
import type { UserAvatar } from "@/lib/userProfile";

interface ChatMessageFrameProps {
  side: "left" | "right";
  senderName: string;
  timestamp?: string;
  status?: ReactNode;
  avatar?: UserAvatar;
  avatarTone?: "user" | "assistant" | "group" | "muted";
  bubbleTone: "user" | "assistant" | "system" | "tool";
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}

const bubbleToneClass: Record<ChatMessageFrameProps["bubbleTone"], string> = {
  user: "bg-msg-user rounded-br-md",
  assistant: "bg-msg-assistant rounded-bl-md",
  system: "bg-msg-system",
  tool: "bg-msg-tool",
};

export function ChatMessageFrame({
  side,
  senderName,
  timestamp,
  status,
  avatar,
  avatarTone,
  bubbleTone,
  children,
  footer,
  className,
}: ChatMessageFrameProps) {
  const isRight = side === "right";

  return (
    <div
      className={cn(
        "flex w-full items-end gap-3",
        isRight ? "justify-end" : "justify-start",
        className,
      )}
      style={isRight ? { paddingRight: 24 } : { paddingLeft: 24 }}
    >
      {!isRight && (
        <ChatAvatar name={senderName} avatar={avatar} tone={avatarTone ?? "assistant"} />
      )}
      <div
        className={cn(
          "max-w-[min(70%,720px)] rounded-2xl text-sm text-txt shadow-sm",
          bubbleToneClass[bubbleTone],
        )}
        style={{ padding: "16px 24px", lineHeight: 1.65 }}
      >
        <div className="flex flex-wrap items-center gap-2" style={{ marginBottom: 8 }}>
          <span
            className={cn(
              "text-sm font-semibold",
              isRight ? "text-accent" : avatarTone === "group" ? "text-purple" : "text-success",
            )}
          >
            {senderName}
          </span>
          {timestamp && <span className="text-xs text-txt-muted">{timestamp}</span>}
          {status}
        </div>
        {children}
        {footer}
      </div>
      {isRight && (
        <ChatAvatar name={senderName} avatar={avatar} tone={avatarTone ?? "user"} />
      )}
    </div>
  );
}
