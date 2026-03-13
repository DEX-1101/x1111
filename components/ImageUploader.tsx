
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
    <div className="w-full flex flex-col gap-8">
      {/* Controls Toolbar */}
      <div className="flex flex-col md:flex-row items-start md:items-end justify-between gap-6 border-b border-white/10 pb-6">
            
            <div className="flex flex-col gap-6 flex-1 w-full">
                {/* Top Row: Aspect & Visuals */}
                <div className="flex flex-wrap items-end gap-6 justify-between w-full">
                    {/* Aspect Ratio Selector */}
                    <div className="flex flex-col gap-3">
                        <div className="flex items-center gap-2 text-[11px] font-semibold text-zinc-400 uppercase tracking-widest">
                            <Ratio size={14} />
                            <span>Canvas Format</span>
                        </div>
                        <div className="flex flex-wrap gap-2 bg-black/20 p-1.5 rounded-xl border border-white/5">
                            {ASPECT_RATIOS.map(ratio => (
                                <button
                                    key={ratio}
                                    onClick={() => onAspectRatioChange(ratio)}
                                    disabled={isBusy}
                                    className={`
                                        relative px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all duration-200
                                        ${aspectRatio === ratio 
                                            ? 'bg-white text-black shadow-md' 
                                            : 'text-zinc-400 hover:text-white hover:bg-white/10'
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
                    <div className="flex items-center gap-3 bg-black/20 p-1.5 rounded-xl border border-white/5">
                        {/* Border Toggle */}
                        <button
                            onClick={onToggleBorders}
                            className={`
                                h-9 px-4 rounded-lg flex items-center justify-center gap-2 transition-all duration-200
                                ${showBorders 
                                    ? 'bg-white/10 text-white shadow-sm' 
                                    : 'text-zinc-400 hover:bg-white/5 hover:text-white'
                                }
                            `}
                            title="Toggle Borders"
                        >
                            <SquareDashed size={16} />
                            <span className="text-[11px] font-semibold tracking-wide">BORDER</span>
                        </button>

                        <div className="h-6 w-px bg-white/10"></div>

                        {/* Blur Control */}
                        <div className="flex items-center gap-2 px-1">
                            <button 
                                onClick={() => onGlobalBlurChange({...globalBlur, enabled: !globalBlur.enabled})}
                                className={`
                                    h-9 px-3 rounded-lg flex items-center justify-center gap-2 transition-all duration-200
                                    ${globalBlur.enabled
                                        ? 'bg-white/10 text-white shadow-sm' 
                                        : 'text-zinc-400 hover:text-white hover:bg-white/5'
                                    }
                                `}
                                title="Toggle Global Blur"
                            >
                                <Droplets size={16} />
                            </button>
                            
                            {globalBlur.enabled && (
                                <div className="w-20 animate-in fade-in slide-in-from-left-2 duration-200">
                                    <input 
                                        type="range" 
                                        min="0" 
                                        max="20" 
                                        step="1" 
                                        value={globalBlur.amount} 
                                        onChange={(e) => onGlobalBlurChange({...globalBlur, amount: parseInt(e.target.value)})}
                                        className="w-full h-1.5 bg-white/20 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full"
                                        title={`Blur Amount: ${globalBlur.amount}px`}
                                    />
                                </div>
                            )}
                        </div>

                        <div className="h-6 w-px bg-white/10"></div>

                        {/* Label Scale */}
                        <div className="flex items-center gap-1 px-1">
                            <button 
                                onClick={() => onAdjustLabelScale(-0.1)}
                                className="w-9 h-9 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                                title="Decrease Label Size"
                            >
                                <Minus size={14} />
                            </button>
                            
                            <div className="w-8 flex justify-center" title="Label Size">
                                <Type size={14} className="text-zinc-300" />
                            </div>

                            <button 
                                onClick={() => onAdjustLabelScale(0.1)}
                                className="w-9 h-9 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                                title="Increase Label Size"
                            >
                                <Plus size={14} />
                            </button>
                        </div>
                    </div>
                </div>

                {/* Watermark Section */}
                <div className="w-full bg-black/20 border border-white/5 rounded-2xl p-4 flex flex-col md:flex-row items-center gap-5 transition-all">
                     <div className="flex items-center gap-3 min-w-[120px]">
                         <div className="flex items-center gap-2 text-[11px] font-semibold text-zinc-400 uppercase tracking-widest">
                            <Sparkles size={14} /> Watermark
                         </div>
                         <button 
                            onClick={() => onWatermarkChange({...watermark, enabled: !watermark.enabled})}
                            className={`w-10 h-5 rounded-full p-0.5 transition-colors duration-300 flex items-center shadow-inner ${watermark.enabled ? 'bg-blue-500 justify-end' : 'bg-white/10 justify-start'}`}
                         >
                             <div className="w-4 h-4 bg-white rounded-full shadow-sm" />
                         </button>
                     </div>
                     
                     <div className={`flex flex-1 items-center gap-5 w-full transition-all duration-300 ${!watermark.enabled ? 'opacity-30 pointer-events-none grayscale' : 'opacity-100'}`}>
                         <input 
                            type="text" 
                            value={watermark.text}
                            onChange={(e) => onWatermarkChange({...watermark, text: e.target.value})}
                            placeholder="Enter text..."
                            className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm text-white w-full md:w-48 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all placeholder:text-zinc-600"
                         />
                         
                         <div className="flex items-center gap-2 border-l border-white/10 pl-5">
                             <button 
                                onClick={() => onWatermarkChange({...watermark, icon: watermark.icon === 'x' ? 'none' : 'x'})}
                                className={`w-9 h-9 rounded-xl flex items-center justify-center border transition-all duration-200 ${watermark.icon === 'x' ? 'bg-white border-white text-black shadow-md' : 'bg-white/5 border-transparent text-zinc-400 hover:text-white hover:bg-white/10'}`}
                                title="X (Twitter)"
                             >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                  <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" />
                                </svg>
                             </button>
                             <button 
                                onClick={() => onWatermarkChange({...watermark, icon: watermark.icon === 'patreon' ? 'none' : 'patreon'})}
                                className={`w-9 h-9 rounded-xl flex items-center justify-center border transition-all duration-200 ${watermark.icon === 'patreon' ? 'bg-[#FF424D] border-[#FF424D] text-white shadow-md shadow-[#FF424D]/20' : 'bg-white/5 border-transparent text-zinc-400 hover:text-white hover:bg-white/10'}`}
                                title="Patreon"
                             >
                                <svg width="16" height="16" viewBox="0 0 512 512" fill="currentColor" fillRule="evenodd" clipRule="evenodd" strokeLinejoin="round" strokeMiterlimit="2">
                                    <g transform="matrix(.47407 0 0 .47407 .383 .422)">
                                        <clipPath id="prefix__a"><path d="M0 0h1080v1080H0z"/></clipPath>
                                        <g clipPath="url(#prefix__a)">
                                            <path d="M1033.05 324.45c-.19-137.9-107.59-250.92-233.6-291.7-156.48-50.64-362.86-43.3-512.28 27.2-181.1 85.46-237.99 272.66-240.11 459.36-1.74 153.5 13.58 557.79 241.62 560.67 169.44 2.15 194.67-216.18 273.07-321.33 55.78-74.81 127.6-95.94 216.01-117.82 151.95-37.61 255.51-157.53 255.29-316.38z" fillRule="nonzero"/>
                                        </g>
                                    </g>
                                </svg>
                             </button>
                         </div>

                         <div className="flex items-center gap-6 border-l border-white/10 pl-5 flex-1">
                             <div className="flex flex-col gap-2 flex-1">
                                <label className="text-[10px] font-semibold text-zinc-400 tracking-wider">OPACITY</label>
                                <input type="range" min="0" max="1" step="0.1" value={watermark.opacity} onChange={(e) => onWatermarkChange({...watermark, opacity: parseFloat(e.target.value)})} className="h-1.5 w-full bg-white/20 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full" />
                             </div>
                             <div className="flex flex-col gap-2 flex-1">
                                <label className="text-[10px] font-semibold text-zinc-400 tracking-wider">SIZE</label>
                                <input type="range" min="0.5" max="3" step="0.1" value={watermark.size} onChange={(e) => onWatermarkChange({...watermark, size: parseFloat(e.target.value)})} className="h-1.5 w-full bg-white/20 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full" />
                             </div>
                             <div className="flex flex-col gap-2 flex-1">
                                <label className="text-[10px] font-semibold text-zinc-400 tracking-wider">LOGO SIZE</label>
                                <input 
                                    type="range" 
                                    min="0.5" 
                                    max="2.5" 
                                    step="0.1" 
                                    value={watermark.iconScale ?? 1} 
                                    onChange={(e) => onWatermarkChange({...watermark, iconScale: parseFloat(e.target.value)})} 
                                    disabled={watermark.icon === 'none'}
                                    className={`h-1.5 w-full bg-white/20 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full ${watermark.icon === 'none' ? 'opacity-30' : ''}`} 
                                />
                             </div>
                         </div>
                     </div>
                </div>
            </div>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[11px] font-semibold text-zinc-400 uppercase tracking-widest flex items-center gap-2">
            Input Sources
          </h2>
          <div className="flex items-center gap-3">
             {images.length > 0 && (
                <button 
                    type="button"
                    onClick={onClear}
                    className="text-[11px] font-semibold text-red-400 hover:text-red-300 transition-colors flex items-center gap-1.5 bg-red-500/10 hover:bg-red-500/20 px-3 py-1 rounded-lg border border-transparent"
                    title="Clear All Inputs"
                >
                    <Trash2 size={12} /> CLEAR ALL
                </button>
             )}
            <span className="text-[11px] font-semibold text-zinc-400 bg-white/5 px-3 py-1 rounded-full border border-white/5">
                {images.length} / {maxImages}
            </span>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row gap-6">
            {/* Image Grid Area */}
            <div className="flex-1 grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-6 xl:grid-cols-8 gap-3 content-start">
              {images.map((img, index) => (
              <div key={img.id} className="relative group aspect-square bg-black/20 rounded-xl overflow-hidden border border-white/10 shadow-sm">
                  <img src={img.url} alt="upload" className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-500" />
                  <div className="absolute top-2 left-2 font-semibold text-[10px] text-white bg-black/60 px-2 py-0.5 rounded-md backdrop-blur-md">
                  0{index + 1}
                  </div>
                  <button 
                  onClick={() => onRemoveImage(img.id)}
                  className="absolute top-2 right-2 p-1.5 bg-red-500/90 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-all duration-200 hover:bg-red-600 hover:scale-105 shadow-lg"
                  >
                  <CloseIcon size={12} />
                  </button>
              </div>
              ))}
              
              {remaining > 0 && (
              <button 
                  onClick={() => fileInputRef.current?.click()}
                  className="aspect-square flex flex-col items-center justify-center border-2 border-dashed border-white/10 hover:border-blue-500/50 hover:bg-blue-500/5 transition-all duration-300 text-zinc-500 hover:text-blue-400 rounded-xl group"
              >
                  <Upload size={18} className="group-hover:-translate-y-1 transition-transform duration-300" />
                  <span className="text-[10px] font-semibold mt-2 tracking-wide">ADD</span>
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
