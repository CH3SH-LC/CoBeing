import { useState } from "react";

interface ClockProps {
  hour: number;   // 0-23
  minute: number; // 0-59
  onChange: (hour: number, minute: number) => void;
}

const SIZE = 240;
const CENTER = SIZE / 2;
const RADIUS = 100;
const NUMBER_RADIUS = 78;
const MINUTE_RADIUS = 82;

function polarToXY(angle: number, radius: number) {
  const rad = ((angle - 90) * Math.PI) / 180;
  return {
    x: CENTER + radius * Math.cos(rad),
    y: CENTER + radius * Math.sin(rad),
  };
}

export function Clock({ hour, minute, onChange }: ClockProps) {
  const [mode, setMode] = useState<"hour" | "minute">("hour");

  const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  const handAngle = mode === "hour"
    ? (displayHour % 12) * 30
    : minute * 6;

  const handleHourClick = (h: number) => {
    const isPM = hour >= 12;
    const newHour = h === 12 ? (isPM ? 12 : 0) : (isPM ? h + 12 : h);
    onChange(newHour, minute);
    setMode("minute");
  };

  const handleMinuteClick = (m: number) => {
    onChange(hour, m);
  };

  const togglePeriod = () => {
    onChange(hour >= 12 ? hour - 12 : hour + 12, minute);
  };

  const handEnd = polarToXY(handAngle, mode === "hour" ? 50 : 62);

  return (
    <div className="flex flex-col items-center">
      {/* Digital display */}
      <div
        className="flex items-center rounded-xl bg-surface-solid border border-bdr/30"
        style={{ padding: "8px 16px", marginBottom: 16, gap: 4 }}
      >
        <button
          type="button"
          className={`text-2xl font-mono rounded-lg transition-colors px-2 py-1 ${
            mode === "hour" ? "bg-accent/15 text-accent" : "text-txt hover:bg-hover"
          }`}
          onClick={() => setMode("hour")}
        >
          {pad(hour)}
        </button>
        <span className="text-2xl text-txt-muted font-mono">:</span>
        <button
          type="button"
          className={`text-2xl font-mono rounded-lg transition-colors px-2 py-1 ${
            mode === "minute" ? "bg-accent/15 text-accent" : "text-txt hover:bg-hover"
          }`}
          onClick={() => setMode("minute")}
        >
          {pad(minute)}
        </button>
        <button
          type="button"
          className="text-xs font-medium rounded-lg bg-elevated text-txt-sub hover:text-txt transition-colors"
          style={{ padding: "4px 8px", marginLeft: 8 }}
          onClick={togglePeriod}
        >
          {hour >= 12 ? "PM" : "AM"}
        </button>
      </div>

      {/* Clock face */}
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="select-none"
      >
        {/* Outer ring */}
        <circle
          cx={CENTER}
          cy={CENTER}
          r={RADIUS}
          fill="var(--color-elevated)"
          stroke="var(--color-bdr)"
          strokeWidth={1}
          strokeOpacity={0.3}
        />

        {/* Hour numbers — only in hour mode */}
        {mode === "hour" &&
          Array.from({ length: 12 }, (_, i) => {
            const h = i + 1;
            const pos = polarToXY(h * 30, NUMBER_RADIUS);
            const isSelected = displayHour === h;
            return (
              <text
                key={h}
                x={pos.x}
                y={pos.y}
                textAnchor="middle"
                dominantBaseline="central"
                style={{
                  fontSize: 14,
                  fontWeight: isSelected ? 600 : 400,
                  fill: isSelected ? "var(--color-accent)" : "var(--color-txt-sub)",
                  cursor: "pointer",
                }}
                onClick={() => handleHourClick(h)}
              >
                {h}
              </text>
            );
          })}

        {/* Minute markers */}
        {mode === "minute" &&
          Array.from({ length: 12 }, (_, i) => {
            const m = i * 5;
            const pos = polarToXY(m * 6, MINUTE_RADIUS);
            const isSelected = minute === m;
            return (
              <g key={m} onClick={() => handleMinuteClick(m)} style={{ cursor: "pointer" }}>
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r={isSelected ? 16 : 14}
                  fill={isSelected ? "var(--color-accent)" : "transparent"}
                />
                <text
                  x={pos.x}
                  y={pos.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  style={{
                    fontSize: 12,
                    fontWeight: isSelected ? 600 : 400,
                    fill: isSelected ? "#fff" : "var(--color-txt-sub)",
                  }}
                >
                  {pad(m)}
                </text>
              </g>
            );
          })}

        {/* Hour hand — only in hour mode */}
        {mode === "hour" && (
          <line
            x1={CENTER}
            y1={CENTER}
            x2={handEnd.x}
            y2={handEnd.y}
            stroke="var(--color-accent)"
            strokeWidth={2.5}
            strokeLinecap="round"
          />
        )}

        {/* Minute hand — only in minute mode */}
        {mode === "minute" && (
          <line
            x1={CENTER}
            y1={CENTER}
            x2={handEnd.x}
            y2={handEnd.y}
            stroke="var(--color-accent)"
            strokeWidth={2}
            strokeLinecap="round"
          />
        )}

        {/* Center dot */}
        <circle cx={CENTER} cy={CENTER} r={4} fill="var(--color-accent)" />
      </svg>

      {/* Mode hint */}
      <p className="text-xs text-txt-muted" style={{ marginTop: 8 }}>
        {mode === "hour" ? "点击选择小时" : "点击选择分钟"}
      </p>
    </div>
  );
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}
