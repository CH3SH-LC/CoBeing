import { useChatStore } from "@/stores/chat";
import { useAgentsStore } from "@/stores/agents";
import { useUserProfileStore } from "@/stores/userProfile";
import type { LogMessage, TaskReceipt } from "@/lib/types";
import { getSenderDisplay, statusStyle, statusLabel, formatTime } from "@/lib/chat-utils";
import { MarkdownContent } from "@/components/shared/MarkdownContent";
import { ChatMessageFrame } from "./ChatMessageFrame";
import { TaskReceiptCard } from "./TaskReceiptCard";
import { ToolCallsGroup } from "./ToolCallsGroup";

export function MessageBubble({ msg }: { msg: LogMessage }) {
  const activeConv = useChatStore((s) => s.activeConversation);
  const agents = useAgentsStore((s) => s.agents);
  const userProfile = useUserProfileStore((s) => s.profile);
  if (msg.direction === "system") {
    return (
      <div className="flex justify-center" style={{ padding: "8px 0" }}>
        <div className="rounded-full bg-msg-system/60 text-xs text-accent-warm" style={{ padding: "8px 20px" }}>
          {msg.content}
        </div>
      </div>
    );
  }

  const isUser = msg.direction === "in";
  const senderName = getSenderDisplay(msg, activeConv, agents, userProfile.nickname);

  return (
    <ChatMessageFrame
      side={isUser ? "right" : "left"}
      senderName={senderName}
      timestamp={formatTime(msg.timestamp)}
      status={
        <>
          {isUser && msg.status && msg.status !== "done" && (
            <span className={`text-xs ${statusStyle(msg.status)}`}>
              {statusLabel[msg.status]}
            </span>
          )}
          {isUser && msg.status === "error" && msg.errorMessage && (
            <span className="text-xs text-danger" title={msg.errorMessage}>
              ({msg.errorMessage.slice(0, 30)})
            </span>
          )}
        </>
      }
      avatar={isUser ? userProfile.avatar : undefined}
      avatarTone={isUser ? "user" : "assistant"}
      bubbleTone={isUser ? "user" : "assistant"}
    >
        {!isUser && msg.toolCalls && msg.toolCalls.length > 0 && (
          <ToolCallsGroup toolCalls={msg.toolCalls} />
        )}
        <div className="text-sm text-txt leading-relaxed">
          {isUser ? <div className="whitespace-pre-wrap">{msg.content}</div> : <MarkdownContent content={msg.content} />}
        </div>
        {!isUser && msg.metadata?.taskReceipt && (
          <TaskReceiptCard receipt={msg.metadata.taskReceipt as TaskReceipt} />
        )}
    </ChatMessageFrame>
  );
}
