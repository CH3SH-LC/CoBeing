import { useChatStore } from "@/stores/chat";
import { useAgentsStore } from "@/stores/agents";
import { useUserProfileStore } from "@/stores/userProfile";
import type { LogMessage } from "@/lib/types";
import { getSenderDisplay } from "@/lib/chat-utils";
import { MarkdownContent } from "@/components/shared/MarkdownContent";
import { ChatMessageFrame } from "./ChatMessageFrame";

export function ThinkingBubble({ buffer }: { buffer: string }) {
  const activeConv = useChatStore((s) => s.activeConversation);
  const agents = useAgentsStore((s) => s.agents);
  const userProfile = useUserProfileStore((s) => s.profile);
  const senderName = getSenderDisplay({ direction: "out" } as LogMessage, activeConv, agents, userProfile.nickname);

  return (
    <ChatMessageFrame
      side="left"
      senderName={buffer ? `${senderName} (回复中)` : "思考中..."}
      avatarTone="assistant"
      bubbleTone="assistant"
      status={
        <span className="relative flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-success" />
        </span>
      }
    >
        <div className="flex items-center gap-2 sr-only" style={{ marginBottom: 8 }}>
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-success" />
          </span>
          <span className="text-sm font-bold text-success">
            {buffer ? `${senderName} (回复中)` : "思考中..."}
          </span>
        </div>
        <div className="text-sm text-txt leading-relaxed">
          {buffer ? <MarkdownContent content={buffer} /> : "思考中..."}
        </div>
    </ChatMessageFrame>
  );
}
