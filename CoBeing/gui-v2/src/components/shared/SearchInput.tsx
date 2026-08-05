interface SearchInputProps {
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}

export function SearchInput({ placeholder, value, onChange }: SearchInputProps) {
  return (
    <div style={{ padding: 16 }}>
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg px-3 py-1.5 text-sm bg-input border border-bdr text-txt
                   focus:outline-none focus:border-accent/50"
      />
    </div>
  );
}
