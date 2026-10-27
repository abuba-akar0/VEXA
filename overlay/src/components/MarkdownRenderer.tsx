"use client";

import React, { useState } from "react";
import { Check, Copy, Code2, Terminal, FileCode } from "lucide-react";

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  content,
  className = "",
}) => {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const handleCopyCode = (code: string, index: number) => {
    navigator.clipboard.writeText(code);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  if (!content) return null;

  // Normalization: If content has no backticks but starts with code keywords and contains indentation,
  // wrap it into a fenced code block so it renders as a beautiful syntax-highlighted block
  let normalizedContent = content;
  if (!content.includes("```")) {
    const trimmed = content.trim();
    if (
      trimmed.startsWith("def ") ||
      trimmed.startsWith("import ") ||
      trimmed.startsWith("from ") ||
      trimmed.startsWith("class ") ||
      trimmed.startsWith("async def ") ||
      trimmed.startsWith("function ") ||
      trimmed.startsWith("const ") ||
      trimmed.startsWith("let ")
    ) {
      let lang = "python";
      if (trimmed.startsWith("function ") || trimmed.startsWith("const ") || trimmed.startsWith("let ")) {
        lang = "javascript";
      }
      normalizedContent = `\`\`\`${lang}\n${trimmed}\n\`\`\``;
    }
  }

  // Split content into code blocks and non-code blocks
  const parts = normalizedContent.split(/(```[\s\S]*?```)/g);

  return (
    <div className={`space-y-2.5 text-xs text-slate-200 leading-relaxed font-sans ${className}`}>
      {parts.map((part, pIdx) => {
        // Render fenced code block
        if (part.startsWith("```") && part.endsWith("```")) {
          const lines = part.slice(3, -3).trim().split("\n");
          let language = "code";
          let codeLines = lines;
          if (lines.length > 0 && lines[0].trim().length > 0 && !lines[0].includes(" ")) {
            language = lines[0].trim().toLowerCase();
            codeLines = lines.slice(1);
          }
          const rawCode = codeLines.join("\n");

          return (
            <div
              key={pIdx}
              className="my-3 rounded-xl bg-[#0b0f19] border border-cyan-500/25 overflow-hidden shadow-2xl select-text transition-all hover:border-cyan-500/40"
            >
              {/* Code Card Header */}
              <div className="flex items-center justify-between px-3.5 py-2 bg-[#101726] border-b border-white/5 text-[11px] font-mono">
                <div className="flex items-center gap-2">
                  <span className="p-1 rounded bg-cyan-500/15 text-cyan-400">
                    {language === "bash" || language === "sh" || language === "powershell" ? (
                      <Terminal className="w-3.5 h-3.5" />
                    ) : (
                      <FileCode className="w-3.5 h-3.5" />
                    )}
                  </span>
                  <span className="font-semibold uppercase tracking-wider text-cyan-300">
                    {language}
                  </span>
                  <span className="text-slate-500 text-[10px] hidden sm:inline">
                    ({codeLines.length} line{codeLines.length === 1 ? "" : "s"})
                  </span>
                </div>

                {/* Copy Button */}
                <button
                  type="button"
                  onClick={() => handleCopyCode(rawCode, pIdx)}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/5 hover:bg-cyan-500/20 text-slate-300 hover:text-cyan-200 border border-white/5 hover:border-cyan-500/30 transition-all font-mono text-[11px]"
                >
                  {copiedIndex === pIdx ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-400" />
                      <span className="text-emerald-300 font-medium">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>

              {/* Code Gutter & Highlighted Lines */}
              <div className="p-3 text-[11px] font-mono overflow-x-auto leading-relaxed flex">
                {/* Line Numbers */}
                <div className="select-none text-slate-600 text-right pr-3.5 border-r border-white/5 font-mono text-[10px] flex flex-col">
                  {codeLines.map((_, i) => (
                    <span key={i} className="leading-relaxed">
                      {i + 1}
                    </span>
                  ))}
                </div>

                {/* Highlighted Code Content */}
                <div className="pl-3.5 flex-1 overflow-x-auto whitespace-pre font-mono">
                  {codeLines.map((line, lIdx) => (
                    <div key={lIdx} className="leading-relaxed">
                      {highlightSyntax(line, language)}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        }

        // Render regular text, headings, bullet lists, bold, italics
        const lines = part.split("\n");
        return (
          <React.Fragment key={pIdx}>
            {lines.map((line, lIdx) => {
              const trimmed = line.trim();
              if (!trimmed) {
                return <div key={lIdx} className="h-1" />;
              }

              // Heading 1 (# ...)
              if (trimmed.startsWith("# ")) {
                return (
                  <h1
                    key={lIdx}
                    className="text-sm font-bold text-cyan-300 mt-2.5 mb-1 pb-1 border-b border-cyan-500/20 tracking-wide flex items-center gap-2"
                  >
                    <span className="w-1.5 h-3.5 bg-cyan-400 rounded-full" />
                    {renderInlineFormatted(trimmed.slice(2))}
                  </h1>
                );
              }

              // Heading 2 (## ...)
              if (trimmed.startsWith("## ")) {
                return (
                  <h2
                    key={lIdx}
                    className="text-xs font-bold text-cyan-400 mt-2 mb-1 tracking-wide flex items-center gap-1.5"
                  >
                    <span className="w-1 h-2.5 bg-cyan-400/70 rounded-full" />
                    {renderInlineFormatted(trimmed.slice(3))}
                  </h2>
                );
              }

              // Heading 3 (### ...)
              if (trimmed.startsWith("### ")) {
                return (
                  <h3
                    key={lIdx}
                    className="text-[11px] font-semibold text-slate-200 uppercase tracking-wider mt-1.5 mb-0.5"
                  >
                    {renderInlineFormatted(trimmed.slice(4))}
                  </h3>
                );
              }

              // Bullet List Item (- or * or •)
              if (
                trimmed.startsWith("- ") ||
                trimmed.startsWith("* ") ||
                trimmed.startsWith("• ")
              ) {
                return (
                  <div key={lIdx} className="flex items-start gap-2 pl-1.5 my-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 mt-1.5 shrink-0 shadow-[0_0_6px_rgba(6,182,212,0.6)]" />
                    <span className="flex-1 text-slate-200">
                      {renderInlineFormatted(trimmed.slice(2))}
                    </span>
                  </div>
                );
              }

              // Numbered List Item (1. 2. etc)
              const numMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
              if (numMatch) {
                return (
                  <div key={lIdx} className="flex items-start gap-2 pl-1.5 my-0.5">
                    <span className="px-1.5 py-0.2 rounded bg-cyan-500/20 text-cyan-300 font-mono text-[10px] font-bold shrink-0 border border-cyan-500/30">
                      {numMatch[1]}
                    </span>
                    <span className="flex-1 text-slate-200">
                      {renderInlineFormatted(numMatch[2])}
                    </span>
                  </div>
                );
              }

              // Blockquote (> ...)
              if (trimmed.startsWith("> ")) {
                return (
                  <blockquote
                    key={lIdx}
                    className="pl-2.5 py-1 my-1 border-l-2 border-cyan-400 bg-cyan-950/25 rounded-r text-slate-300 italic"
                  >
                    {renderInlineFormatted(trimmed.slice(2))}
                  </blockquote>
                );
              }

              // Horizontal Divider (--- or ***)
              if (trimmed === "---" || trimmed === "***" || trimmed === "___") {
                return <hr key={lIdx} className="border-t border-white/10 my-2.5" />;
              }

              // Standard Paragraph Line
              return (
                <p key={lIdx} className="my-0.5 text-slate-200 leading-relaxed">
                  {renderInlineFormatted(line)}
                </p>
              );
            })}
          </React.Fragment>
        );
      })}
    </div>
  );
};

/**
 * High-performance regex syntax highlighter for code lines
 */
function highlightSyntax(line: string, _lang: string): React.ReactNode {
  if (!line) return <span>&nbsp;</span>;

  // Comments (Python # or JS/C //)
  const commentMatch = line.match(/^(\s*)(#.*|\/\/.*)$/);
  if (commentMatch) {
    return (
      <span>
        {commentMatch[1]}
        <span className="text-slate-500 italic">{commentMatch[2]}</span>
      </span>
    );
  }

  // Check inline comment at end of line
  let mainPart = line;
  let commentSuffix: string | null = null;
  const inlineCommentIdx = line.search(/(\s#|\s\/\/)/);
  if (inlineCommentIdx !== -1) {
    mainPart = line.substring(0, inlineCommentIdx);
    commentSuffix = line.substring(inlineCommentIdx);
  }

  // Tokenize line into strings, keywords, numbers, identifiers, symbols
  const tokenRegex = /(".*?"|'.*?'|`.*?`|\b(?:def|class|return|import|from|as|if|else|elif|for|while|break|continue|try|except|finally|raise|with|async|await|lambda|yield|pass|const|let|var|function|export|default|new|typeof|interface|type|switch|case|in|is|not|and|or)\b|\b(?:True|False|None|true|false|null|undefined|self|this|super|print|len|range|int|str|float|bool|list|dict|set|tuple|console|Math|JSON)\b|\b\d+(?:\.\d+)?\b|[a-zA-Z_]\w*(?=\s*\()|[a-zA-Z_]\w*|[^\s\w])/g;

  const elements: React.ReactNode[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(mainPart)) !== null) {
    // Add plain text before match
    if (match.index > lastIdx) {
      elements.push(mainPart.substring(lastIdx, match.index));
    }

    const token = match[0];

    // String literals
    if (
      (token.startsWith('"') && token.endsWith('"')) ||
      (token.startsWith("'") && token.endsWith("'")) ||
      (token.startsWith("`") && token.endsWith("`"))
    ) {
      elements.push(
        <span key={match.index} className="text-emerald-300 font-medium">
          {token}
        </span>
      );
    }
    // Language Keywords
    else if (
      /^(def|class|return|import|from|as|if|else|elif|for|while|break|continue|try|except|finally|raise|with|async|await|lambda|yield|pass|const|let|var|function|export|default|new|typeof|interface|type|switch|case|in|is|not|and|or)$/.test(
        token
      )
    ) {
      elements.push(
        <span key={match.index} className="text-purple-400 font-semibold">
          {token}
        </span>
      );
    }
    // Builtin Types / Constants
    else if (
      /^(True|False|None|true|false|null|undefined|self|this|super|print|len|range|int|str|float|bool|list|dict|set|tuple|console|Math|JSON)$/.test(
        token
      )
    ) {
      elements.push(
        <span key={match.index} className="text-cyan-300 font-medium">
          {token}
        </span>
      );
    }
    // Numbers
    else if (/^\d+(\.\d+)?$/.test(token)) {
      elements.push(
        <span key={match.index} className="text-amber-300">
          {token}
        </span>
      );
    }
    // Function names followed by (
    else if (
      mainPart[match.index + token.length] === "(" ||
      /^[a-zA-Z_]\w*$/.test(token) && mainPart.substring(match.index + token.length).trim().startsWith("(")
    ) {
      elements.push(
        <span key={match.index} className="text-sky-300 font-semibold">
          {token}
        </span>
      );
    }
    // Identifiers or punctuation
    else {
      elements.push(
        <span key={match.index} className="text-slate-200">
          {token}
        </span>
      );
    }

    lastIdx = tokenRegex.lastIndex;
  }

  // Trailing part of line
  if (lastIdx < mainPart.length) {
    elements.push(mainPart.substring(lastIdx));
  }

  return (
    <span>
      {elements}
      {commentSuffix && <span className="text-slate-500 italic">{commentSuffix}</span>}
    </span>
  );
}

/**
 * Parses inline formatting: **bold**, *italics*, `inline code`
 */
function renderInlineFormatted(text: string): React.ReactNode {
  if (!text) return null;

  // Split by code, bold, italics
  const tokens = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g);

  return tokens.map((tok, i) => {
    // Inline code
    if (tok.startsWith("`") && tok.endsWith("`") && tok.length > 2) {
      return (
        <code
          key={i}
          className="px-1.5 py-0.5 mx-0.5 rounded bg-slate-900 border border-cyan-500/30 font-mono text-cyan-300 text-[11px]"
        >
          {tok.slice(1, -1)}
        </code>
      );
    }

    // Bold (**...**)
    if (tok.startsWith("**") && tok.endsWith("**") && tok.length > 4) {
      return (
        <strong key={i} className="font-bold text-white tracking-wide">
          {tok.slice(2, -2)}
        </strong>
      );
    }

    // Italics (*...*)
    if (tok.startsWith("*") && tok.endsWith("*") && tok.length > 2) {
      return (
        <em key={i} className="italic text-slate-300">
          {tok.slice(1, -1)}
        </em>
      );
    }

    return tok;
  });
}
