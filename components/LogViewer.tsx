
import React from 'react';
import { LogEntry, AppStatus } from '../types';
import { CheckCircle2, AlertCircle, Loader2, Sparkles, LayoutTemplate, Palette, ScanFace, ArrowRight, RefreshCcw, X } from 'lucide-react';

interface LogViewerProps {
  logs: LogEntry[];
  status: AppStatus;
  onClick?: () => void;
  onCancel?: () => void;
  disabled?: boolean;
}

export const LogViewer: React.FC<LogViewerProps> = ({ logs, status, onClick, onCancel, disabled }) => {
  const isIdle = status === AppStatus.IDLE;
  const isProcessing = status === AppStatus.ANALYZING_FACES || status === AppStatus.GENERATING_LAYOUT || status === AppStatus.GENERATING_BACKGROUND;
  
  const getStatusInfo = (s: AppStatus) => {
     switch(s) {
         case AppStatus.IDLE: return { text: "Generate Layout", icon: Sparkles, color: "text-white" };
         case AppStatus.ANALYZING_FACES: return { text: "Detecting Faces", icon: ScanFace, color: "text-blue-400" };
         case AppStatus.GENERATING_LAYOUT: return { text: "Designing Layout", icon: LayoutTemplate, color: "text-indigo-400" };
         case AppStatus.GENERATING_BACKGROUND: return { text: "Creating Texture", icon: Palette, color: "text-pink-400" };
         case AppStatus.READY: return { text: "Mix Complete", icon: CheckCircle2, color: "text-emerald-400" };
         case AppStatus.ERROR: return { text: "Failed", icon: AlertCircle, color: "text-red-400" };
         default: return { text: "Processing", icon: Loader2, color: "text-zinc-400" };
     }
  };

  const currentStatus = getStatusInfo(status);
  const StatusIcon = currentStatus.icon;
  const lastLog = logs.length > 0 ? logs[logs.length - 1] : null;

  const handleClick = (e: React.MouseEvent) => {
      if (isProcessing) return; 
      if (onClick && !disabled) onClick();
  };

  return (
    <button
        onClick={handleClick}
        disabled={disabled && !isProcessing}
        className={`
            w-full h-full min-h-[60px] relative overflow-hidden rounded-lg transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] group flex flex-col justify-center
            ${isIdle 
                ? 'bg-accent hover:bg-accent/90 text-white shadow-[0_0_40px_rgba(59,130,246,0.3)] hover:shadow-[0_0_60px_rgba(59,130,246,0.5)] active:scale-[0.98]' 
                : 'bg-zinc-900/90 border border-white/10 backdrop-blur-xl shadow-2xl p-2.5 text-left'
            }
            ${disabled && isIdle ? 'opacity-40 cursor-not-allowed bg-zinc-800 text-zinc-500 hover:bg-zinc-800 hover:shadow-none' : ''}
            ${!isIdle && !disabled ? 'cursor-pointer hover:border-white/20' : ''}
            ${!isIdle && disabled && !isProcessing ? 'cursor-default' : ''}
            ${isProcessing ? 'cursor-default' : ''}
        `}
    >
        {/* PROCESSING ANIMATION */}
        {isProcessing && (
            <div className="absolute inset-0 pointer-events-none">
                <div className="absolute inset-0 bg-blue-500/5 animate-pulse"></div>
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-blue-500/10 to-transparent w-full h-full -translate-x-full animate-shimmer"></div>
                <div className="absolute bottom-0 left-0 w-full h-[1px] bg-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.5)]"></div>
            </div>
        )}

        {/* IDLE STATE CONTENT */}
        <div className={`
            absolute inset-0 flex items-center justify-center gap-2 transition-all duration-500 transform
            ${isIdle ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 -translate-y-8 scale-95 pointer-events-none'}
        `}>
             <Sparkles size={16} className={disabled ? 'text-zinc-600' : 'text-white'} />
             <span className="font-bold tracking-widest text-xs uppercase">
                {disabled ? 'ADD IMAGES' : 'GENERATE'}
             </span>
             {!disabled && <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />}
        </div>

        {/* ACTIVE/DONE STATE CONTENT */}
        <div className={`
            relative z-10 flex items-center gap-3 transition-all duration-500 transform w-full
            ${isIdle ? 'opacity-0 translate-y-8 scale-95' : 'opacity-100 translate-y-0 scale-100'}
        `}>
             {/* Icon Box */}
            <div className={`
                shrink-0 w-8 h-8 rounded-lg flex items-center justify-center border transition-all duration-500
                ${status === AppStatus.READY ? 'bg-emerald-500/10 border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.2)]' : 
                  status === AppStatus.ERROR ? 'bg-red-500/10 border-red-500/20' :
                  'bg-white/5 border-white/5'}
            `}>
                <StatusIcon 
                    size={16} 
                    className={`
                        ${currentStatus.color} 
                        ${isProcessing ? 'animate-spin' : ''}
                    `} 
                />
            </div>
            
            {/* Text Content */}
            <div className="flex-1 min-w-0 flex flex-col justify-center">
                <div key={status + "-title"} className="flex items-center justify-between animate-in fade-in slide-in-from-bottom-1 duration-300">
                     <span className={`text-[11px] font-bold uppercase tracking-wider ${currentStatus.color}`}>
                        {currentStatus.text}
                     </span>
                     {status === AppStatus.READY && (
                        <div className="flex items-center gap-1.5 px-2 py-0.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full transition-all group-hover:border-emerald-500/30">
                             <RefreshCcw size={10} className="text-zinc-400 group-hover:text-emerald-400 transition-colors" />
                             <span className="text-[10px] font-medium text-zinc-400 group-hover:text-emerald-100 transition-colors">Retry</span>
                        </div>
                     )}
                </div>
                
                <div className="mt-0.5 relative">
                     {lastLog ? (
                        <div key={lastLog.id} className="animate-in fade-in duration-300">
                            <p className="text-[10px] text-zinc-400 font-mono leading-tight break-words whitespace-normal text-left">
                                {lastLog.message}
                            </p>
                        </div>
                     ) : (
                        <p className="text-[10px] text-zinc-600 font-mono text-left">Initializing...</p>
                     )}
                </div>
            </div>

            {/* Cancel Button */}
            {isProcessing && onCancel && (
                <div 
                    onClick={(e) => {
                        e.stopPropagation();
                        onCancel();
                    }}
                    className="absolute top-0 right-0 p-1.5 text-zinc-500 hover:text-red-400 transition-all cursor-pointer z-20"
                    title="Cancel Generation"
                >
                    <X size={14} />
                </div>
            )}
        </div>
    </button>
  );
};
