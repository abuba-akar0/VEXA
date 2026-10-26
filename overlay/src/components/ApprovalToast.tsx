"use client";

import React from "react";
import { AlertTriangle, CheckCircle, XCircle } from "lucide-react";

interface ApprovalToastProps {
  approvalData: {
    action?: {
      action_type?: string;
      command?: string;
      path?: string;
      reasoning?: string;
    };
  } | null;
  onApprove: () => void;
  onReject: () => void;
}

export const ApprovalToast: React.FC<ApprovalToastProps> = ({
  approvalData,
  onApprove,
  onReject,
}) => {
  if (!approvalData) return null;

  const action = approvalData.action || {};

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="glass-panel w-[460px] rounded-2xl p-6 border border-amber-500/40 shadow-glow-magenta flex flex-col gap-4">
        {/* Header */}
        <div className="flex items-center gap-3 text-amber-400">
          <div className="p-2.5 rounded-full bg-amber-500/20 border border-amber-500/30">
            <AlertTriangle className="w-6 h-6 text-amber-400" />
          </div>
          <div>
            <h3 className="font-bold text-base text-white">Confirmation Required</h3>
            <p className="text-xs text-amber-200/80">Destructive or irreversible action detected</p>
          </div>
        </div>

        {/* Action Details */}
        <div className="bg-slate-900/90 rounded-xl p-3.5 border border-white/10 text-xs font-mono flex flex-col gap-1.5">
          <div className="text-slate-400 flex justify-between">
            <span>Action Type:</span>
            <span className="text-amber-300 font-semibold">{action.action_type || "require_approval"}</span>
          </div>

          {action.command && (
            <div className="flex flex-col gap-0.5 mt-1">
              <span className="text-slate-400">Command:</span>
              <span className="text-rose-300 bg-black/40 p-1.5 rounded break-all">{action.command}</span>
            </div>
          )}

          {action.path && (
            <div className="flex flex-col gap-0.5 mt-1">
              <span className="text-slate-400">Target Path:</span>
              <span className="text-cyan-300 bg-black/40 p-1.5 rounded break-all">{action.path}</span>
            </div>
          )}

          {action.reasoning && (
            <div className="mt-2 text-slate-300 italic text-[11px] font-sans">
              "{action.reasoning}"
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            onClick={onReject}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-white/10 transition-colors"
          >
            <XCircle className="w-4 h-4 text-slate-400" />
            Cancel
          </button>

          <button
            onClick={onApprove}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-900/50 transition-colors"
          >
            <CheckCircle className="w-4 h-4" />
            Approve & Execute
          </button>
        </div>
      </div>
    </div>
  );
};
