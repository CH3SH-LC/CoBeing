import { useState, useMemo } from "react";

interface CalendarProps {
  value: string; // "YYYY-MM-DD"
  onChange: (date: string) => void;
}

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfWeek(year: number, month: number) {
  const day = new Date(year, month, 1).getDay();
  return day === 0 ? 6 : day - 1; // Monday = 0
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function formatYMD(year: number, month: number, day: number) {
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

export function Calendar({ value, onChange }: CalendarProps) {
  const today = new Date();
  const todayStr = formatYMD(today.getFullYear(), today.getMonth(), today.getDate());

  const [viewYear, viewMonth] = useMemo(() => {
    if (value) {
      const parts = value.split("-");
      return [parseInt(parts[0]), parseInt(parts[1]) - 1];
    }
    return [today.getFullYear(), today.getMonth()];
  }, [value]);

  const [year, setYear] = useState(viewYear);
  const [month, setMonth] = useState(viewMonth);

  // Sync when value changes externally
  useMemo(() => {
    if (value) {
      const parts = value.split("-");
      const vy = parseInt(parts[0]);
      const vm = parseInt(parts[1]) - 1;
      setYear(vy);
      setMonth(vm);
    }
  }, [value]);

  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfWeek(year, month);

  const cells = useMemo(() => {
    const result: Array<{ day: number; dateStr: string; isCurrentMonth: boolean }> = [];

    // Previous month trailing days
    const prevMonth = month === 0 ? 11 : month - 1;
    const prevYear = month === 0 ? year - 1 : year;
    const prevDays = getDaysInMonth(prevYear, prevMonth);
    for (let i = firstDay - 1; i >= 0; i--) {
      const d = prevDays - i;
      result.push({ day: d, dateStr: formatYMD(prevYear, prevMonth, d), isCurrentMonth: false });
    }

    // Current month
    for (let d = 1; d <= daysInMonth; d++) {
      result.push({ day: d, dateStr: formatYMD(year, month, d), isCurrentMonth: true });
    }

    // Next month leading days
    const nextMonth = month === 11 ? 0 : month + 1;
    const nextYear = month === 11 ? year + 1 : year;
    const remaining = 42 - result.length;
    for (let d = 1; d <= remaining; d++) {
      result.push({ day: d, dateStr: formatYMD(nextYear, nextMonth, d), isCurrentMonth: false });
    }

    return result;
  }, [year, month, daysInMonth, firstDay]);

  const prevMonthLabel = () => {
    if (month === 0) {
      setYear(year - 1);
      setMonth(11);
    } else {
      setMonth(month - 1);
    }
  };

  const nextMonthLabel = () => {
    if (month === 11) {
      setYear(year + 1);
      setMonth(0);
    } else {
      setMonth(month + 1);
    }
  };

  const MONTH_NAMES = [
    "1月", "2月", "3月", "4月", "5月", "6月",
    "7月", "8月", "9月", "10月", "11月", "12月",
  ];

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
        <button
          type="button"
          className="rounded-lg hover:bg-hover text-txt-sub text-sm transition-colors"
          style={{ padding: "4px 8px" }}
          onClick={prevMonthLabel}
        >
          ‹
        </button>
        <span className="text-sm font-medium text-txt">
          {year}年 {MONTH_NAMES[month]}
        </span>
        <button
          type="button"
          className="rounded-lg hover:bg-hover text-txt-sub text-sm transition-colors"
          style={{ padding: "4px 8px" }}
          onClick={nextMonthLabel}
        >
          ›
        </button>
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7" style={{ marginBottom: 4 }}>
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            className="text-center text-xs text-txt-muted font-medium"
            style={{ padding: "4px 0" }}
          >
            {d}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7">
        {cells.map((cell) => {
          const isSelected = cell.dateStr === value;
          const isToday = cell.dateStr === todayStr;

          return (
            <button
              key={cell.dateStr}
              type="button"
              className={`
                relative text-sm rounded-lg transition-colors
                ${!cell.isCurrentMonth ? "text-txt-muted/40" : ""}
                ${cell.isCurrentMonth && !isSelected && !isToday ? "text-txt hover:bg-hover" : ""}
                ${isToday && !isSelected ? "text-accent font-medium" : ""}
                ${isSelected ? "bg-accent text-white font-medium" : ""}
              `}
              style={{ padding: "6px 0", aspectRatio: "1" }}
              onClick={() => onChange(cell.dateStr)}
            >
              {cell.day}
            </button>
          );
        })}
      </div>
    </div>
  );
}
