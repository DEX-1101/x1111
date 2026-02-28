
import React, { useRef } from 'react';
import { Upload, X as CloseIcon, SquareDashed, Type, Minus, Plus, Ratio, Sparkles, Droplets, Trash2 } from 'lucide-react';
import { ImageItem, LogEntry, AppStatus, AspectRatio, WatermarkSettings, GlobalBlurSettings } from '../types';
import { LogViewer } from './LogViewer';

const ASPECT_RATIOS: AspectRatio[] = ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16"];

interface ImageUploaderProps {
  images: ImageItem[];
  onAddImages: (files: File[]) => void;
  onRemoveImage: (id: string) => void;
  onClear: () => void;
  maxImages: number;
  logs: LogEntry[];
  status: AppStatus;
  onGenerate: () => void;
  onCancel: () => void;
  // Integrated Controls Props
  aspectRatio: AspectRatio;
  onAspectRatioChange: (ratio: AspectRatio) => void;
  showBorders: boolean;
  onToggleBorders: () => void;
  labelScale: number;
  onAdjustLabelScale: (delta: number) => void;
  isBusy: boolean;
  watermark: WatermarkSettings;
  onWatermarkChange: (w: WatermarkSettings) => void;
  globalBlur: GlobalBlurSettings;
  onGlobalBlurChange: (b: GlobalBlurSettings) => void;
}

