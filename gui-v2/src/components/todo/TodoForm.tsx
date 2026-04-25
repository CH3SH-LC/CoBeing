import { useState, type FormEvent } from "react";
import { Calendar } from "./Calendar";
import { Clock } from "./Clock";

interface TodoFormProps {
  onSubmit: (data: {
    title: string;
    description: string;
    triggerAt: string;
    recurrenceHint: string;
  }) => void;
  onCancel: () => void;
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function toLocalISOString(date: string, hour: number, minute: number) {
  // date = "YYYY-MM-DD", combine into local ISO string
  return `${date}T${pad(hour)}:${pad(minute)}:00`;
}

export function TodoForm({ onSubmit, onCancel }: TodoFormProps) {
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(todayStr);
  const [hour, setHour] = useState(now.getHours());
  const [minute, setMinute] = useState(0);
  const [recurrenceHint, setRecurrenceHint] = useState("");

  const handleTimeChange = (h: number, m: number) => {
    setHour(h);
    setMinute(m);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !date) return;
    onSubmit({
      title: title.trim(),
      description: description.trim(),
      triggerAt: toLocalISOString(date, hour, minute),
      recurrenceHint: recurrenceHint.trim() || "不重复",
    });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col" style={{ gap: 20 }}>
      {/* 标题 */}
      <div>
        <label className="block text-sm text-txt-sub" style={{ marginBottom: 6 }}>标题</label>
        <input
          className="w-full bg-input border border-bdr/40 rounded-xl text-sm text-txt focus:outline-none focus:border-accent transition-colors"
          style={{ padding: "10px 14px" }}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="TODO 标题"
        />
      </div>

      {/* 描述 */}
      <div>
        <label className="block text-sm text-txt-sub" style={{ marginBottom: 6 }}>描述</label>
        <textarea
          className="w-full bg-input border border-bdr/40 rounded-xl text-sm text-txt focus:outline-none focus:border-accent transition-colors resize-none"
          style={{ padding: "10px 14px" }}
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="触发时要做什么"
        />
      </div>

      {/* 触发时间：日历 + 时钟 */}
      <div>
        <label className="block text-sm text-txt-sub" style={{ marginBottom: 10 }}>触发时间</label>
        <div className="flex flex-col" style={{ gap: 16 }}>
          {/* 日历 */}
          <div
            className="bg-elevated rounded-xl border border-bdr/30"
            style={{ padding: 16 }}
          >
            <Calendar value={date} onChange={setDate} />
          </div>

          {/* 时钟 */}
          <div
            className="bg-elevated rounded-xl border border-bdr/30 flex items-center justify-center"
            style={{ padding: 16 }}
          >
            <Clock hour={hour} minute={minute} onChange={handleTimeChange} />
          </div>
        </div>
      </div>

      {/* 重复提示 */}
      <div>
        <label className="block text-sm text-txt-sub" style={{ marginBottom: 6 }}>重复</label>
        <input
          className="w-full bg-input border border-bdr/40 rounded-xl text-sm text-txt focus:outline-none focus:border-accent transition-colors"
          style={{ padding: "10px 14px" }}
          value={recurrenceHint}
          onChange={(e) => setRecurrenceHint(e.target.value)}
          placeholder="留空表示不重复，例如：每天9点、每周一上午10点、每月1号"
        />
        <p className="text-xs text-txt-muted" style={{ marginTop: 4 }}>
          描述重复规则，AI 会根据提示自动创建下一次 TODO
        </p>
      </div>

      {/* 按钮 */}
      <div className="flex" style={{ gap: 10 }}>
        <button
          type="submit"
          className="rounded-xl bg-accent text-white text-sm font-medium transition-opacity hover:opacity-90"
          style={{ padding: "10px 24px" }}
        >
          创建
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl bg-hover text-txt-sub text-sm transition-colors hover:text-txt"
          style={{ padding: "10px 24px" }}
        >
          取消
        </button>
      </div>
    </form>
  );
}
