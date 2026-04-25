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
    <div className="my-2 rounded-lg overflow-hidden border border-bdr">
      {/* 顶部栏 */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#282c34] border-b border-bdr">
        <span className="text-xs text-[#abb2bf]/60 font-mono">{language || "code"}</span>
        <button
          onClick={handleCopy}
          className="text-xs text-[#abb2bf]/60 hover:text-[#abb2bf] transition-colors font-mono flex items-center gap-1"
        >
          {copied ? (
            <>&#10003; 已复制</>
          ) : (
            <>&#128203; 复制</>
          )}
        </button>
      </div>
      {/* 代码内容 */}
      <pre className="code-block-pre !m-0 !rounded-none !border-0 bg-[#282c34] !p-3 overflow-x-auto">
        <code className={className}>{children}</code>
      </pre>
    </div>
  );
}