export const ImageUploader: React.FC<ImageUploaderProps> = ({ 
  images, 
  onAddImages, 
  onRemoveImage,
  onClear,
  maxImages,
  logs,
  status,
  onGenerate,
  onCancel,
  aspectRatio,
  onAspectRatioChange,
  showBorders,
  onToggleBorders,
  labelScale,
  onAdjustLabelScale,
  isBusy,
  watermark,
  onWatermarkChange,
  globalBlur,
  onGlobalBlurChange
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      onAddImages(Array.from(e.target.files));
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const remaining = maxImages - images.length;

  return (
    <div className="w-full flex flex-col gap-6">
      {/* Controls Toolbar */}
      <div className="flex flex-col md:flex-row items-start md:items-end justify-between gap-5 border-b border-white/5 pb-5">
            
            <div className="flex flex-col gap-5 flex-1 w-full">
                {/* Top Row: Aspect & Visuals */}
                <div className="flex flex-wrap items-end gap-6 justify-between w-full">
                    {/* Aspect Ratio Selector */}
                    <div className="flex flex-col gap-2.5">
                        <div className="flex items-center gap-2 text-[10px] font-mono text-zinc-500 uppercase tracking-widest">
                            <Ratio size={12} />
                            <span>Canvas Format</span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {ASPECT_RATIOS.map(ratio => (
                                <button
                                    key={ratio}
                                    onClick={() => onAspectRatioChange(ratio)}
                                    disabled={isBusy}
                                    className={`
                                        relative px-2.5 py-1 rounded-md text-[10px] font-bold font-mono transition-all border
                                        ${aspectRatio === ratio 
                                            ? 'bg-zinc-100 text-black border-zinc-100 shadow-[0_0_15px_rgba(255,255,255,0.1)]' 
                                            : 'bg-zinc-800/40 text-zinc-500 border-white/5 hover:border-white/20 hover:text-zinc-300'
                                        }
                                        ${isBusy ? 'opacity-50 cursor-not-allowed' : ''}
                                    `}
                                >
                                    {ratio}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Basic Visual Tools */}
                    <div className="flex items-center gap-4">
                        {/* Border Toggle */}
                        <button
                            onClick={onToggleBorders}
                            className={`
                                h-8 px-3 rounded-md flex items-center justify-center gap-2 transition-all border
                                ${showBorders 
                                    ? 'bg-zinc-800 text-zinc-200 border-white/20 shadow-sm' 
                                    : 'bg-transparent text-zinc-600 border-transparent hover:bg-zinc-800/50 hover:text-zinc-400'
                                }
                            `}
                            title="Toggle Borders"
                        >
                            <SquareDashed size={14} />
                            <span className="text-[10px] font-mono font-bold">BORDER</span>
                        </button>

                        <div className="h-5 w-px bg-white/10"></div>

                        {/* Blur Control */}
                        <div className="flex items-center gap-2 bg-zinc-900/50 border border-white/5 rounded-md p-0.5 pr-2">
                            <button 
                                onClick={() => onGlobalBlurChange({...globalBlur, enabled: !globalBlur.enabled})}
                                className={`
                                    h-7 px-2 rounded-sm flex items-center justify-center gap-2 transition-all
                                    ${globalBlur.enabled
                                        ? 'bg-zinc-700 text-white shadow-sm' 
                                        : 'text-zinc-500 hover:text-zinc-300'
                                    }
                                `}
                                title="Toggle Global Blur"
                            >
                                <Droplets size={14} />
                            </button>
                            
                            {globalBlur.enabled && (
                                <div className="w-16 animate-in fade-in slide-in-from-left-2 duration-200">
                                    <input 
                                        type="range" 
                                        min="0" 
                                        max="20" 
                                        step="1" 
                                        value={globalBlur.amount} 
                                        onChange={(e) => onGlobalBlurChange({...globalBlur, amount: parseInt(e.target.value)})}
                                        className="w-full h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer"
                                        title={`Blur Amount: ${globalBlur.amount}px`}
                                    />
                                </div>
                            )}
                        </div>

                        <div className="h-5 w-px bg-white/10"></div>

                        {/* Label Scale */}
                        <div className="flex items-center gap-1 bg-zinc-900/50 border border-white/5 rounded-md p-0.5">
                            <button 
                                onClick={() => onAdjustLabelScale(-0.1)}
                                className="w-7 h-7 flex items-center justify-center text-zinc-500 hover:text-white hover:bg-white/5 rounded-sm transition-colors"
                                title="Decrease Label Size"
                            >
                                <Minus size={12} />
                            </button>
                            
                            <div className="w-8 flex justify-center" title="Label Size">
                                <Type size={12} className="text-zinc-400" />
                            </div>

                            <button 
                                onClick={() => onAdjustLabelScale(0.1)}
                                className="w-7 h-7 flex items-center justify-center text-zinc-500 hover:text-white hover:bg-white/5 rounded-sm transition-colors"
                                title="Increase Label Size"
                            >
                                <Plus size={12} />
                            </button>
                        </div>
                    </div>
                </div>

                {/* Watermark Section */}
                <div className="w-full bg-zinc-950/30 border border-white/5 rounded-lg p-3 flex flex-col md:flex-row items-center gap-4 transition-all">
                     <div className="flex items-center gap-3 min-w-[120px]">
                         <div className="flex items-center gap-2 text-[10px] font-mono text-zinc-500 uppercase tracking-widest">
                            <Sparkles size={12} /> Watermark
                         </div>
                         <button 
                            onClick={() => onWatermarkChange({...watermark, enabled: !watermark.enabled})}
                            className={`w-8 h-4 rounded-full p-0.5 transition-colors flex items-center shadow-inner ${watermark.enabled ? 'bg-accent justify-end' : 'bg-zinc-700 justify-start'}`}
                         >
                             <div className="w-3 h-3 bg-white rounded-full shadow-sm" />
                         </button>
                     </div>
                     
                     <div className={`flex flex-1 items-center gap-4 w-full transition-opacity duration-300 ${!watermark.enabled ? 'opacity-30 pointer-events-none' : 'opacity-100'}`}>
                         <input 
                            type="text" 
                            value={watermark.text}
                            onChange={(e) => onWatermarkChange({...watermark, text: e.target.value})}
                            placeholder="Enter text..."
                            className="bg-zinc-900 border border-white/10 rounded px-3 py-1.5 text-xs text-white font-mono w-full md:w-40 focus:border-accent outline-none"
                         />
                         
                         <div className="flex items-center gap-1 border-l border-white/5 pl-4">
                             <button 
                                onClick={() => onWatermarkChange({...watermark, icon: watermark.icon === 'x' ? 'none' : 'x'})}
                                className={`w-8 h-8 rounded flex items-center justify-center border transition-all ${watermark.icon === 'x' ? 'bg-white border-white text-black' : 'bg-zinc-800 border-white/5 text-zinc-500 hover:text-zinc-300'}`}
                                title="X (Twitter)"
                             >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                  <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" />
                                </svg>
                             </button>
                             <button 
                                onClick={() => onWatermarkChange({...watermark, icon: watermark.icon === 'patreon' ? 'none' : 'patreon'})}
                                className={`w-8 h-8 rounded flex items-center justify-center border transition-all ${watermark.icon === 'patreon' ? 'bg-[#FF424D] border-[#FF424D] text-white' : 'bg-zinc-800 border-white/5 text-zinc-500 hover:text-zinc-300'}`}
                                title="Patreon"
                             >
                                <svg width="14" height="14" viewBox="0 0 512 512" fill="currentColor" fillRule="evenodd" clipRule="evenodd" strokeLinejoin="round" strokeMiterlimit="2">
                                    <g transform="matrix(.47407 0 0 .47407 .383 .422)">
                                        <clipPath id="prefix__a"><path d="M0 0h1080v1080H0z"/></clipPath>
                                        <g clipPath="url(#prefix__a)">
                                            <path d="M1033.05 324.45c-.19-137.9-107.59-250.92-233.6-291.7-156.48-50.64-362.86-43.3-512.28 27.2-181.1 85.46-237.99 272.66-240.11 459.36-1.74 153.5 13.58 557.79 241.62 560.67 169.44 2.15 194.67-216.18 273.07-321.33 55.78-74.81 127.6-95.94 216.01-117.82 151.95-37.61 255.51-157.53 255.29-316.38z" fillRule="nonzero"/>
                                        </g>
                                    </g>
                                </svg>
                             </button>
                         </div>

                         <div className="flex items-center gap-4 border-l border-white/5 pl-4 flex-1">
                             <div className="flex flex-col gap-1 flex-1">
                                <label className="text-[9px] font-mono text-zinc-500">OPACITY</label>
                                <input type="range" min="0" max="1" step="0.1" value={watermark.opacity} onChange={(e) => onWatermarkChange({...watermark, opacity: parseFloat(e.target.value)})} className="h-1.5 w-full bg-zinc-700 rounded-lg appearance-none cursor-pointer" />
                             </div>
                             <div className="flex flex-col gap-1 flex-1">
                                <label className="text-[9px] font-mono text-zinc-500">SIZE</label>
                                <input type="range" min="0.5" max="3" step="0.1" value={watermark.size} onChange={(e) => onWatermarkChange({...watermark, size: parseFloat(e.target.value)})} className="h-1.5 w-full bg-zinc-700 rounded-lg appearance-none cursor-pointer" />
                             </div>
                             <div className="flex flex-col gap-1 flex-1">
                                <label className="text-[9px] font-mono text-zinc-500">LOGO SIZE</label>
                                <input 
                                    type="range" 
                                    min="0.5" 
                                    max="2.5" 
                                    step="0.1" 
                                    value={watermark.iconScale ?? 1} 
                                    onChange={(e) => onWatermarkChange({...watermark, iconScale: parseFloat(e.target.value)})} 
                                    disabled={watermark.icon === 'none'}
                                    className={`h-1.5 w-full bg-zinc-700 rounded-lg appearance-none cursor-pointer ${watermark.icon === 'none' ? 'opacity-30' : ''}`} 
                                />
                             </div>
                         </div>
                     </div>
                </div>
            </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest flex items-center gap-2">
            Input Sources
          </h2>
          <div className="flex items-center gap-3">
             {images.length > 0 && (
                <button 
                    type="button"
                    onClick={onClear}
                    className="text-[10px] font-mono text-red-400 hover:text-red-300 transition-colors flex items-center gap-1.5 bg-zinc-900/50 hover:bg-zinc-900 px-2 py-0.5 rounded border border-transparent hover:border-red-500/20"
                    title="Clear All Inputs"
                >
                    <Trash2 size={10} /> CLEAR ALL
                </button>
             )}
            <span className="text-[10px] font-mono text-zinc-600 bg-zinc-900 px-2 py-0.5 rounded-full border border-white/5">
                {images.length} / {maxImages}
            </span>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row gap-4">
            {/* Image Grid Area */}
            <div className="flex-1 grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-6 xl:grid-cols-8 gap-2 content-start">
              {images.map((img, index) => (
              <div key={img.id} className="relative group aspect-square bg-surface rounded-sm overflow-hidden border border-white/5 shadow-sm">
                  <img src={img.url} alt="upload" className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-500" />
                  <div className="absolute top-1 left-1 font-mono text-[9px] text-white bg-black/50 px-1 rounded-xs backdrop-blur-sm">
                  0{index + 1}
                  </div>
                  <button 
                  onClick={() => onRemoveImage(img.id)}
                  className="absolute top-1 right-1 p-1 bg-red-500/80 text-white rounded-xs opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
                  >
                  <CloseIcon size={10} />
                  </button>
              </div>
              ))}
              
              {remaining > 0 && (
              <button 
                  onClick={() => fileInputRef.current?.click()}
                  className="aspect-square flex flex-col items-center justify-center border border-dashed border-white/20 hover:border-accent/50 hover:bg-white/5 transition-all text-gray-500 hover:text-accent rounded-sm"
              >
                  <Upload size={14} />
                  <span className="text-[9px] mt-1 font-mono">ADD</span>
              </button>
              )}
            </div>

            {/* Action Panel / Log Viewer */}
            <div className="w-full lg:w-96 shrink-0 flex flex-col">
                <LogViewer 
                    logs={logs}
                    status={status}
                    onClick={onGenerate}
                    onCancel={onCancel}
                    disabled={images.length === 0}
                />
            </div>
        </div>
      </div>

      <input 
        type="file" 
        multiple 
        accept="image/*" 
        className="hidden" 
        ref={fileInputRef} 
        onChange={handleFileChange}
        disabled={remaining <= 0}
      />
    </div>
  );
};
