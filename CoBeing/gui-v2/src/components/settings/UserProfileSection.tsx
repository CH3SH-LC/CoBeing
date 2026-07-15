import { ChatMessageFrame } from "@/components/chat/ChatMessageFrame";
import {
  DEFAULT_USER_PROFILE,
  createAvatarDraftForType,
  firstDisplayChar,
  type UserAvatarType,
} from "@/lib/userProfile";
import { useUserProfileStore } from "@/stores/userProfile";
import { cn } from "@/lib/utils";

const AVATAR_TYPES: Array<{ value: UserAvatarType; label: string; hint: string }> = [
  { value: "initial", label: "首字", hint: "使用昵称的第一个可见字符" },
  { value: "emoji", label: "Emoji", hint: "使用一个表情或短文本作为头像" },
  { value: "image", label: "图片", hint: "使用图片 URL 或 data URL" },
];

function compactAvatarValue(type: UserAvatarType, value: string, nickname: string): string {
  const trimmed = value.trim();
  if (type === "initial") return firstDisplayChar(trimmed || nickname);
  if (type === "emoji") return Array.from(trimmed).slice(0, 3).join("");
  return value;
}

export function UserProfileSection() {
  const profile = useUserProfileStore((s) => s.profile);
  const setNickname = useUserProfileStore((s) => s.setNickname);
  const setAvatar = useUserProfileStore((s) => s.setAvatar);
  const resetProfile = useUserProfileStore((s) => s.resetProfile);

  const handleAvatarTypeChange = (type: UserAvatarType) => {
    setAvatar(createAvatarDraftForType(type, profile));
  };

  const nicknameInputId = "user-profile-nickname";
  const avatarInputId = "user-profile-avatar-value";

  const valuePlaceholder = profile.avatar.type === "image"
    ? "https://example.com/avatar.png 或 data:image/..."
    : profile.avatar.type === "emoji"
      ? "例如：🌸 / LC"
      : firstDisplayChar(profile.nickname);

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-txt mb-1">个人资料</h2>
        <p className="text-sm text-txt-muted">
          设置你在聊天气泡中显示的昵称和头像。
        </p>
      </div>

      <div
        className="grid min-w-0"
        style={{
          gap: 24,
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))",
        }}
      >
        <section className="rounded-xl bg-elevated" style={{ padding: 20 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div>
              <label htmlFor={nicknameInputId} className="block text-sm font-medium text-txt" style={{ marginBottom: 8 }}>
                昵称
              </label>
              <input
                id={nicknameInputId}
                value={profile.nickname}
                onChange={(event) => setNickname(event.target.value)}
                className="w-full rounded-lg bg-input border border-bdr text-sm text-txt placeholder:text-txt-muted focus:outline-none focus:border-accent/50"
                style={{ padding: "11px 14px" }}
                placeholder={DEFAULT_USER_PROFILE.nickname}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-txt" style={{ marginBottom: 10 }}>
                头像类型
              </label>
              <div
                className="grid"
                role="radiogroup"
                aria-label="头像类型"
                style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}
              >
                {AVATAR_TYPES.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    role="radio"
                    aria-checked={profile.avatar.type === item.value}
                    onClick={() => handleAvatarTypeChange(item.value)}
                    className={cn(
                      "rounded-lg border text-sm font-medium transition-colors",
                      profile.avatar.type === item.value
                        ? "border-accent/50 bg-accent/10 text-accent"
                        : "border-bdr/40 bg-surface text-txt-sub hover:bg-hover hover:text-txt",
                    )}
                    style={{ padding: "10px 8px" }}
                    title={item.hint}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label htmlFor={avatarInputId} className="block text-sm font-medium text-txt" style={{ marginBottom: 8 }}>
                头像内容
              </label>
              <input
                id={avatarInputId}
                value={profile.avatar.value}
                onChange={(event) => setAvatar({
                  ...profile.avatar,
                  value: compactAvatarValue(profile.avatar.type, event.target.value, profile.nickname),
                })}
                className="w-full rounded-lg bg-input border border-bdr text-sm text-txt placeholder:text-txt-muted focus:outline-none focus:border-accent/50"
                style={{ padding: "11px 14px" }}
                placeholder={valuePlaceholder}
              />
              <p className="text-xs text-txt-muted" style={{ marginTop: 8 }}>
                图片头像支持 URL 或 data URL；加载失败时会回退为昵称首字。
              </p>
            </div>

            <div className="flex items-center justify-between" style={{ gap: 12 }}>
              <div className="text-sm text-txt-muted">
                当前：{profile.avatar.type === "initial" ? "首字头像" : profile.avatar.type === "emoji" ? "Emoji 头像" : "图片头像"}
              </div>
              <button
                type="button"
                onClick={resetProfile}
                className="rounded-lg bg-surface text-sm font-medium text-txt-sub hover:bg-hover hover:text-txt transition-colors"
                style={{ padding: "10px 14px" }}
              >
                恢复默认
              </button>
            </div>
          </div>
        </section>

        <section
          className="rounded-xl bg-surface border border-bdr/40"
          style={{ padding: 24, boxShadow: "var(--shadow-surface)" }}
        >
            <div className="flex items-center justify-between" style={{ marginBottom: 20, gap: 12 }}>
            <div>
              <h3 className="text-sm font-semibold text-txt">聊天预览</h3>
              <p className="text-sm text-txt-muted" style={{ marginTop: 4 }}>
                预览会跟随当前主题的消息气泡颜色。
              </p>
            </div>
            <span className="rounded-full bg-accent/10 text-accent text-xs font-medium" style={{ padding: "4px 10px" }}>
              实时
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <ChatMessageFrame
              side="left"
              senderName="CoBeing"
              avatar={{ type: "initial", value: "C" }}
              avatarTone="assistant"
              bubbleTone="assistant"
            >
              <div className="text-sm text-txt">
                你好，我会在这里陪你整理任务、想法和对话上下文。
              </div>
            </ChatMessageFrame>

            <ChatMessageFrame
              side="right"
              senderName={profile.nickname}
              avatar={profile.avatar}
              avatarTone="user"
              bubbleTone="user"
            >
              <div className="whitespace-pre-wrap text-sm text-txt">
                这是我的新资料。之后聊天里就用这个名字和头像吧。
              </div>
            </ChatMessageFrame>
          </div>
        </section>
      </div>
    </div>
  );
}
