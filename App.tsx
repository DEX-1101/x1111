
import React, { useState, useRef, useEffect } from 'react';
import { ImageUploader } from './components/ImageUploader';
import { CollageDisplay } from './components/CollageDisplay';
import { MosaicEditor } from './components/MosaicEditor';
import { TagEditor } from './components/TagEditor';
import { generateCollageLayout, generateBackgroundTexture, detectFaceCenters } from './services/geminiService';
import { saveMixerState, loadMixerState } from './services/mixerStorage';
import { ImageItem, CollageLayout, AppStatus, LogEntry, AspectRatio, WatermarkSettings, GlobalBlurSettings } from './types';
import { AlertCircle, Layers, Grid2X2, Loader2, Tag } from 'lucide-react';

const MAX_IMAGES = 6;

type AppMode = 'MIX' | 'MOSAIC' | 'TAGS';

const App: React.FC = () => {
  const [mode, setMode] = useState<AppMode>('MIX');
  
  // --- LOADING STATE ---
  const [isAppLoading, setIsAppLoading] = useState(true);

  // --- MIXER STATE ---
  const [images, setImages] = useState<ImageItem[]>([]);
  const [layout, setLayout] = useState<CollageLayout | null>(null);
  const [backgroundUrl, setBackgroundUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [error, setError] = useState<string | null>(null);
  const [showBorders, setShowBorders] = useState<boolean>(true);
  const [labelScale, setLabelScale] = useState<number>(1);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("3:2");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  
  // Visual Settings
  const [watermark, setWatermark] = useState<WatermarkSettings>({
      enabled: false,
      text: '',
      icon: 'none',
      x: 50,
      y: 50,
      opacity: 0.8,
      size: 1,
      iconScale: 1
  });

  const [globalBlur, setGlobalBlur] = useState<GlobalBlurSettings>({
      enabled: false,
      amount: 8
  });
  
  const [theme, setTheme] = useState<'default'|'blue'|'purple'|'red'>(() => (localStorage.getItem('app_theme') as any) || 'default');
  
  const abortControllerRef = useRef<AbortController | null>(null);

  // Persistence: Load
  useEffect(() => {
    const minLoadTime = new Promise(resolve => setTimeout(resolve, 2500)); // Smooth 2.5s splash
    const dataLoad = loadMixerState();

    Promise.all([dataLoad, minLoadTime]).then(([data]) => {
        if (data.images.length > 0) setImages(data.images);
        if (data.state) {
            setLayout(data.state.layout);
            setBackgroundUrl(data.state.backgroundUrl);
            setShowBorders(data.state.showBorders);
            setLabelScale(data.state.labelScale);
            setAspectRatio(data.state.aspectRatio);
            // Merge settings to ensure new properties exist if loading old state
            setWatermark(prev => ({ ...prev, ...data.state.watermark }));
            if (data.state.globalBlur) {
                setGlobalBlur(data.state.globalBlur);
            }
        }
        setIsAppLoading(false);
    });
  }, []);

  useEffect(() => {
    document.body.setAttribute('data-theme', theme);
    localStorage.setItem('app_theme', theme);
  }, [theme]);

  // Persistence: Save (Debounced)
  useEffect(() => {
    const t = setTimeout(() => {
        saveMixerState(images, {
            layout,
            backgroundUrl,
            showBorders,
            labelScale,
            aspectRatio,
            watermark,
            globalBlur
        });
    }, 1000);
    return () => clearTimeout(t);
  }, [images, layout, backgroundUrl, showBorders, labelScale, aspectRatio, watermark, globalBlur]);

  const addLog = (message: string, type: LogEntry['type'] = 'info') => {
    const now = new Date();
    const timeString = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}.${now.getMilliseconds().toString().padStart(3, '0')}`;
    setLogs(prev => [...prev, {
        id: Math.random().toString(36).substr(2, 9),
        timestamp: timeString,
        message,
        type
    }]);
  };

  const handleAddImages = (files: File[]) => {
    const newImages = files.slice(0, MAX_IMAGES - images.length).map(file => ({
      id: Math.random().toString(36).substr(2, 9),
      url: URL.createObjectURL(file),
      file
    }));
    setImages(prev => [...prev, ...newImages]);
    if (files.length > 0) {
        addLog(`Buffered ${files.length} new image(s).`, 'info');
    }
  };

  const handleRemoveImage = (id: string) => {
    setImages(prev => prev.filter(img => img.id !== id));
    addLog(`Image removed from buffer.`, 'warning');
  };

  const handleClearMix = () => {
    // Abort pending requests if clearing
    if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
    }

    // Cleanup memory
    images.forEach(img => URL.revokeObjectURL(img.url));

    setImages([]);
    setLayout(null);
    setBackgroundUrl(null);
    setStatus(AppStatus.IDLE);
    setError(null);
    setLogs([]);
    addLog("Workspace cleared.", 'info');
  };

  const adjustLabelScale = (delta: number) => {
    setLabelScale(prev => {
        const newVal = Math.max(0.5, Math.min(2.0, prev + delta));
        return parseFloat(newVal.toFixed(1));
    });
  };

  const handleCancel = () => {
    if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
    }
    setStatus(AppStatus.IDLE);
    addLog("Generation sequence cancelled by user.", 'warning');
  };

  const handleMix = async () => {
    if (images.length === 0) return;
    
    // Setup cancellation
    if (abortControllerRef.current) abortControllerRef.current.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const signal = controller.signal;

    setError(null);
    setLayout(null);
    setBackgroundUrl(null);
    setLogs(prev => []); 
    addLog("Initializing sequence...", 'info');

    try {
      // 1. Analyze Images for Faces (Gemini Vision)
      if (signal.aborted) throw new Error("Cancelled");
      setStatus(AppStatus.ANALYZING_FACES);
      
      const startTime = performance.now();
      const faceData = await detectFaceCenters(images, (msg) => addLog(msg, 'info'));
      
      if (signal.aborted) throw new Error("Cancelled");
      const visionTime = ((performance.now() - startTime) / 1000).toFixed(2);
      addLog(`Subjects identified in ${visionTime}s.`, 'success');
      
      // Update images with focus points
      const updatedImages = images.map((img, i) => {
        const face = faceData.find(f => f.index === i);
        return face ? { ...img, focusPoint: { x: face.x, y: face.y } } : img;
      });
      setImages(updatedImages);

      // 2. Generate Layout Logic (Gemini 3 Flash)
      if (signal.aborted) throw new Error("Cancelled");
      setStatus(AppStatus.GENERATING_LAYOUT);
      
      const layoutStart = performance.now();
      // Pass a throttled logger for high-frequency stream updates if needed, or just raw
      const layoutData = await generateCollageLayout(images.length, aspectRatio, (msg) => addLog(msg, 'info'));
      
      if (signal.aborted) throw new Error("Cancelled");
      const layoutTime = ((performance.now() - layoutStart) / 1000).toFixed(2);
      addLog(`Topology generated with ${layoutData.regions.length} regions (${layoutTime}s).`, 'success');
      
      setLayout(layoutData);
      
      // 3. Generate Background (Nano Banana / Gemini 2.5 Flash Image)
      if (signal.aborted) throw new Error("Cancelled");
      setStatus(AppStatus.GENERATING_BACKGROUND);
      
      const bgStart = performance.now();
      const bg = await generateBackgroundTexture((msg) => addLog(msg, 'info'));
      
      if (signal.aborted) throw new Error("Cancelled");
      const bgTime = ((performance.now() - bgStart) / 1000).toFixed(2);
      
      if (bg) {
        addLog(`Background synthesis complete (${bgTime}s).`, 'success');
        setBackgroundUrl(bg);
      } else {
        addLog(`Background generation skipped.`, 'warning');
      }

      setStatus(AppStatus.READY);
      addLog(`Mix sequence completed successfully.`, 'success');

    } catch (err: any) {
      if (err.message === "Cancelled") {
         return; // Silent exit
      }
      console.error(err);
      
      const detailedError = err instanceof Error ? err.message : String(err);
      setError(detailedError);
      
      addLog(detailedError, 'error');
      setStatus(AppStatus.ERROR);
    } finally {
        abortControllerRef.current = null;
    }
  };

  const isBusy = status === AppStatus.ANALYZING_FACES || status === AppStatus.GENERATING_LAYOUT || status === AppStatus.GENERATING_BACKGROUND;

  return (
    <div className={`min-h-screen bg-background text-gray-200 flex flex-col items-center p-4 selection:bg-accent selection:text-white ${mode === 'MOSAIC' || mode === 'TAGS' ? 'h-screen overflow-hidden' : ''}`}>
      
      {/* --- SPLASH SCREEN --- */}
      <div 
        className={`
            fixed inset-0 z-[9999] 
            /* Deep Purple/Black Animated Gradient */
            bg-gradient-to-br from-black via-[#4c1d95] to-black
            bg-[length:400%_400%] animate-gradient
            flex flex-col items-center justify-center transition-all duration-1000 ease-[cubic-bezier(0.4,0,0.2,1)]
            ${isAppLoading ? 'opacity-100' : 'opacity-0 pointer-events-none scale-105 filter blur-xl'}
        `}
      >
          <div className="flex flex-col items-center gap-8">
              <div className="flex flex-col items-center gap-6">
                  {/* Clean White Text - Segoe UI (font-sans) */}
                  <h1 className="text-xl font-sans font-bold text-white tracking-[0.2em] uppercase animate-pulse">
                      Loading Interface...
                  </h1>

                  {/* Minimal White Loading Line (No heavy background container) - Slowed Animation */}
                  <div className="relative w-48 h-[2px] bg-white/10 rounded-full overflow-hidden">
                      {/* Traveling Beam - 3s duration */}
                      <div className="absolute top-0 bottom-0 left-0 w-1/2 bg-gradient-to-r from-transparent via-white to-transparent -translate-x-full animate-[shimmer_3s_infinite_linear]"></div>
                  </div>
              </div>
          </div>
      </div>

      {/* Header / Nav */}
      <div className={`w-full flex items-center justify-center shrink-0 ${mode === 'MOSAIC' || mode === 'TAGS' ? 'max-w-[95%] mb-4' : 'max-w-6xl mb-8'}`}>
         <div className="flex bg-white/5 backdrop-blur-md p-1.5 rounded-2xl border border-white/10 shadow-2xl">
            <button
                onClick={() => setMode('MIX')}
                className={`flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-semibold tracking-wide transition-all duration-300 ${mode === 'MIX' ? 'bg-white/10 text-white shadow-[0_0_20px_rgba(255,255,255,0.05)]' : 'text-zinc-400 hover:text-white hover:bg-white/5'}`}
            >
                <Layers size={16} /> MIX
            </button>
            <button
                onClick={() => setMode('MOSAIC')}
                className={`flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-semibold tracking-wide transition-all duration-300 ${mode === 'MOSAIC' ? 'bg-white/10 text-white shadow-[0_0_20px_rgba(255,255,255,0.05)]' : 'text-zinc-400 hover:text-white hover:bg-white/5'}`}
            >
                <Grid2X2 size={16} /> MOSAIC
            </button>
            <button
                onClick={() => setMode('TAGS')}
                className={`flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-semibold tracking-wide transition-all duration-300 ${mode === 'TAGS' ? 'bg-white/10 text-white shadow-[0_0_20px_rgba(255,255,255,0.05)]' : 'text-zinc-400 hover:text-white hover:bg-white/5'}`}
            >
                <Tag size={16} /> TAG EDITOR
            </button>
         </div>
         
         {/* Theme Switcher */}
         <div className="ml-4 flex bg-white/5 backdrop-blur-md p-1.5 rounded-2xl border border-white/10 shadow-2xl gap-2">
            <button onClick={() => setTheme('default')} className={`w-5 h-5 rounded-full bg-white border-2 transition-all ${theme === 'default' ? 'border-zinc-400 scale-110' : 'border-transparent hover:scale-110'}`} title="Default Theme" />
            <button onClick={() => setTheme('blue')} className={`w-5 h-5 rounded-full bg-blue-600 border-2 transition-all ${theme === 'blue' ? 'border-white scale-110' : 'border-transparent hover:scale-110'}`} title="Blue Theme" />
            <button onClick={() => setTheme('purple')} className={`w-5 h-5 rounded-full bg-purple-600 border-2 transition-all ${theme === 'purple' ? 'border-white scale-110' : 'border-transparent hover:scale-110'}`} title="Purple Theme" />
            <button onClick={() => setTheme('red')} className={`w-5 h-5 rounded-full bg-red-600 border-2 transition-all ${theme === 'red' ? 'border-white scale-110' : 'border-transparent hover:scale-110'}`} title="Red Theme" />
         </div>
      </div>

      <div className={`w-full flex flex-col gap-6 transition-all duration-500 ${mode === 'MOSAIC' || mode === 'TAGS' ? 'flex-1 h-full max-w-[95%] pb-10' : 'max-w-6xl'}`}>
        
        {mode === 'MIX' ? (
            /* MIX MODE */
            <div className="w-full space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <CollageDisplay 
                    layout={layout} 
                    images={images} 
                    backgroundUrl={backgroundUrl}
                    showBorders={showBorders}
                    labelScale={labelScale}
                    aspectRatio={aspectRatio}
                    onLayoutUpdate={setLayout}
                    watermark={watermark}
                    onWatermarkUpdate={setWatermark}
                    globalBlur={globalBlur}
                />

                {/* Error Message */}
                {error && (
                    <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex gap-3 items-start shadow-lg backdrop-blur-md">
                        <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                            <h3 className="text-red-400 text-xs font-bold uppercase mb-1 tracking-wider">Generation Interrupted</h3>
                            <p className="text-red-200/90 text-sm leading-relaxed break-words">
                                {error}
                            </p>
                        </div>
                    </div>
                )}

                {/* Unified Inputs & Actions Panel */}
                <div className="w-full bg-white/5 backdrop-blur-xl border border-white/10 shadow-2xl rounded-3xl p-6">
                    <ImageUploader 
                        images={images} 
                        onAddImages={handleAddImages} 
                        onRemoveImage={handleRemoveImage}
                        onClear={handleClearMix}
                        maxImages={MAX_IMAGES}
                        logs={logs}
                        status={status}
                        onGenerate={handleMix}
                        onCancel={handleCancel}
                        // Visual Props
                        aspectRatio={aspectRatio}
                        onAspectRatioChange={setAspectRatio}
                        showBorders={showBorders}
                        onToggleBorders={() => setShowBorders(prev => !prev)}
                        labelScale={labelScale}
                        onAdjustLabelScale={adjustLabelScale}
                        isBusy={isBusy}
                        watermark={watermark}
                        onWatermarkChange={setWatermark}
                        globalBlur={globalBlur}
                        onGlobalBlurChange={setGlobalBlur}
                    />
                </div>
            </div>
        ) : mode === 'MOSAIC' ? (
            /* MOSAIC MODE */
            <div className="w-full h-full animate-in fade-in slide-in-from-bottom-4 duration-500">
                <MosaicEditor />
            </div>
        ) : (
            /* TAGS MODE */
            <div className="w-full h-full animate-in fade-in slide-in-from-bottom-4 duration-500">
                <TagEditor />
            </div>
        )}
      </div>
    </div>
  );
};

export default App;
