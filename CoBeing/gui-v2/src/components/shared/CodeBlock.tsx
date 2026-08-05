import { useState, useCallback } from "react";

interface CodeBlockProps {
  className?: string;
  children: React.ReactNode;
}

export function CodeBlock({ className, children }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  // 提取语言标签
  const language = className?.replace("language-", "") || "";
  const codeText = String(children).replace(/\n$/, "");

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(codeText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [codeText]);

  return (
    <div className="my-2 rounded-xl overflow-hidden border border-bdr">
      {/* 顶部栏 */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-bdr"
           style={{ backgroundColor: "var(--code-header-bg)" }}>
        <span className="text-xs font-mono" style={{ color: "var(--code-header-fg)", opacity: 0.6 }}>{language || "code"}</span>
        <button
          onClick={handleCopy}
          className="text-xs transition-colors font-mono flex items-center gap-1"
          style={{ color: "var(--code-header-fg)", opacity: 0.6 }}
          onMouseEnter={(e) => { (e.target as HTMLElement).style.opacity = "1"; }}
          onMouseLeave={(e) => { (e.target as HTMLElement).style.opacity = "0.6"; }}
        >
          {copied ? (
            <>&#10003; 已复制</>
          ) : (
            <>&#128203; 复制</>
          )}
        </button>
      </div>
      {/* 代码内容 */}
      <pre className="code-block-pre !m-0 !rounded-none !border-0 !p-3 overflow-x-auto"
           style={{ backgroundColor: "var(--code-header-bg)", color: "var(--hljs-fg)" }}>
        <code className={className}>{children}</code>
      </pre>
    </div>
  );
}
