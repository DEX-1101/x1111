import React, { useState, useRef, useEffect } from 'react';
import { upscaleService } from '../lib/upscaleService';
import { Upload, X, Maximize, Download, Loader2, CheckCircle2, AlertCircle, Trash2, FileArchive, Cpu } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import JSZip from 'jszip';

interface UpscaleItem {
  id: string;
  file: File;
  preview: string;
  status: 'idle' | 'processing' | 'done' | 'error';
  progress: number;
  result?: string;
  error?: string;
}

export const UpscaleEditor: React.FC = () => {
  const [items, setItems] = useState<UpscaleItem[]>([]);
  const [scale, setScale] = useState(() => {
    const saved = localStorage.getItem('upscale-scale');
    return saved ? parseFloat(saved) : 2.0;
  });
  const [isInitializing, setIsInitializing] = useState(false);
  const [initStatus, setInitStatus] = useState('');
  const [initProgress, setInitProgress] = useState(0);
  const [isModelReady, setIsModelReady] = useState(false);
  const [isZipping, setIsZipping] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const cancelRef = useRef(false);
  const [comparisonItem, setComparisonItem] = useState<UpscaleItem | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    localStorage.setItem('upscale-scale', scale.toString());
  }, [scale]);

  const handleAddFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const newFiles = Array.from(e.target.files);
    const newItems: UpscaleItem[] = newFiles.map(file => ({
      id: Math.random().toString(36).substr(2, 9),
      file,
      preview: URL.createObjectURL(file),
      status: 'idle',
      progress: 0
    }));
    setItems(prev => [...prev, ...newItems]);
  };

  const removeItem = (id: string) => {
    setItems(prev => {
      const item = prev.find(i => i.id === id);
      if (item) URL.revokeObjectURL(item.preview);
      if (item?.result) URL.revokeObjectURL(item.result);
      return prev.filter(i => i.id !== id);
    });
  };

  const clearAll = () => {
    items.forEach(item => {
      URL.revokeObjectURL(item.preview);
      if (item.result) URL.revokeObjectURL(item.result);
    });
    setItems([]);
  };

  const startUpscale = async () => {
    cancelRef.current = false;
    setIsCancelling(false);

    if (!isModelReady) {
      setIsInitializing(true);
      try {
        await upscaleService.init((progress, status) => {
          setInitProgress(progress);
          setInitStatus(status);
        });
        setIsModelReady(true);
      } catch (err) {
        console.error(err);
        alert("Failed to initialize upscale model.");
        setIsInitializing(false);
        return;
      }
      setIsInitializing(false);
    }

    const idleItems = items.filter(i => i.status === 'idle' || i.status === 'error');
    if (idleItems.length === 0) return;

    for (const item of idleItems) {
      if (cancelRef.current) break;
      
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, status: 'processing', progress: 0 } : i));
      
      try {
        const img = new Image();
        img.src = item.preview;
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
        });

        const resultUrl = await upscaleService.upscale(img, scale, (progress) => {
          setItems(prev => prev.map(i => i.id === item.id ? { ...i, progress: Math.round(progress * 100) } : i));
        });

        setItems(prev => prev.map(i => i.id === item.id ? { ...i, status: 'done', progress: 100, result: resultUrl } : i));
      } catch (err) {
        console.error(err);
        setItems(prev => prev.map(i => i.id === item.id ? { ...i, status: 'error', error: String(err) } : i));
      }
    }
    setIsCancelling(false);
  };

  const cancelUpscale = () => {
    cancelRef.current = true;
    setIsCancelling(true);
    setItems(prev => prev.map(i => i.status === 'processing' ? { ...i, status: 'idle', progress: 0 } : i));
  };

  const downloadResult = (item: UpscaleItem, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!item.result) return;
    const a = document.createElement('a');
    a.href = item.result;
    const nameWithoutExt = item.file.name.substring(0, item.file.name.lastIndexOf('.'));
    const ext = item.file.name.substring(item.file.name.lastIndexOf('.'));
    a.download = `${nameWithoutExt}_${scale}x_upscale${ext}`;
    a.click();
  };

  const downloadAllZip = async () => {
    const doneItems = items.filter(i => i.status === 'done' && i.result);
    if (doneItems.length === 0) return;

    setIsZipping(true);
    try {
      const zip = new JSZip();
      for (const item of doneItems) {
        const response = await fetch(item.result!);
        const blob = await response.blob();
        const nameWithoutExt = item.file.name.substring(0, item.file.name.lastIndexOf('.'));
        const ext = item.file.name.substring(item.file.name.lastIndexOf('.'));
        zip.file(`${nameWithoutExt}_${scale}x_upscale${ext}`, blob);
      }
      const content = await zip.generateAsync({ type: 'blob' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(content);
      a.download = `upscaled_images_${scale}x.zip`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      console.error(err);
      alert("Failed to create ZIP file.");
    } finally {
      setIsZipping(false);
    }
  };

  return (
    <div className="flex flex-col h-full gap-6 p-6 overflow-hidden">
      {/* Header Controls */}
      <div className="flex items-center justify-between bg-white/5 backdrop-blur-xl border border-white/10 p-4 rounded-2xl shrink-0">
        <div className="flex items-center gap-6">
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Upscale Factor</span>
              <span className="text-xs font-mono text-themePrimary">{scale.toFixed(1)}x</span>
            </div>
            <input 
              type="range" min="1" max="4" step="0.1" 
              value={scale} onChange={(e) => setScale(parseFloat(e.target.value))}
              className="w-48 accent-themePrimary"
            />
          </div>

          <div className="h-8 w-[1px] bg-white/10" />

          <button 
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2 bg-white hover:bg-zinc-200 text-black rounded-xl text-sm font-bold transition-all shadow-lg shadow-white/5"
          >
            <Upload size={16} /> Add Images
          </button>
          <input type="file" ref={fileInputRef} multiple accept="image/*" onChange={handleAddFiles} className="hidden" />
        </div>

        <div className="flex items-center gap-3">
          {items.some(i => i.status === 'done') && (
            <button 
              onClick={downloadAllZip}
              disabled={isZipping}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-xl text-sm font-bold shadow-lg shadow-green-900/20 transition-all disabled:opacity-50"
            >
              {isZipping ? <Loader2 className="animate-spin" size={16} /> : <FileArchive size={16} />}
              {isZipping ? 'Zipping...' : 'Download All (ZIP)'}
            </button>
          )}
          {items.length > 0 && (
            <button 
              onClick={clearAll}
              className="flex items-center gap-2 px-4 py-2 text-zinc-400 hover:text-white transition-all text-sm font-semibold"
            >
              <Trash2 size={16} /> Clear All
            </button>
          )}
          {items.some(i => i.status === 'processing') ? (
            <button 
              onClick={cancelUpscale}
              className="flex items-center gap-2 px-6 py-2 bg-red-500 hover:bg-red-600 text-white rounded-xl text-sm font-bold shadow-lg shadow-red-900/20 transition-all"
            >
              <X size={16} /> Cancel
            </button>
          ) : (
            <button 
              onClick={startUpscale}
              disabled={items.length === 0 || items.every(i => i.status === 'processing')}
              className="flex items-center gap-2 px-6 py-2 bg-themeBtn hover:bg-themeBtnHover text-themeBtnText rounded-xl text-sm font-bold shadow-lg shadow-themePrimary/20 transition-all disabled:opacity-50"
            >
              {isInitializing ? <Loader2 className="animate-spin" size={16} /> : <Maximize size={16} />}
              {isInitializing ? 'Loading Model...' : 'Start Upscale'}
            </button>
          )}
        </div>
      </div>

      {/* Model Info Bar */}
      {isModelReady && (
        <div className="flex items-center gap-4 px-4 py-2 bg-white/5 border border-white/10 rounded-xl shrink-0">
          <div className="flex items-center gap-2 text-xs font-bold text-zinc-400 uppercase tracking-widest">
            <Cpu size={14} className="text-themePrimary" />
            Model: <span className="text-white">{upscaleService.getModelInfo().name}</span>
          </div>
          <div className="h-4 w-[1px] bg-white/10" />
          <div className="flex items-center gap-2 text-xs font-bold text-zinc-400 uppercase tracking-widest">
            Provider: <span className="text-themePrimary">{upscaleService.getProvider().toUpperCase()}</span>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto custom-scrollbar pr-2">
        {items.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-4 text-zinc-500 border-2 border-dashed border-white/5 rounded-3xl">
            <div className="p-6 rounded-full bg-white/5">
              <Upload size={48} />
            </div>
            <div className="text-center">
              <p className="text-lg font-semibold text-zinc-300">No images selected</p>
              <p className="text-sm">Upload images to start upscaling with Real-ESRGAN</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4">
            <AnimatePresence mode="popLayout">
              {items.map((item) => (
                <motion.div 
                  key={item.id}
                  layout
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="group relative bg-white/5 border border-white/10 rounded-2xl overflow-hidden flex flex-col"
                >
                  {/* Image Preview */}
                  <div 
                    className={`aspect-square relative bg-black/40 overflow-hidden ${item.status === 'done' ? 'cursor-zoom-in' : ''}`}
                    onClick={() => item.status === 'done' && setComparisonItem(item)}
                  >
                    <img 
                      src={item.result || item.preview} 
                      alt={item.file.name} 
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                    
                    {/* Minimalist Overlay */}
                    <div className="absolute inset-x-0 bottom-0 p-4 bg-gradient-to-t from-black/80 via-black/40 to-transparent pt-10">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold text-white truncate drop-shadow-md">{item.file.name}</p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <div className={`w-1.5 h-1.5 rounded-full ${
                              item.status === 'done' ? 'bg-green-500' : 
                              item.status === 'error' ? 'bg-red-500' : 
                              item.status === 'processing' ? 'bg-themePrimary animate-pulse' : 'bg-zinc-500'
                            }`} />
                            <p className="text-[10px] text-zinc-300 uppercase font-bold tracking-wider">
                              {item.status === 'done' ? 'Success' : item.status === 'error' ? 'Failed' : item.status === 'processing' ? 'Upscaling' : 'Ready'}
                            </p>
                          </div>
                        </div>
                        {item.status === 'done' && <CheckCircle2 size={14} className="text-green-500 shrink-0" />}
                        {item.status === 'error' && <AlertCircle size={14} className="text-red-500 shrink-0" />}
                      </div>
                    </div>

                    {item.status === 'done' && (
                      <div className="absolute inset-0 bg-black/0 hover:bg-black/20 transition-colors flex items-center justify-center opacity-0 hover:opacity-100">
                        <span className="px-3 py-1 bg-black/60 backdrop-blur-md rounded-full text-[10px] font-bold text-white uppercase tracking-widest">
                          Click to Compare
                        </span>
                      </div>
                    )}
                    
                    {/* Status Overlays */}
                    <AnimatePresence>
                      {item.status === 'processing' && (
                        <motion.div 
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center gap-3"
                        >
                          <div className="relative w-16 h-16">
                            <svg className="w-full h-full -rotate-90">
                              <circle 
                                cx="32" cy="32" r="28" 
                                fill="none" stroke="currentColor" 
                                strokeWidth="4" className="text-white/10" 
                              />
                              <motion.circle 
                                cx="32" cy="32" r="28" 
                                fill="none" stroke="currentColor" 
                                strokeWidth="4" className="text-themePrimary" 
                                strokeDasharray={175.9}
                                initial={{ strokeDashoffset: 175.9 }}
                                animate={{ strokeDashoffset: 175.9 * (1 - item.progress / 100) }}
                                transition={{ type: "spring", bounce: 0, duration: 0.5 }}
                                strokeLinecap="round"
                              />
                            </svg>
                            <div className="absolute inset-0 flex items-center justify-center text-xs font-bold text-white">
                              {item.progress}%
                            </div>
                          </div>
                          <span className="text-xs font-bold text-white uppercase tracking-widest">Upscaling...</span>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* Actions Overlay */}
                    <div className="absolute top-3 right-3 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                      {item.status === 'done' && (
                        <button 
                          onClick={(e) => downloadResult(item, e)}
                          className="p-2 bg-accent/80 backdrop-blur-md text-white rounded-lg shadow-lg hover:scale-110 transition-all border border-white/10"
                          title="Download Result"
                        >
                          <Download size={16} />
                        </button>
                      )}
                      <button 
                        onClick={(e) => { e.stopPropagation(); removeItem(item.id); }}
                        className="p-2 bg-red-500/80 backdrop-blur-md text-white rounded-lg shadow-lg hover:scale-110 transition-all border border-white/10"
                        title="Remove"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Global Modals (Loading & Zipping) - Bottom Middle Popup Style */}
      <AnimatePresence>
        {(isInitializing || isZipping) && (
          <motion.div 
            initial={{ opacity: 0, y: 50, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: 50, x: '-50%' }}
            className="fixed bottom-8 left-1/2 z-[100] w-full max-w-md bg-zinc-900/90 backdrop-blur-xl border border-white/10 rounded-2xl p-4 shadow-2xl overflow-hidden"
          >
            <div className="flex items-center gap-4">
              <div className="p-2.5 rounded-xl bg-themePrimary/10 shrink-0">
                <Loader2 className="animate-spin text-themePrimary" size={20} />
              </div>
              
              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-center mb-1">
                  <h3 className="text-sm font-bold text-white tracking-tight truncate">
                    {isInitializing ? 'Initializing AI Model' : 'Creating Archive'}
                  </h3>
                  {isInitializing && (
                    <span className="text-xs font-mono text-themePrimary">{initProgress}%</span>
                  )}
                </div>
                
                <div className="relative h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                  {isInitializing ? (
                    <motion.div 
                      className="h-full bg-themePrimary shadow-[0_0_10px_rgba(var(--theme-primary-rgb),0.5)]"
                      initial={{ width: 0 }}
                      animate={{ width: `${initProgress}%` }}
                      transition={{ type: "spring", bounce: 0, duration: 0.5 }}
                    />
                  ) : (
                    <motion.div 
                      className="h-full bg-themePrimary"
                      animate={{ 
                        x: ["-100%", "100%"],
                      }}
                      transition={{ 
                        repeat: Infinity, 
                        duration: 1.5, 
                        ease: "linear" 
                      }}
                      style={{ width: '40%' }}
                    />
                  )}
                </div>
                
                <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mt-1.5 truncate">
                  {isInitializing ? initStatus : 'Packaging upscaled images...'}
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Comparison Modal */}
      <AnimatePresence>
        {comparisonItem && (
          <ComparisonModal 
            item={comparisonItem} 
            onClose={() => setComparisonItem(null)} 
            scale={scale}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

const ComparisonModal: React.FC<{ item: UpscaleItem; onClose: () => void; scale: number }> = ({ item, onClose, scale }) => {
  const [sliderPos, setSliderPos] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const position = ((x - rect.left) / rect.width) * 100;
    setSliderPos(Math.max(0, Math.min(100, position)));
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-xl flex flex-col items-center justify-center p-4 md:p-10"
      onClick={onClose}
    >
      <div className="absolute top-6 right-6 flex gap-4 z-20">
        <button 
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          className="p-3 bg-white/10 hover:bg-white/20 text-white rounded-full transition-all backdrop-blur-md"
        >
          <X size={24} />
        </button>
      </div>

      <div 
        className="relative w-[95vw] h-[85vh] bg-zinc-900 rounded-3xl overflow-hidden shadow-2xl border border-white/10 cursor-col-resize select-none"
        ref={containerRef}
        onMouseMove={handleMouseMove}
        onTouchMove={handleMouseMove}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Original (Before) */}
        <div className="absolute inset-0 flex items-center justify-center p-0">
          <img src={item.preview} className="w-full h-full object-contain pointer-events-none" alt="Original" />
        </div>

        {/* Upscaled (After) */}
        <div 
          className="absolute inset-0 overflow-hidden pointer-events-none"
          style={{ clipPath: `inset(0 0 0 ${sliderPos}%)` }}
        >
          <div className="absolute inset-0 flex items-center justify-center p-0">
            <img src={item.result} className="w-full h-full object-contain pointer-events-none" alt="Upscaled" />
          </div>
        </div>

        {/* Labels Layer (Non-clipped, at the end to ensure visibility) */}
        <div className="absolute inset-0 pointer-events-none z-30">
          <div className="absolute bottom-6 left-6 px-4 py-2 bg-black/60 backdrop-blur-md rounded-xl text-xs font-bold text-white uppercase tracking-widest border border-white/10">
            Before (Original)
          </div>
          <div className="absolute bottom-6 right-6 px-4 py-2 bg-accent/60 backdrop-blur-md rounded-xl text-xs font-bold text-white uppercase tracking-widest border border-accent/20">
            After ({scale.toFixed(1)}x)
          </div>
        </div>

        {/* Slider Line */}
        <div 
          className="absolute top-0 bottom-0 w-1 bg-white shadow-[0_0_15px_rgba(255,255,255,0.5)] z-10 pointer-events-none"
          style={{ left: `${sliderPos}%` }}
        >
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 bg-white rounded-full flex items-center justify-center shadow-2xl">
            <div className="flex gap-0.5">
              <div className="w-0.5 h-3 bg-zinc-400 rounded-full" />
              <div className="w-0.5 h-3 bg-zinc-400 rounded-full" />
            </div>
          </div>
        </div>
      </div>

      <p className="mt-8 text-zinc-500 text-sm font-medium animate-pulse">
        Slide horizontally to compare details
      </p>
    </motion.div>
  );
};
