import { useState } from "react";
import { firstDisplayChar, type UserAvatar } from "@/lib/userProfile";
import { cn } from "@/lib/utils";

interface ChatAvatarProps {
  name: string;
  avatar?: UserAvatar;
  tone?: "user" | "assistant" | "group" | "muted";
  className?: string;
}

const toneClass: Record<NonNullable<ChatAvatarProps["tone"]>, string> = {
  user: "bg-accent/12 text-accent",
  assistant: "bg-success/12 text-success",
  group: "bg-purple/12 text-purple",
  muted: "bg-elevated text-txt-sub",
};

export function ChatAvatar({ name, avatar, tone = "assistant", className }: ChatAvatarProps) {
  const [failedImageSrc, setFailedImageSrc] = useState<string | null>(null);
  const imageValue = avatar?.type === "image" ? avatar.value.trim() : "";
  const label = avatar?.type === "image" ? firstDisplayChar(name) : avatar?.value?.trim() || firstDisplayChar(name);

  if (imageValue && failedImageSrc !== imageValue) {
    return (
      <div
        className={cn(
          "h-10 w-10 shrink-0 overflow-hidden rounded-xl border border-bdr/40 bg-elevated",
          className,
        )}
        title={name}
      >
        <img
          src={imageValue}
          alt=""
          aria-hidden="true"
          className="h-full w-full object-cover"
          onError={() => {
            setFailedImageSrc(imageValue);
          }}
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "h-10 w-10 shrink-0 rounded-xl border border-bdr/30 flex items-center justify-center overflow-hidden text-center text-sm font-semibold leading-none",
        toneClass[tone],
        className,
      )}
      title={name}
    >
      <span className="max-w-full truncate px-1">{label}</span>
    </div>
  );
}
