
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
            w-full h-full min-h-[80px] relative overflow-hidden rounded-2xl transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] group flex flex-col justify-center
            ${isIdle 
                ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-[0_0_40px_rgba(59,130,246,0.3)] hover:shadow-[0_0_60px_rgba(59,130,246,0.5)] active:scale-[0.98]' 
                : 'bg-white/5 border border-white/10 backdrop-blur-xl shadow-2xl p-4 text-left'
            }
            ${disabled && isIdle ? 'opacity-50 cursor-not-allowed bg-white/5 text-zinc-500 hover:bg-white/5 hover:shadow-none border border-white/5' : ''}
            ${!isIdle && !disabled ? 'cursor-pointer hover:border-white/20 hover:bg-white/10' : ''}
            ${!isIdle && disabled && !isProcessing ? 'cursor-default' : ''}
            ${isProcessing ? 'cursor-default border-blue-500/30 bg-blue-500/5' : ''}
        `}
    >
        {/* PROCESSING ANIMATION */}
        {isProcessing && (
            <div className="absolute inset-0 pointer-events-none">
                <div className="absolute inset-0 bg-blue-500/10 animate-pulse"></div>
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-blue-500/20 to-transparent w-full h-full -translate-x-full animate-shimmer"></div>
                <div className="absolute bottom-0 left-0 w-full h-[2px] bg-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.8)]"></div>
            </div>
        )}

        {/* IDLE STATE CONTENT */}
        <div className={`
            absolute inset-0 flex items-center justify-center gap-3 transition-all duration-500 transform
            ${isIdle ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 -translate-y-8 scale-95 pointer-events-none'}
        `}>
             <Sparkles size={20} className={disabled ? 'text-zinc-500' : 'text-white'} />
             <span className="font-bold tracking-widest text-sm uppercase">
                {disabled ? 'ADD IMAGES' : 'GENERATE'}
             </span>
             {!disabled && <ArrowRight size={18} className="group-hover:translate-x-1.5 transition-transform" />}
        </div>

        {/* ACTIVE/DONE STATE CONTENT */}
        <div className={`
            relative z-10 flex items-center gap-4 transition-all duration-500 transform w-full
            ${isIdle ? 'opacity-0 translate-y-8 scale-95' : 'opacity-100 translate-y-0 scale-100'}
        `}>
            {/* Icon Box */}
            <div className={`
                shrink-0 w-10 h-10 rounded-xl flex items-center justify-center border transition-all duration-500
                ${status === AppStatus.READY ? 'bg-emerald-500/10 border-emerald-500/20 shadow-[0_0_20px_rgba(16,185,129,0.1)]' : 
                  status === AppStatus.ERROR ? 'bg-red-500/10 border-red-500/20' :
                  'bg-white/5 border-white/10'}
            `}>
                <StatusIcon 
                    size={20} 
                    className={`
                        ${currentStatus.color} 
                    `} 
                />
            </div>
            
            {/* Text Content */}
            <div className="flex-1 min-w-0 flex flex-col justify-center">
                <div key={status + "-title"} className="flex items-center justify-between animate-in fade-in slide-in-from-bottom-1 duration-300">
                     <span className={`text-xs font-medium uppercase tracking-wider ${currentStatus.color}`}>
                        {currentStatus.text}
                     </span>
                     {status === AppStatus.READY && (
                        <div className="flex items-center gap-1.5 px-3 py-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full transition-all group-hover:border-emerald-500/30">
                             <RefreshCcw size={12} className="text-zinc-400 group-hover:text-emerald-400 transition-colors" />
                             <span className="text-[11px] font-medium text-zinc-400 group-hover:text-emerald-100 transition-colors">Retry</span>
                        </div>
                     )}
                </div>
                
                <div className="mt-1 relative">
                     {lastLog ? (
                        <div key={lastLog.id} className="animate-in fade-in duration-300">
                            <p className="text-xs text-zinc-400 leading-relaxed break-words whitespace-normal text-left">
                                {lastLog.message}
                            </p>
                        </div>
                     ) : (
                        <p className="text-xs text-zinc-500 text-left">Initializing...</p>
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
                    className="absolute top-0 right-0 p-2 text-zinc-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all cursor-pointer z-20"
                    title="Cancel Generation"
                >
                    <X size={16} />
                </div>
            )}
        </div>
    </button>
  );
};
