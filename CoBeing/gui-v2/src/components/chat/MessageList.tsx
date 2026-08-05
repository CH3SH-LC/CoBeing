import { useRef, useEffect } from "react";
import type { LogMessage } from "@/lib/types";
import { MessageBubble } from "./MessageBubble";
import { ThinkingBubble } from "./ThinkingBubble";

export function MessageList({ messages, streamBuffer, waiting }: {
  messages: LogMessage[]; streamBuffer: string; waiting: boolean;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const prevLenRef = useRef(messages.length);
  const isFirstRender = useRef(true);
  const userScrolledUp = useRef(false);

  // Track manual scroll position
  const handleScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    userScrolledUp.current = distFromBottom > 100;
  };

  // Auto-scroll: only when user hasn't scrolled up, or it's first render
  useEffect(() => {
    const prevLen = prevLenRef.current;
    prevLenRef.current = messages.length;
    const instant = isFirstRender.current || prevLen === 0;
    isFirstRender.current = false;
    // Reset scroll lock when a new user message arrives (scroll to latest)
    if (messages.length > prevLen && messages.length > 0) {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg.direction === "in") userScrolledUp.current = false;
    }
    if (!userScrolledUp.current) {
      const el = scrollContainerRef.current;
      if (el) {
        el.scrollTo({ top: el.scrollHeight, behavior: instant ? "instant" : "smooth" });
      }
    }
  }, [messages, streamBuffer]);

  if (messages.length === 0 && !waiting) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center" style={{ padding: 24 }}>
        <p className="text-txt-muted text-sm">开始新的对话</p>
      </div>
    );
  }

  return (
    <div ref={scrollContainerRef} onScroll={handleScroll} className="h-full min-h-0 overflow-y-auto" style={{ padding: "24px 24px" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {messages.map((msg, i) => (
          <MessageBubble key={i} msg={msg} />
        ))}
        {waiting && <ThinkingBubble buffer={streamBuffer} />}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
