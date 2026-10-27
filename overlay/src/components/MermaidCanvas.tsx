"use client";

import React, { useEffect, useRef, useState } from "react";
import { Maximize2, Minimize2, X, Copy, Check, FolderPlus, Move } from "lucide-react";

interface MermaidCanvasProps {
  diagramCode: string;
  title: string;
  onClose: () => void;
  onScaffold: (code: string) => void;
  onDragStateChange?: (dragging: boolean) => void;
  onBoundsChange?: () => void;
}

export const MermaidCanvas: React.FC<MermaidCanvasProps> = ({
  diagramCode,
  title,
  onClose,
  onScaffold,
  onDragStateChange,
  onBoundsChange,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svgContent, setSvgContent] = useState<string>("");
  const [copied, setCopied] = useState<boolean>(false);
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);
  const [scale, setScale] = useState<number>(1);
  const [position, setPosition] = useState<{ x: number; y: number }>({ x: 40, y: 120 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const dragRef = useRef<{ startX: number; startY: number; posX: number; posY: number }>({
    startX: 0,
    startY: 0,
    posX: 40,
    posY: 120,
  });

  useEffect(() => {
    if (typeof window !== "undefined") {
      const initX = Math.max(20, Math.round((window.innerWidth - 640) / 2));
      const initY = Math.max(60, Math.round((window.innerHeight - 520) / 2));
      setPosition({ x: initX, y: initY });
      dragRef.current.posX = initX;
      dragRef.current.posY = initY;
    }
  }, []);

  useEffect(() => {
    onBoundsChange?.();
  }, [position, isCollapsed, scale, onBoundsChange]);

  useEffect(() => {
    let isMounted = true;
    const renderDiagram = async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: "dark",
          themeVariables: {
            darkMode: true,
            background: "transparent",
            mainBkg: "#1e293b",
            nodeBorder: "#38bdf8",
            primaryColor: "#0284c7",
            primaryTextColor: "#f8fafc",
            lineColor: "#00f0ff",
            secondaryColor: "#ff007f",
            tertiaryColor: "#0f172a",
          },
          securityLevel: "loose",
        });

        const id = `mermaid-${Date.now()}`;
        const { svg } = await mermaid.render(id, diagramCode);
        if (isMounted) {
          setSvgContent(svg);
          setTimeout(() => onBoundsChange?.(), 100);
        }
      } catch (err) {
        console.error("Mermaid render error:", err);
        if (isMounted) {
          setSvgContent(`<div class="text-red-400 p-4 text-xs font-mono">Failed to render diagram: ${err}</div>`);
        }
      }
    };

    if (diagramCode) {
      renderDiagram();
    }

    return () => {
      isMounted = false;
    };
  }, [diagramCode, onBoundsChange]);

  // Dragging logic
  const handleMouseDown = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest("button") || target.closest("a")) return;
    e.preventDefault();
    setIsDragging(true);
    onDragStateChange?.(true);
    if (typeof window !== "undefined") {
      import("@tauri-apps/api/core").then(({ invoke }) => {
        invoke("set_dragging_mode", { dragging: true }).catch(() => {});
      });
    }
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      posX: position.x,
      posY: position.y,
    };
  };

  useEffect(() => {
    if (!isDragging) return;
    const handleMouseMove = (e: MouseEvent) => {
      e.preventDefault();
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      // Multi-Monitor Support: Allow free movement across all displays
      const newX = dragRef.current.posX + dx;
      const newY = Math.max(10, dragRef.current.posY + dy);
      setPosition({ x: newX, y: newY });
    };

    const handleMouseUp = (e: MouseEvent) => {
      e.preventDefault();
      setIsDragging(false);
      onDragStateChange?.(false);
      if (typeof window !== "undefined") {
        import("@tauri-apps/api/core").then(({ invoke }) => {
          invoke("set_dragging_mode", { dragging: false }).catch(() => {});
        });
      }
      onBoundsChange?.();
    };

    window.addEventListener("mousemove", handleMouseMove, { capture: true });
    window.addEventListener("mouseup", handleMouseUp, { capture: true });
    return () => {
      window.removeEventListener("mousemove", handleMouseMove, { capture: true });
      window.removeEventListener("mouseup", handleMouseUp, { capture: true });
    };
  }, [isDragging, onDragStateChange, onBoundsChange]);

  const handleCopy = () => {
    navigator.clipboard.writeText(diagramCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      onMouseEnter={() => {
        if (typeof window !== "undefined") {
          import("@tauri-apps/api/core").then(({ invoke }) => {
            invoke("set_hover_mode", { hovered: true }).catch(() => {});
          });
        }
      }}
      onMouseLeave={() => {
        if (typeof window !== "undefined") {
          import("@tauri-apps/api/core").then(({ invoke }) => {
            invoke("set_hover_mode", { hovered: false }).catch(() => {});
          });
        }
      }}
      style={{ left: `${position.x}px`, top: `${position.y}px` }}
      className="fixed z-40 w-[640px] glass-panel rounded-xl shadow-glow overflow-hidden transition-shadow duration-300 border border-cyan-500/30 interactive-hud-element pointer-events-auto select-none"
    >
      {/* Title Bar / Drag Handle */}
      <div
        onMouseDown={handleMouseDown}
        className="flex items-center justify-between px-3.5 py-2.5 bg-slate-900/80 cursor-grab active:cursor-grabbing border-b border-white/10 select-none"
      >
        <div className="flex items-center gap-2 text-xs font-semibold text-cyan-300">
          <Move className="w-3.5 h-3.5 text-slate-400" />
          <span>{title || "Architecture Blueprint"}</span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => onScaffold(diagramCode)}
            className="flex items-center gap-1 text-[11px] bg-cyan-500/20 hover:bg-cyan-500/40 text-cyan-200 border border-cyan-500/40 px-2 py-0.5 rounded transition-colors"
            title="Scaffold boilerplate to workspace"
          >
            <FolderPlus className="w-3 h-3" />
            Scaffold to Repo
          </button>

          <button
            onClick={handleCopy}
            className="p-1 text-slate-400 hover:text-white transition-colors"
            title="Copy Mermaid Code"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>

          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="p-1 text-slate-400 hover:text-white transition-colors"
            title={isCollapsed ? "Expand" : "Collapse"}
          >
            {isCollapsed ? <Maximize2 className="w-3.5 h-3.5" /> : <Minimize2 className="w-3.5 h-3.5" />}
          </button>

          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-red-400 transition-colors"
            title="Close"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Diagram Canvas */}
      {!isCollapsed && (
        <div className="p-4 bg-slate-950/60 max-h-[460px] overflow-auto flex flex-col items-center justify-center">
          {/* Zoom Controls */}
          <div className="self-end flex items-center gap-1 mb-2 text-[10px] text-slate-400">
            <button
              onClick={() => setScale((s) => Math.max(0.5, s - 0.15))}
              className="px-1.5 py-0.5 bg-white/5 hover:bg-white/10 rounded"
            >
              -
            </button>
            <span>{Math.round(scale * 100)}%</span>
            <button
              onClick={() => setScale((s) => Math.min(2.0, s + 0.15))}
              className="px-1.5 py-0.5 bg-white/5 hover:bg-white/10 rounded"
            >
              +
            </button>
            <button
              onClick={() => setScale(1)}
              className="px-1.5 py-0.5 bg-white/5 hover:bg-white/10 rounded ml-1"
            >
              Reset
            </button>
          </div>

          <div
            ref={containerRef}
            style={{ transform: `scale(${scale})`, transformOrigin: "top center" }}
            className="w-full flex items-center justify-center transition-transform duration-100"
            dangerouslySetInnerHTML={{ __html: svgContent }}
          />
        </div>
      )}
    </div>
  );
};
