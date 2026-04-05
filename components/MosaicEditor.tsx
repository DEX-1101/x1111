
import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { MosaicImageItem, CensorPath, Point, VignetteSettings, WatermarkSettings } from '../types';
import { Upload, X, Download, Undo2, Eraser, Loader2, ImagePlus, Brush, ZoomIn, ZoomOut, Move, Grid3X3, Square, Aperture, Sliders, CheckCheck, RotateCcw, RotateCw, FileText, Lock, FileArchive, Trash2, Settings, ShieldCheck, FileDown, Type, Sparkles } from 'lucide-react';
import { BlobReader, BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js";

// --- IndexedDB Helper for Large Files ---
const DB_NAME = 'GeminiMosaicDB';
const STORE_NAME = 'project_images';
const DB_VERSION = 1;

const openDB = (): Promise<IDBDatabase> => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = (e) => {
            const db = (e.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
        };
    });
};

const saveImagesToDB = async (images: MosaicImageItem[]) => {
    try {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        
        await new Promise<void>((resolve, reject) => {
             const clearReq = store.clear();
             clearReq.onsuccess = () => resolve();
             clearReq.onerror = () => reject(clearReq.error);
        });

        for (const img of images) {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { url, ...data } = img; // Exclude blob url, store File object directly
            store.put(data);
        }
        
        return new Promise<void>((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
    } catch(e) {
        console.error("IDB Save Error", e);
    }
};

const loadImagesFromDB = async (): Promise<MosaicImageItem[]> => {
     try {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.getAll();
        
        return new Promise((resolve, reject) => {
            request.onsuccess = () => {
                const items = request.result;
                const restored = items.map((item: any) => ({
                    ...item,
                    url: URL.createObjectURL(item.file) // Recreate blob url from File
                }));
                resolve(restored);
            };
            request.onerror = () => reject(request.error);
        });
    } catch(e) {
        console.warn("IDB Load Error", e);
        return [];
    }
};

// Helper to save blobs without external dependencies
const saveBlob = (blob: Blob, name: string) => {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
};

interface ViewTransform {
    x: number;
    y: number;
    k: number; // scale
}

const DEFAULT_VIGNETTE: VignetteSettings = {
    enabled: false,
    color: '#000000',
    opacity: 1,
    range: 85, // 85% of size (smaller hole)
    softness: 60, // 60% blur intensity
    cornerRadius: 30 // 30% rounding
};

// Default Preset Configurations (Geometric only, color is preserved)
const DEFAULT_PRESETS = [
    { opacity: 0.5, range: 95, softness: 100, cornerRadius: 80 }, // 1. Subtle / Soft
    { opacity: 0.9, range: 75, softness: 50, cornerRadius: 25 },  // 2. Cinematic / Standard
    { opacity: 1.0, range: 45, softness: 10, cornerRadius: 5 }    // 3. Spotlight / Hard
];

const drawInfiniteGrid = (ctx: CanvasRenderingContext2D, width: number, height: number, transform: ViewTransform) => {
    const gridSize = 100;
    const { x, y, k } = transform;
    
    // Calculate visible world bounds with some buffer
    const buffer = gridSize * 2;
    const startX = Math.floor((-x / k) / gridSize) * gridSize - buffer;
    const endX = Math.ceil(((width - x) / k) / gridSize) * gridSize + buffer;
    const startY = Math.floor((-y / k) / gridSize) * gridSize - buffer;
    const endY = Math.ceil(((height - y) / k) / gridSize) * gridSize + buffer;

    ctx.save();
    
    // Grid Lines
    ctx.lineWidth = 1 / k;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.beginPath();
    
    // Vertical lines
    for (let gx = startX; gx <= endX; gx += gridSize) {
        if (Math.abs(gx) < 0.1) continue; // Skip axis
        ctx.moveTo(gx, startY);
        ctx.lineTo(gx, endY);
    }
    
    // Horizontal lines
    for (let gy = startY; gy <= endY; gy += gridSize) {
        if (Math.abs(gy) < 0.1) continue; // Skip axis
        ctx.moveTo(startX, gy);
        ctx.lineTo(endX, gy);
    }
    ctx.stroke();

    // Axes
    ctx.lineWidth = 2 / k;
    
    // Y Axis (Green)
    ctx.beginPath();
    ctx.strokeStyle = '#4ade80'; // green-400
    ctx.moveTo(0, startY);
    ctx.lineTo(0, endY);
    ctx.stroke();

    // X Axis (Red)
    ctx.beginPath();
    ctx.strokeStyle = '#f87171'; // red-400
    ctx.moveTo(startX, 0);
    ctx.lineTo(endX, 0);
    ctx.stroke();

    ctx.restore();
};

const renderWatermarkSync = (ctx: CanvasRenderingContext2D, width: number, height: number, watermark: WatermarkSettings, watermarkImg: HTMLImageElement | null) => {
    if (!watermark.enabled || (!watermark.text && watermark.icon === 'none') || watermark.opacity <= 0) return;

    const wx = (watermark.x / 100) * width;
    const wy = (watermark.y / 100) * height;
    
    ctx.save();
    ctx.translate(wx, wy);
    
    ctx.globalAlpha = watermark.opacity; 
    
    ctx.shadowColor = "rgba(0, 0, 0, 0.8)";
    ctx.shadowBlur = 2;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    const wFontSize = 16 * watermark.size;
    
    ctx.font = `bold ${wFontSize}px "Segoe UI", sans-serif`;

    if (watermark.icon !== 'none' && watermarkImg) {
         const iconScale = watermark.iconScale ?? 1;
         const iconSize = wFontSize * 1.5 * iconScale;
         const iconHalf = iconSize / 2;
         
         let iconX = 0;
         if (watermark.text) {
             const textMetrics = ctx.measureText(watermark.text);
             const gap = wFontSize * 0.5;
             const totalWidth = iconSize + gap + textMetrics.width;
             const groupLeft = -totalWidth / 2;
             iconX = groupLeft + iconHalf;
             const textLeft = iconX + iconHalf + gap;
             
             ctx.textAlign = 'left';
             ctx.fillText(watermark.text, textLeft, 0);
         } else {
             iconX = 0;
         }
         
         ctx.drawImage(watermarkImg, iconX - iconHalf, -iconHalf, iconSize, iconSize);
         
    } else if (watermark.text) {
         ctx.fillText(watermark.text, 0, 0);
    }
    
    ctx.restore();
};

export const MosaicEditor: React.FC = () => {
  const [images, setImages] = useState<MosaicImageItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isRestored, setIsRestored] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  
  // Tools
  const [activeTab, setActiveTab] = useState<'tools' | 'effects' | 'export' | 'watermark'>('tools');
  const [brushSize, setBrushSize] = useState(50);
  const [brushType, setBrushType] = useState<'mosaic' | 'white'>('mosaic');
  const [mosaicScale, setMosaicScale] = useState(15); // 15 = 1.5% of min dimension
  
  // Watermark State
  const [watermark, setWatermark] = useState<WatermarkSettings>({
    enabled: false,
    text: '',
    icon: 'none',
    x: 50,
    y: 50,
    opacity: 0.5,
    size: 1,
    iconScale: 1,
  });
  const [watermarkImg, setWatermarkImg] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
      if (watermark.icon === 'none') {
          setWatermarkImg(null);
          return;
      }
      const patreonSvg = `data:image/svg+xml;base64,${btoa('<svg viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg" fill-rule="evenodd" clip-rule="evenodd" stroke-linejoin="round" stroke-miterlimit="2"><g transform="matrix(.47407 0 0 .47407 .383 .422)"><clipPath id="prefix__a"><path d="M0 0h1080v1080H0z"/></clipPath><g clip-path="url(#prefix__a)" fill="white"><path d="M1033.05 324.45c-.19-137.9-107.59-250.92-233.6-291.7-156.48-50.64-362.86-43.3-512.28 27.2-181.1 85.46-237.99 272.66-240.11 459.36-1.74 153.5 13.58 557.79 241.62 560.67 169.44 2.15 194.67-216.18 273.07-321.33 55.78-74.81 127.6-95.94 216.01-117.82 151.95-37.61 255.51-157.53 255.29-316.38z" fillRule="nonzero"/></g></g></svg>')}`;
      const xSvg = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white"><path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" /></svg>')}`;
      
      const img = new Image();
      img.src = watermark.icon === 'patreon' ? patreonSvg : xSvg;
      img.onload = () => setWatermarkImg(img);
  }, [watermark.icon]);
  
  // Last used effect settings (persisted)
  const [defaultVignetteSettings, setDefaultVignetteSettings] = useState<VignetteSettings>(DEFAULT_VIGNETTE);
  
  // Presets State
  const [vignettePresets, setVignettePresets] = useState(DEFAULT_PRESETS);
  const [activePresetIndex, setActivePresetIndex] = useState<number>(0);

  // Export Settings
  const [exportSettings, setExportSettings] = useState({
      zipFilename: 'mosaic_collection',
      textFilename: 'info.txt',
      textContent: '',
      password: ''
  });

  // Viewport State
  const [transform, setTransform] = useState<ViewTransform>({ x: 0, y: 0, k: 1 });
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  
  // Interaction State
  const [isDragging, setIsDragging] = useState(false); // Can be drawing or panning
  const [currentPath, setCurrentPath] = useState<CensorPath | null>(null);
  const lastPointerRef = useRef<{ x: number, y: number } | null>(null);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  
  // Cache the pixelated canvas
  const pixelatedCacheRef = useRef<HTMLCanvasElement | null>(null);

  const activeImage = images.find(img => img.id === activeId);

  // --- Keyboard Listeners (Space Bar & Undo) ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        // Spacebar for panning
        if (e.code === 'Space' && !e.repeat) {
            setIsSpacePressed(true);
        }
        
        // Ctrl+Z or Cmd+Z for Undo
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            document.getElementById('mosaic-undo-btn')?.click();
        }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
        if (e.code === 'Space') {
            setIsSpacePressed(false);
        }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
        window.removeEventListener('keydown', handleKeyDown);
        window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  useEffect(() => {
      if (cursorRef.current && (isSpacePressed || activeTab !== 'tools')) {
          cursorRef.current.style.display = 'none';
      }
  }, [isSpacePressed, activeTab]);

  // --- Persistence Logic ---
  
  // Load on mount
  useEffect(() => {
    const init = async () => {
         let savedActiveId = null;

         // 1. Load Settings from LocalStorage
         try {
            const storedSettings = localStorage.getItem('mosaic_editor_settings');
            if (storedSettings) {
                const s = JSON.parse(storedSettings);
                if (s.brushSize) setBrushSize(s.brushSize);
                if (s.brushType) setBrushType(s.brushType);
                if (s.mosaicScale) setMosaicScale(s.mosaicScale);
                if (s.exportSettings) setExportSettings(prev => ({...prev, ...s.exportSettings}));
                if (s.activeTab) setActiveTab(s.activeTab);
                if (s.activeId) savedActiveId = s.activeId;
                if (s.lastVignette) setDefaultVignetteSettings(s.lastVignette);
                if (s.vignettePresets) setVignettePresets(s.vignettePresets);
                if (typeof s.activePresetIndex === 'number') setActivePresetIndex(s.activePresetIndex);
                if (s.watermark) setWatermark(s.watermark);
            }
         } catch(e) {
             console.warn("Failed to load settings", e);
         }

         // 2. Load Images from IndexedDB
         try {
             const imgs = await loadImagesFromDB();
             if (imgs.length > 0) {
                 setImages(imgs);
                 if (savedActiveId && imgs.some(i => i.id === savedActiveId)) {
                     setActiveId(savedActiveId);
                 } else {
                     setActiveId(imgs[0].id);
                 }
             }
         } catch(e) {
             console.warn("Failed to load images", e);
         } finally {
             setIsRestored(true);
         }
    };
    init();
  }, []);

  // Save on change (Debounced)
  useEffect(() => {
    if (!isRestored) return;

    const t = setTimeout(() => {
        // Save Settings to LocalStorage
        localStorage.setItem('mosaic_editor_settings', JSON.stringify({
            brushSize,
            brushType,
            mosaicScale,
            exportSettings,
            activeTab,
            activeId,
            lastVignette: defaultVignetteSettings,
            vignettePresets,
            activePresetIndex,
            watermark
        }));

        // Save Images to IDB
        saveImagesToDB(images);
    }, 1000);

    return () => clearTimeout(t);
  }, [images, brushSize, brushType, mosaicScale, exportSettings, activeTab, isRestored, activeId, defaultVignetteSettings, vignettePresets, activePresetIndex, watermark]);


  // --- Image Handling ---

  const handleAddImages = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const existingNames = new Set(images.map(img => img.file.name));
      const filesToAdd = Array.from(e.target.files).filter((file: File) => !existingNames.has(file.name));

      if (filesToAdd.length === 0) {
          if (fileInputRef.current) fileInputRef.current.value = '';
          return;
      }

      const newImages = filesToAdd.map((file: File) => ({
        id: Math.random().toString(36).substr(2, 9),
        url: URL.createObjectURL(file),
        file: file,
        censorPaths: [],
        vignette: { ...defaultVignetteSettings } // Use saved default settings
      }));
      
      setImages(prev => [...prev, ...newImages]);
      if (!activeId && newImages.length > 0) {
        handleSelectImage(newImages[0].id);
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeImage = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newImages = images.filter(i => i.id !== id);
    setImages(newImages);
    if (activeId === id) {
        handleSelectImage(newImages.length > 0 ? newImages[0].id : null);
    }
  };

  const handleSelectImage = (id: string | null) => {
      setActiveId(id);
  };

  const updateVignette = (updates: Partial<VignetteSettings>) => {
      if (!activeId) return;
      
      setImages(prev => prev.map(img => {
          if (img.id === activeId) {
              const newVignette = { ...img.vignette, ...updates };
              setDefaultVignetteSettings(newVignette); 
              
              // Auto-save numerical geometry changes to current active preset
              // We exclude 'enabled' and 'color' so presets act as structural templates
              const hasGeometryUpdates = 'opacity' in updates || 'range' in updates || 'softness' in updates || 'cornerRadius' in updates;
              
              if (hasGeometryUpdates) {
                  setVignettePresets(currentPresets => {
                      const newPresets = [...currentPresets];
                      const updatedPreset = { ...newPresets[activePresetIndex] };
                      
                      if ('opacity' in updates) updatedPreset.opacity = updates.opacity!;
                      if ('range' in updates) updatedPreset.range = updates.range!;
                      if ('softness' in updates) updatedPreset.softness = updates.softness!;
                      if ('cornerRadius' in updates) updatedPreset.cornerRadius = updates.cornerRadius!;
                      
                      newPresets[activePresetIndex] = updatedPreset;
                      return newPresets;
                  });
              }

              return { ...img, vignette: newVignette };
          }
          return img;
      }));
  };

  const handleApplyToAll = () => {
      if (!activeImage) return;
      setImages(prev => prev.map(img => {
          if (img.id === activeImage.id) return img;
          return {
              ...img,
              vignette: { ...activeImage.vignette }
          };
      }));
  };

  const handlePresetClick = (index: number) => {
      setActivePresetIndex(index);
      if (activeImage) {
          const preset = vignettePresets[index];
          // Update image with preset values (Geometry only) + Auto Enable
          setImages(prev => prev.map(img => {
              if (img.id === activeId) {
                  return { 
                      ...img, 
                      vignette: { 
                          ...img.vignette, 
                          ...preset, 
                          enabled: true 
                      } 
                  };
              }
              return img;
          }));
      }
  };

  const handleRotate = async (direction: 'left' | 'right') => {
      if (!activeImage) return;

      const img = new Image();
      img.src = activeImage.url;
      await new Promise(r => img.onload = r);

      const w = img.naturalWidth;
      const h = img.naturalHeight;

      const canvas = document.createElement('canvas');
      // Swap dimensions
      canvas.width = h;
      canvas.height = w;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Transform context
      if (direction === 'right') {
          ctx.translate(h, 0);
          ctx.rotate(90 * Math.PI / 180);
      } else {
          ctx.translate(0, w);
          ctx.rotate(-90 * Math.PI / 180);
      }

      ctx.drawImage(img, 0, 0);

      const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/jpeg', 0.95));
      if (!blob) return;
      
      // Revoke old URL to avoid memory leaks
      URL.revokeObjectURL(activeImage.url);
      const newUrl = URL.createObjectURL(blob);
      
      // Need a new File object for persistence because blob urls are transient
      const newFile = new File([blob], activeImage.file.name, { type: 'image/jpeg', lastModified: Date.now() });

      // Rotate Paths
      const newPaths = activeImage.censorPaths.map(path => ({
          ...path,
          points: path.points.map(p => {
              if (direction === 'right') return { x: h - p.y, y: p.x };
              return { x: p.y, y: w - p.x };
          })
      }));

      // Update State
      setImages(prev => prev.map(item => {
          if (item.id === activeId) {
              return {
                  ...item,
                  url: newUrl,
                  file: newFile,
                  censorPaths: newPaths
              };
          }
          return item;
      }));
      
      // Clear cache and reset view
      pixelatedCacheRef.current = null;
      setTimeout(handleResetView, 50);
  };

  const handleClearAllImages = async () => {
    setImages([]);
    setActiveId(null);
    try {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.clear();
    } catch(e) {
        console.error("Failed to clear DB", e);
    }
  };

  // --- Auto-Fit Logic ---
  useEffect(() => {
      const imgItem = images.find(i => i.id === activeId);
      if (!imgItem || !containerRef.current) return;

      const img = new Image();
      img.src = imgItem.url;
      
      const doFit = () => {
          if (!containerRef.current) return;
          const containerW = containerRef.current.clientWidth;
          const containerH = containerRef.current.clientHeight;
          
          // Fit logic (95% coverage)
          const scale = Math.min(
             (containerW * 0.95) / img.naturalWidth, 
             (containerH * 0.95) / img.naturalHeight
          );
          const cx = (containerW - img.naturalWidth * scale) / 2;
          const cy = (containerH - img.naturalHeight * scale) / 2;
          
          setTransform({ x: cx, y: cy, k: scale });
      };

      if (img.complete) {
          doFit();
      } else {
          img.onload = doFit;
      }
  }, [activeId]); 

  // --- Rendering Helpers ---

  const generatePixelatedVersion = (img: HTMLImageElement, width: number, height: number): HTMLCanvasElement => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return canvas;

      // Dynamic pixel size based on mosaicScale state
      const multiplier = Math.max(0.002, mosaicScale / 1000);
      const pixelSize = Math.max(4, Math.floor(Math.min(width, height) * multiplier));

      const wScaled = Math.max(1, Math.ceil(width / pixelSize));
      const hScaled = Math.max(1, Math.ceil(height / pixelSize));

      const off = document.createElement('canvas');
      off.width = wScaled;
      off.height = hScaled;
      const offCtx = off.getContext('2d');
      
      if (offCtx) {
          offCtx.drawImage(img, 0, 0, wScaled, hScaled);
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(off, 0, 0, wScaled, hScaled, 0, 0, width, height);
      }
      return canvas;
  };

  const renderVignette = (ctx: CanvasRenderingContext2D, width: number, height: number, settings: VignetteSettings) => {
    if (!settings.enabled) return;

    const vCanvas = document.createElement('canvas');
    vCanvas.width = width;
    vCanvas.height = height;
    const vCtx = vCanvas.getContext('2d');
    if (!vCtx) return;

    vCtx.fillStyle = settings.color;
    vCtx.globalAlpha = settings.opacity;
    vCtx.fillRect(0, 0, width, height);

    vCtx.globalCompositeOperation = 'destination-out';
    vCtx.globalAlpha = 1;

    const holeW = width * (settings.range / 100);
    const holeH = height * (settings.range / 100);
    const x = (width - holeW) / 2;
    const y = (height - holeH) / 2;

    const minDim = Math.min(width, height);
    const blurPx = minDim * (settings.softness / 800); 

    vCtx.filter = `blur(${blurPx}px)`;

    vCtx.beginPath();
    
    const maxR = Math.min(holeW, holeH) / 2;
    const radius = (settings.cornerRadius / 100) * maxR;

    if (vCtx.roundRect) {
        vCtx.roundRect(x, y, holeW, holeH, radius);
    } else {
        vCtx.rect(x, y, holeW, holeH); 
    }
    
    vCtx.fillStyle = 'black'; 
    vCtx.fill();

    ctx.save();
    ctx.drawImage(vCanvas, 0, 0);
    ctx.restore();
  };

  // Reset cache when image OR mosaic scale changes
  useEffect(() => {
    pixelatedCacheRef.current = null;
  }, [activeId, mosaicScale]);

  // --- Main Render Loop ---
  useEffect(() => {
    if (!activeImage || !canvasRef.current || !containerRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const containerW = containerRef.current.clientWidth;
    const containerH = containerRef.current.clientHeight;
    
    if (canvas.width !== containerW || canvas.height !== containerH) {
        canvas.width = containerW;
        canvas.height = containerH;
    }

    const img = new Image();
    img.src = activeImage.url;

    if (!img.complete) {
        img.onload = () => setTransform(t => ({...t})); 
        return; 
    }

    if (!pixelatedCacheRef.current) {
        pixelatedCacheRef.current = generatePixelatedVersion(img, img.naturalWidth, img.naturalHeight);
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.k, transform.k);
    
    // Draw Infinite Grid (Before Image)
    drawInfiniteGrid(ctx, canvas.width, canvas.height, transform);

    ctx.imageSmoothingEnabled = false;

    // 1. Draw Base
    ctx.drawImage(img, 0, 0);

    // 2. Draw Censor Paths
    ctx.save();
    if (pixelatedCacheRef.current) {
        const pattern = ctx.createPattern(pixelatedCacheRef.current, 'repeat');
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        const renderPath = (p: CensorPath) => {
             if (p.points.length === 0) return;
             ctx.save();
             ctx.lineWidth = p.size;

             if (p.type === 'white') {
                 ctx.strokeStyle = '#ffffff';
                 ctx.fillStyle = '#ffffff';
             } else {
                 if (pattern) {
                     ctx.strokeStyle = pattern;
                     ctx.fillStyle = pattern;
                 }
             }

             ctx.beginPath();
             ctx.moveTo(p.points[0].x, p.points[0].y);
             p.points.forEach(pt => ctx.lineTo(pt.x, pt.y));
             ctx.stroke();
             
             if (p.points.length === 1) {
                 ctx.beginPath();
                 ctx.arc(p.points[0].x, p.points[0].y, p.size/2, 0, Math.PI*2);
                 ctx.fill();
             }
             ctx.restore();
        };

        activeImage.censorPaths.forEach(renderPath);
        if (currentPath) renderPath(currentPath);
    }
    ctx.restore();

    // 3. Draw Vignette
    renderVignette(ctx, img.naturalWidth, img.naturalHeight, activeImage.vignette);

    // 4. Draw Watermark
    renderWatermarkSync(ctx, img.naturalWidth, img.naturalHeight, watermark, watermarkImg);

    ctx.restore();

  }, [activeImage, currentPath, images, transform, mosaicScale, watermark, watermarkImg]);

  // --- Interaction Logic ---

  const getImgCoords = (e: React.PointerEvent | React.WheelEvent) => {
      if (!containerRef.current) return { x: 0, y: 0 };
      const rect = containerRef.current.getBoundingClientRect();
      const clientX = 'clientX' in e ? e.clientX : 0;
      const clientY = 'clientY' in e ? e.clientY : 0;
      
      const canvasX = clientX - rect.left;
      const canvasY = clientY - rect.top;

      return {
          x: (canvasX - transform.x) / transform.k,
          y: (canvasY - transform.y) / transform.k,
          canvasX,
          canvasY
      };
  };

  const handleWheel = (e: React.WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const { canvasX, canvasY } = getImgCoords(e);
      const zoomIntensity = 0.001;
      const delta = -e.deltaY * zoomIntensity;
      const newScale = Math.min(Math.max(0.05, transform.k * (1 + delta)), 20);

      const newX = canvasX - (canvasX - transform.x) * (newScale / transform.k);
      const newY = canvasY - (canvasY - transform.y) * (newScale / transform.k);

      setTransform({ x: newX, y: newY, k: newScale });
  };

  const handlePointerDown = (e: React.PointerEvent) => {
      if (!activeImage) return;
      
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      setIsDragging(true);
      
      const { x, y, canvasX, canvasY } = getImgCoords(e);
      lastPointerRef.current = { x: canvasX, y: canvasY };

      if (isSpacePressed) {
          // Panning
      } else if (activeTab === 'watermark' && watermark.enabled) {
          // Watermark dragging
      } else {
          // Drawing
          if (activeTab === 'tools') {
             setCurrentPath({ points: [{ x, y }], size: brushSize, type: brushType });
          }
      }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
      if (!activeImage) return;

      const { x, y, canvasX, canvasY } = getImgCoords(e);
      
      if (cursorRef.current) {
          if (activeTab === 'tools' && !isSpacePressed) {
              cursorRef.current.style.display = 'block';
              const scaledSize = brushSize * transform.k;
              cursorRef.current.style.width = `${scaledSize}px`;
              cursorRef.current.style.height = `${scaledSize}px`;
              cursorRef.current.style.transform = `translate3d(calc(${canvasX}px - 50%), calc(${canvasY}px - 50%), 0)`;
          } else {
              cursorRef.current.style.display = 'none';
          }
      }

      if (!isDragging) return;
      
      if (isSpacePressed) {
          if (lastPointerRef.current) {
              const dx = canvasX - lastPointerRef.current.x;
              const dy = canvasY - lastPointerRef.current.y;
              setTransform(prev => ({...prev, x: prev.x + dx, y: prev.y + dy}));
              lastPointerRef.current = { x: canvasX, y: canvasY };
          }
      } else if (activeTab === 'watermark' && watermark.enabled) {
          if (lastPointerRef.current) {
              const dx = (canvasX - lastPointerRef.current.x) / transform.k;
              const dy = (canvasY - lastPointerRef.current.y) / transform.k;
              
              const img = new Image();
              img.src = activeImage.url;
              if (!img.complete || !img.naturalWidth) return;
              
              const imgW = img.naturalWidth;
              const imgH = img.naturalHeight;
              
              const dxPct = (dx / imgW) * 100;
              const dyPct = (dy / imgH) * 100;
              
              setWatermark(prev => ({
                  ...prev,
                  x: Math.max(0, Math.min(100, prev.x + dxPct)),
                  y: Math.max(0, Math.min(100, prev.y + dyPct))
              }));
              
              lastPointerRef.current = { x: canvasX, y: canvasY };
          }
      } else {
          if (activeTab === 'tools') {
            setCurrentPath(prev => {
                if (!prev) return null;
                return { ...prev, points: [...prev.points, { x, y }] };
            });
          }
      }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
      if (!isDragging) return;
      
      if (!isSpacePressed && currentPath && activeId && activeTab === 'tools') {
          setImages(prev => prev.map(img => {
              if (img.id === activeId) {
                  return { ...img, censorPaths: [...img.censorPaths, currentPath] };
              }
              return img;
          }));
      }

      setIsDragging(false);
      setCurrentPath(null);
      lastPointerRef.current = null;
  };

  const handlePointerLeave = (e: React.PointerEvent) => {
      handlePointerUp(e);
      if (cursorRef.current) {
          cursorRef.current.style.display = 'none';
      }
  };

  // --- Actions ---

  const handleUndo = () => {
      if (!activeId) return;
      setImages(prev => prev.map(img => {
          if (img.id === activeId && img.censorPaths.length > 0) {
              return { ...img, censorPaths: img.censorPaths.slice(0, -1) };
          }
          return img;
      }));
  };

  const handleClear = () => {
      if (!activeId) return;
      setImages(prev => prev.map(img => {
          if (img.id === activeId) {
              return { ...img, censorPaths: [] };
          }
          return img;
      }));
  };

  const handleDownloadSingle = async () => {
      if (!activeImage) return;

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      const img = new Image();
      img.src = activeImage.url;
      await new Promise(r => img.onload = r);

      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;

      if (ctx) {
          const pixelated = generatePixelatedVersion(img, img.naturalWidth, img.naturalHeight);
          ctx.drawImage(img, 0, 0);
          
          const pattern = ctx.createPattern(pixelated, 'repeat');
          ctx.imageSmoothingEnabled = false;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
              
          const draw = (p: CensorPath) => {
              if (p.points.length === 0) return;
              ctx.save();
              ctx.lineWidth = p.size;
              
              if (p.type === 'white') {
                  ctx.strokeStyle = '#ffffff';
                  ctx.fillStyle = '#ffffff';
              } else if (pattern) {
                  ctx.strokeStyle = pattern;
                  ctx.fillStyle = pattern;
              }

              ctx.beginPath();
              ctx.moveTo(p.points[0].x, p.points[0].y);
              p.points.forEach(pt => ctx.lineTo(pt.x, pt.y));
              ctx.stroke();
              if(p.points.length === 1) {
                    ctx.beginPath();
                    ctx.arc(p.points[0].x, p.points[0].y, p.size/2, 0, Math.PI*2);
                    ctx.fill();
              }
              ctx.restore();
          };
          activeImage.censorPaths.forEach(draw);
          renderVignette(ctx, canvas.width, canvas.height, activeImage.vignette);
          renderWatermarkSync(ctx, canvas.width, canvas.height, watermark, watermarkImg);

          const mimeType = activeImage.file.type || 'image/png';
          canvas.toBlob((blob) => {
              if (blob) {
                  const originalName = activeImage.file.name;
                  const lastDot = originalName.lastIndexOf('.');
                  const baseName = lastDot !== -1 ? originalName.substring(0, lastDot) : originalName;
                  const ext = lastDot !== -1 ? originalName.substring(lastDot) : '.png';
                  const fileName = `${baseName} censor${ext}`;
                  
                  saveBlob(blob, fileName);
              }
          }, mimeType, 0.9);
      }
  };

  const handleDownloadZip = async () => {
    if (images.length === 0) return;
    setIsExporting(true);

    await new Promise(r => setTimeout(r, 50));

    try {
        const password = exportSettings.password.trim();
        const zipWriter = new ZipWriter(new BlobWriter("application/zip"));
        const usedNames = new Set<string>();

        // Options for encrypted files (Images)
        const encryptedOptions: any = {
            level: 5 // Deflate level
        };
        if (password.length > 0) {
            encryptedOptions.password = password;
        }

        // Options for plain files (Text)
        const plainOptions: any = {
            level: 5
        };

        // 1. Add Text File (Always unencrypted)
        if (exportSettings.textContent.trim().length > 0 && exportSettings.textFilename) {
            usedNames.add(exportSettings.textFilename);
            await zipWriter.add(exportSettings.textFilename, new TextReader(exportSettings.textContent), plainOptions);
        }

        // 2. Add Images (Encrypted if password set)
        for (let i = 0; i < images.length; i++) {
            const item = images[i];
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            
            const img = new Image();
            img.src = item.url;
            await new Promise(r => img.onload = r);

            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;

            if (ctx) {
                const pixelated = generatePixelatedVersion(img, img.naturalWidth, img.naturalHeight);
                ctx.drawImage(img, 0, 0);
                
                const pattern = ctx.createPattern(pixelated, 'repeat');
                ctx.imageSmoothingEnabled = false;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                    
                const draw = (p: CensorPath) => {
                    if (p.points.length === 0) return;
                    ctx.save();
                    ctx.lineWidth = p.size;
                    
                    if (p.type === 'white') {
                        ctx.strokeStyle = '#ffffff';
                        ctx.fillStyle = '#ffffff';
                    } else if (pattern) {
                        ctx.strokeStyle = pattern;
                        ctx.fillStyle = pattern;
                    }

                    ctx.beginPath();
                    ctx.moveTo(p.points[0].x, p.points[0].y);
                    p.points.forEach(pt => ctx.lineTo(pt.x, pt.y));
                    ctx.stroke();
                    if(p.points.length === 1) {
                            ctx.beginPath();
                            ctx.arc(p.points[0].x, p.points[0].y, p.size/2, 0, Math.PI*2);
                            ctx.fill();
                    }
                    ctx.restore();
                };
                item.censorPaths.forEach(draw);
                renderVignette(ctx, canvas.width, canvas.height, item.vignette);
                renderWatermarkSync(ctx, canvas.width, canvas.height, watermark, watermarkImg);

                const mimeType = item.file.type || 'image/jpeg';
                const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, mimeType, 0.9));
                if (blob) {
                    // Logic to use original filename with original extension
                    const originalName = item.file.name;
                    const lastDot = originalName.lastIndexOf('.');
                    const baseName = lastDot !== -1 ? originalName.substring(0, lastDot) : originalName;
                    const ext = lastDot !== -1 ? originalName.substring(lastDot) : '.jpg';
                    let fileName = `${baseName}${ext}`;
                    
                    // Simple deduplication if same filenames exist in list
                    let counter = 1;
                    while (usedNames.has(fileName)) {
                        fileName = `${baseName} (${counter})${ext}`;
                        counter++;
                    }
                    usedNames.add(fileName);

                    await zipWriter.add(fileName, new BlobReader(blob), encryptedOptions);
                }
            }
        }

        const zipBlob = await zipWriter.close();
        const zipName = exportSettings.zipFilename.endsWith('.zip') ? exportSettings.zipFilename : `${exportSettings.zipFilename}.zip`;
        saveBlob(zipBlob, zipName);

    } catch (e) {
        console.error("Zip Error:", e);
        alert("Failed to create zip archive.");
    } finally {
        setIsExporting(false);
    }
  };

  const handleResetView = () => {
      if(!activeImage || !containerRef.current) return;
      const img = new Image();
      img.src = activeImage.url;
      const doFit = () => {
          if (!containerRef.current) return;
          const containerW = containerRef.current.clientWidth;
          const containerH = containerRef.current.clientHeight;
          const scale = Math.min(
             (containerW * 0.95) / img.naturalWidth, 
             (containerH * 0.95) / img.naturalHeight
          );
          const cx = (containerW - img.naturalWidth * scale) / 2;
          const cy = (containerH - img.naturalHeight * scale) / 2;
          setTransform({ x: cx, y: cy, k: scale });
      };
      if (img.complete) doFit();
      else img.onload = doFit;
  };

  const hasPassword = exportSettings.password.trim().length > 0;
  const hasTextContent = exportSettings.textContent.trim().length > 0;

  return (
    <div className="w-full h-full flex flex-col gap-3 relative">
        
        {/* Main Workspace */}
        <div 
            ref={containerRef}
            className={`
                flex-1 min-h-[400px] rounded-xl border border-white/5 relative overflow-hidden group/canvas select-none
                ${activeImage ? 'bg-gradient-to-b from-[#353535] to-[#1e1e1e]' : 'bg-zinc-900/50'}
                ${isSpacePressed ? 'cursor-grab active:cursor-grabbing' : (activeImage && activeTab === 'tools' ? 'cursor-none' : (activeImage && activeTab === 'watermark' && watermark.enabled ? 'cursor-move' : 'cursor-default'))}
            `}
        >
            {activeImage ? (
                <>
                    <canvas 
                        ref={canvasRef}
                        className="block touch-none"
                        onWheel={handleWheel}
                        onPointerDown={handlePointerDown}
                        onPointerMove={handlePointerMove}
                        onPointerUp={handlePointerUp}
                        onPointerLeave={handlePointerLeave}
                        onPointerEnter={handlePointerMove}
                    />
                    <div 
                        ref={cursorRef} 
                        className="absolute top-0 left-0 pointer-events-none rounded-full border border-white/80 shadow-[0_0_4px_rgba(0,0,0,0.5)] mix-blend-difference z-50"
                        style={{
                            display: 'none',
                            willChange: 'transform, width, height'
                        }}
                    />
                </>
            ) : (
                <div className="w-full h-full relative overflow-hidden rounded-xl bg-white/5 border border-white/10 backdrop-blur-md flex flex-col items-center justify-center gap-6">
                    <div className="relative w-40 h-[2px] bg-zinc-800/50 rounded-full overflow-hidden">
                        <div className="absolute inset-0 bg-themePrimary/20 blur-[2px] animate-pulse"></div>
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-themePrimary to-transparent w-full h-full -translate-x-full animate-shimmer"></div>
                    </div>
                    <div className="flex flex-col items-center gap-3 text-zinc-400 text-sm font-medium tracking-wide">
                        <ImagePlus size={28} className="opacity-60" />
                        <span>Ready for Input</span>
                    </div>
                </div>
            )}
            
            {activeImage && (
                <div className="absolute top-4 left-4 flex flex-col gap-2">
                    <div className="bg-black/60 backdrop-blur-md rounded-lg border border-white/5 flex flex-col p-1 shadow-xl">
                        <button onClick={() => setTransform(t => ({...t, k: t.k * 1.2}))} className="p-3 hover:bg-white/10 rounded text-zinc-300"><ZoomIn size={20}/></button>
                        <button onClick={() => setTransform(t => ({...t, k: t.k * 0.8}))} className="p-3 hover:bg-white/10 rounded text-zinc-300"><ZoomOut size={20}/></button>
                        <div className="h-px bg-white/10 my-1" />
                        <button onClick={handleResetView} className="p-3 hover:bg-white/10 rounded text-zinc-300" title="Fit to Screen"><Move size={20}/></button>
                    </div>
                </div>
            )}
        </div>

        {/* Toolbar & Strip */}
        <div className="flex flex-col gap-4 bg-zinc-900/80 p-4 rounded-xl border border-white/5 backdrop-blur-sm">
            
            {/* Tools Row */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-6">
                    <input 
                        type="file" 
                        multiple 
                        accept="image/*" 
                        className="hidden" 
                        ref={fileInputRef} 
                        onChange={handleAddImages}
                    />
                    
                    {activeImage && (
                        <div className="flex bg-black/20 backdrop-blur-md rounded-lg p-1 border border-white/10 ml-2">
                             <button 
                                onClick={() => setActiveTab('tools')}
                                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${activeTab === 'tools' ? 'bg-white/10 text-white shadow-sm' : 'text-zinc-400 hover:text-white hover:bg-white/5'}`}
                             >
                                <Brush size={14} /> Tools
                             </button>
                             <button 
                                onClick={() => setActiveTab('effects')}
                                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${activeTab === 'effects' ? 'bg-white/10 text-white shadow-sm' : 'text-zinc-400 hover:text-white hover:bg-white/5'}`}
                             >
                                <Aperture size={14} /> Effects
                             </button>
                             <button 
                                onClick={() => setActiveTab('watermark')}
                                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${activeTab === 'watermark' ? 'bg-white/10 text-white shadow-sm' : 'text-zinc-400 hover:text-white hover:bg-white/5'}`}
                             >
                                <Type size={14} /> Watermark
                             </button>
                             <button 
                                onClick={() => setActiveTab('export')}
                                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${activeTab === 'export' ? 'bg-white/10 text-white shadow-sm' : 'text-zinc-400 hover:text-white hover:bg-white/5'}`}
                             >
                                <FileArchive size={14} /> Export
                             </button>
                        </div>
                    )}

                    {activeImage && activeTab === 'tools' && (
                        <div className="flex items-center pl-4 border-l border-white/10 animate-in fade-in slide-in-from-left-2 duration-200">
                            <div className="flex items-center gap-1 mr-4">
                                <button onClick={() => handleRotate('left')} className="p-2 text-zinc-400 hover:text-white hover:bg-white/10 rounded-md transition-colors" title="Rotate Left"><RotateCcw size={16} /></button>
                                <button onClick={() => handleRotate('right')} className="p-2 text-zinc-400 hover:text-white hover:bg-white/10 rounded-md transition-colors" title="Rotate Right"><RotateCw size={16} /></button>
                            </div>
                            <div className="flex items-center gap-3">
                                <span className="text-xs font-medium text-zinc-400">Size</span>
                                <input type="range" min="20" max="300" value={brushSize} onChange={(e) => setBrushSize(parseInt(e.target.value))} className="w-32 h-1.5 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-white" />
                            </div>
                            {brushType === 'mosaic' && (
                                <div className="flex items-center gap-3 ml-4 border-l border-white/10 pl-4 animate-in fade-in zoom-in duration-200">
                                    <span className="text-xs font-medium text-zinc-400">Block</span>
                                    <input type="range" min="2" max="60" value={mosaicScale} onChange={(e) => setMosaicScale(parseInt(e.target.value))} className="w-24 h-1.5 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-white" />
                                </div>
                            )}
                            <div className="flex bg-black/20 backdrop-blur-md rounded-lg p-1 border border-white/10 ml-4">
                                <button onClick={() => setBrushType('mosaic')} className={`p-1.5 rounded-md transition-all ${brushType === 'mosaic' ? 'bg-white/10 text-white shadow-sm' : 'text-zinc-400 hover:text-white hover:bg-white/5'}`} title="Mosaic Blur"><Grid3X3 size={16} /></button>
                                <button onClick={() => setBrushType('white')} className={`p-1.5 rounded-md transition-all ${brushType === 'white' ? 'bg-white/10 text-white shadow-sm' : 'text-zinc-400 hover:text-white hover:bg-white/5'}`} title="White Paint"><Square size={16} fill="currentColor" /></button>
                            </div>
                        </div>
                    )}

                    {activeImage && activeTab === 'effects' && (
                        <div className="flex items-center gap-4 pl-4 border-l border-white/10 animate-in fade-in slide-in-from-left-2 duration-200">
                             <div className="flex items-center gap-2">
                                <button onClick={() => updateVignette({ enabled: !activeImage.vignette.enabled })} className={`text-xs font-medium px-3 py-1.5 rounded-md border transition-colors ${activeImage.vignette.enabled ? 'bg-white/10 text-white border-white/20' : 'bg-black/20 text-zinc-400 border-transparent hover:text-white hover:bg-white/5'}`}>
                                    {activeImage.vignette.enabled ? 'On' : 'Off'}
                                </button>
                                <button onClick={handleApplyToAll} className="px-3 py-1.5 rounded-md border border-transparent hover:border-white/10 bg-black/20 text-zinc-400 hover:text-white transition-colors">
                                    <span className="text-xs font-medium">Apply All</span>
                                </button>
                             </div>

                             {/* --- PRESETS --- */}
                             <div className="flex items-center gap-2 border-l border-r border-white/10 px-4 mx-2">
                                <span className="text-xs font-medium text-zinc-400 mr-1">Preset</span>
                                {vignettePresets.map((_, idx) => {
                                    // Highlight based on active slot
                                    const isActive = activePresetIndex === idx;
                                    
                                    return (
                                        <button
                                            key={idx}
                                            onClick={() => handlePresetClick(idx)}
                                            className={`
                                                w-7 h-7 flex items-center justify-center text-xs font-medium rounded-md transition-all border
                                                ${isActive 
                                                    ? 'bg-white/10 border-white/20 text-white shadow-sm scale-105' 
                                                    : 'bg-black/20 text-zinc-400 border-white/5 hover:bg-white/5 hover:text-white'
                                                }
                                            `}
                                            title={`Preset ${idx + 1} (Auto-saves changes)`}
                                        >
                                            {idx + 1}
                                        </button>
                                    );
                                })}
                             </div>
                             {/* --- END PRESETS --- */}

                             <input type="color" value={activeImage.vignette.color} onChange={(e) => updateVignette({ color: e.target.value })} className="w-7 h-7 rounded-md bg-transparent border-none cursor-pointer" />
                             {[
                                { l: 'Opacity', k: 'opacity', min: 0, max: 1, step: 0.1, val: activeImage.vignette.opacity },
                                { l: 'Range', k: 'range', min: 0, max: 120, step: 1, val: activeImage.vignette.range },
                                { l: 'Softness', k: 'softness', min: 0, max: 100, step: 1, val: activeImage.vignette.softness },
                                { l: 'Round', k: 'cornerRadius', min: 0, max: 100, step: 1, val: activeImage.vignette.cornerRadius }
                             ].map(s => (
                                <div key={s.l} className="flex flex-col justify-center gap-1.5 w-24">
                                    <label className="text-[10px] font-medium text-zinc-400 leading-none flex justify-between">{s.l} <span className="text-zinc-300">{Math.round(s.k === 'opacity' ? s.val * 100 : s.val)}{s.k === 'opacity' || s.k === 'range' ? '%' : ''}</span></label>
                                    <input type="range" min={s.min} max={s.max} step={s.step} value={s.val} onChange={(e) => updateVignette({ [s.k]: parseFloat(e.target.value) })} className="h-1.5 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-white" />
                                </div>
                             ))}
                        </div>
                    )}

                    {activeImage && activeTab === 'watermark' && (
                        <div className="flex items-center gap-4 pl-4 border-l border-white/10 animate-in fade-in slide-in-from-left-2 duration-200">
                             <div className="flex items-center gap-2">
                                <button onClick={() => setWatermark({...watermark, enabled: !watermark.enabled})} className={`text-xs font-medium px-3 py-1.5 rounded-md border transition-colors ${watermark.enabled ? 'bg-white/10 text-white border-white/20' : 'bg-black/20 text-zinc-400 border-transparent hover:text-white hover:bg-white/5'}`}>
                                    {watermark.enabled ? 'On' : 'Off'}
                                </button>
                             </div>

                             <div className={`flex flex-1 items-center gap-4 transition-opacity duration-300 ${!watermark.enabled ? 'opacity-30 pointer-events-none' : 'opacity-100'}`}>
                                 <input 
                                    type="text" 
                                    value={watermark.text}
                                    onChange={(e) => setWatermark({...watermark, text: e.target.value})}
                                    placeholder="Enter text..."
                                    className="bg-black/20 border border-white/10 rounded-md px-3 py-1.5 text-xs text-white w-32 focus:border-white/30 outline-none transition-colors"
                                 />
                                 
                                 <div className="flex items-center gap-1.5 border-l border-white/10 pl-4">
                                     <button 
                                        onClick={() => setWatermark({...watermark, icon: watermark.icon === 'x' ? 'none' : 'x'})}
                                        className={`w-7 h-7 rounded-md flex items-center justify-center border transition-all ${watermark.icon === 'x' ? 'bg-white border-white text-black' : 'bg-black/20 border-white/5 text-zinc-400 hover:text-white hover:bg-white/5'}`}
                                        title="X (Twitter)"
                                     >
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                                          <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" />
                                        </svg>
                                     </button>
                                     <button 
                                        onClick={() => setWatermark({...watermark, icon: watermark.icon === 'patreon' ? 'none' : 'patreon'})}
                                        className={`w-7 h-7 rounded-md flex items-center justify-center border transition-all ${watermark.icon === 'patreon' ? 'bg-[#FF424D] border-[#FF424D] text-white' : 'bg-black/20 border-white/5 text-zinc-400 hover:text-white hover:bg-white/5'}`}
                                        title="Patreon"
                                     >
                                        <svg width="12" height="12" viewBox="0 0 512 512" fill="currentColor" fillRule="evenodd" clipRule="evenodd" strokeLinejoin="round" strokeMiterlimit="2">
                                            <g transform="matrix(.47407 0 0 .47407 .383 .422)">
                                                <clipPath id="prefix__a"><path d="M0 0h1080v1080H0z"/></clipPath>
                                                <g clipPath="url(#prefix__a)">
                                                    <path d="M1033.05 324.45c-.19-137.9-107.59-250.92-233.6-291.7-156.48-50.64-362.86-43.3-512.28 27.2-181.1 85.46-237.99 272.66-240.11 459.36-1.74 153.5 13.58 557.79 241.62 560.67 169.44 2.15 194.67-216.18 273.07-321.33 55.78-74.81 127.6-95.94 216.01-117.82 151.95-37.61 255.51-157.53 255.29-316.38z" fillRule="nonzero"/>
                                                </g>
                                            </g>
                                        </svg>
                                     </button>
                                 </div>

                                 <div className="flex items-center gap-4 border-l border-white/10 pl-4">
                                     <div className="flex flex-col gap-1.5 w-20">
                                        <label className="text-[10px] font-medium text-zinc-400">Opacity</label>
                                        <input type="range" min="0" max="1" step="0.1" value={watermark.opacity} onChange={(e) => setWatermark({...watermark, opacity: parseFloat(e.target.value)})} className="h-1.5 w-full bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-white" />
                                     </div>
                                     <div className="flex flex-col gap-1.5 w-20">
                                        <label className="text-[10px] font-medium text-zinc-400">Size</label>
                                        <input type="range" min="0.5" max="3" step="0.1" value={watermark.size} onChange={(e) => setWatermark({...watermark, size: parseFloat(e.target.value)})} className="h-1.5 w-full bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-white" />
                                     </div>
                                     <div className="flex flex-col gap-1.5 w-20">
                                        <label className="text-[10px] font-medium text-zinc-400">Logo Size</label>
                                        <input 
                                            type="range" 
                                            min="0.5" 
                                            max="2.5" 
                                            step="0.1" 
                                            value={watermark.iconScale ?? 1} 
                                            onChange={(e) => setWatermark({...watermark, iconScale: parseFloat(e.target.value)})} 
                                            disabled={watermark.icon === 'none'}
                                            className={`h-1.5 w-full bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-white ${watermark.icon === 'none' ? 'opacity-30' : ''}`} 
                                        />
                                     </div>
                                 </div>
                             </div>
                        </div>
                    )}

                    {activeImage && activeTab === 'export' && (
                        <div className="flex items-center gap-6 pl-4 border-l border-white/10 animate-in fade-in slide-in-from-left-2 duration-200">
                             <div className="flex flex-col gap-1.5">
                                <label className="text-[10px] font-medium text-zinc-400">Zip Filename</label>
                                <input type="text" value={exportSettings.zipFilename} onChange={(e) => setExportSettings(s => ({...s, zipFilename: e.target.value}))} className="bg-black/20 border border-white/10 rounded-md px-3 py-1.5 text-xs text-white w-40 outline-none focus:border-white/30 transition-colors" />
                             </div>
                             
                             <button onClick={() => setShowExportModal(true)} className={`flex items-center gap-2 px-3 py-1.5 rounded-md border transition-all ${hasPassword || hasTextContent ? 'bg-white/10 border-white/20 text-white' : 'bg-black/20 border-white/5 text-zinc-400 hover:text-white hover:bg-white/5'}`}>
                                <Settings size={16} />
                                <div className="flex flex-col items-start leading-tight">
                                    <span className="text-xs font-medium">Settings</span>
                                    <span className="text-[10px] opacity-70">
                                        {hasPassword && hasTextContent ? 'Encrypted + Info' : 
                                         hasPassword ? 'Encrypted' : 
                                         hasTextContent ? 'Info Included' : 'Default'}
                                    </span>
                                </div>
                             </button>
                        </div>
                    )}
                </div>

                <div className="flex items-center gap-2">
                    <button onClick={handleClearAllImages} disabled={images.length === 0} className="text-zinc-400 hover:text-red-400 p-2 rounded-md transition-colors disabled:opacity-30" title="Clear Workspace"><Trash2 size={18} /></button>
                    <div className="w-px h-6 bg-white/10 mx-2" />
                    <button id="mosaic-undo-btn" onClick={handleUndo} disabled={!activeImage || activeImage.censorPaths.length === 0} className="p-2 text-zinc-400 hover:text-white hover:bg-white/10 rounded-md disabled:opacity-30 transition-colors"><Undo2 size={18} /></button>
                    <button onClick={handleClear} disabled={!activeImage || activeImage.censorPaths.length === 0} className="p-2 text-zinc-400 hover:text-red-400 hover:bg-red-500/20 rounded-md disabled:opacity-30 transition-colors"><Eraser size={18} /></button>
                    <div className="w-px h-6 bg-white/10 mx-2" />
                    <button onClick={handleDownloadSingle} disabled={!activeImage} className="bg-white/10 text-white hover:bg-white/20 border border-white/10 px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2 transition-all disabled:opacity-50">
                        <FileDown size={16} /> Save
                    </button>
                    <button onClick={handleDownloadZip} disabled={images.length === 0 || isExporting} className="bg-white text-black hover:bg-zinc-200 px-5 py-2 rounded-md text-sm font-medium flex items-center gap-2 transition-all disabled:opacity-50">
                        {isExporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />} 
                        {isExporting ? 'Zipping...' : 'Zip'}
                    </button>
                </div>
            </div>
            
            {/* Image Selection Strip */}
            <div className="w-full border-t border-white/5 pt-6 pb-2 overflow-x-auto no-scrollbar">
                <div className="flex items-center justify-center gap-4 min-w-full w-max px-4">
                    {images.map((img) => {
                        const hasEdits = img.censorPaths.length > 0 || img.vignette.enabled;
                        const isActive = activeId === img.id;
                        return (
                            <div key={img.id} className={`relative shrink-0 group w-24 h-24 transition-transform duration-300 ${isActive ? 'scale-105 z-10' : ''}`}>
                                <button
                                    onClick={() => handleSelectImage(img.id)}
                                    className={`
                                        w-full h-full rounded-xl overflow-hidden border-2 transition-all relative
                                        ${isActive ? 'border-white/50 shadow-lg' : 'border-white/5 opacity-60 hover:opacity-100 hover:border-white/20'}
                                    `}
                                >
                                    <img src={img.url} className="w-full h-full object-cover" alt="thumb" />
                                    
                                    {/* Selection Overlay for hover effect */}
                                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors pointer-events-none" />
                                </button>
                                
                                {/* Indicator inside the frame area but outside the dimmed button */}
                                {hasEdits && (
                                    <div className="absolute bottom-2 left-2 bg-white/20 backdrop-blur-md text-white text-[9px] font-medium px-1.5 py-0.5 rounded border border-white/10 flex items-center gap-1 z-20 pointer-events-none">
                                        <CheckCheck size={10} strokeWidth={2.5} />
                                        <span className="tracking-tight">Edited</span>
                                    </div>
                                )}

                                {/* Delete button positioned visually inside the frame but technically on top */}
                                <button 
                                    onClick={(e) => removeImage(img.id, e)}
                                    className="absolute top-2 right-2 p-1.5 bg-black/40 text-white/80 rounded-md opacity-0 group-hover:opacity-100 transition-all hover:bg-red-500/80 hover:text-white backdrop-blur-md border border-white/10 shadow-sm hover:scale-110 z-20"
                                    title="Remove Image"
                                >
                                    <Trash2 size={14} />
                                </button>
                            </div>
                        )
                    })}
                    
                    {/* Add Button Tile */}
                    <button 
                        onClick={() => fileInputRef.current?.click()}
                        className="relative shrink-0 w-24 h-24 rounded-xl border-2 border-dashed border-white/10 hover:border-white/30 hover:bg-white/5 flex flex-col items-center justify-center gap-2 transition-all text-zinc-400 hover:text-white group"
                    >
                        <div className="p-2 bg-black/20 rounded-full group-hover:bg-white/10 transition-colors">
                                <Upload size={18} />
                        </div>
                        <span className="text-[10px] font-medium tracking-wide">Add</span>
                    </button>
                </div>
            </div>

            {/* Archive Configuration Modal */}
            {showExportModal && createPortal(
                <div className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200" onClick={() => setShowExportModal(false)}>
                    <div className="bg-[#1a1a1a] border border-white/10 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between p-5 border-b border-white/5 bg-white/5">
                            <h3 className="font-medium text-white flex items-center gap-2"><Settings size={18} className="text-zinc-400" /> Archive Configuration</h3>
                            <button onClick={() => setShowExportModal(false)} className="text-zinc-500 hover:text-white transition-colors"><X size={18}/></button>
                        </div>
                        <div className="p-6 flex flex-col gap-6">
                            
                            {/* Metadata Section */}
                            <div className="flex flex-col gap-4">
                                <div className="flex items-center gap-2 text-zinc-500 text-[10px] font-medium uppercase tracking-widest">
                                    <FileText size={12} /> Metadata File
                                </div>
                                <div className="flex flex-col gap-2">
                                    <label className="text-xs font-medium text-zinc-400">Filename</label>
                                    <input type="text" value={exportSettings.textFilename} onChange={(e) => setExportSettings(s => ({...s, textFilename: e.target.value}))} placeholder="info.txt" className="bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-white/30 transition-colors" />
                                </div>
                                <div className="flex flex-col gap-2">
                                    <label className="text-xs font-medium text-zinc-400">Content</label>
                                    <textarea value={exportSettings.textContent} onChange={(e) => setExportSettings(s => ({...s, textContent: e.target.value}))} placeholder="Type your text here..." className="bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:border-white/30 outline-none min-h-[120px] resize-y transition-colors" />
                                </div>
                            </div>

                            <div className="h-px bg-white/5" />

                            {/* Encryption Section */}
                            <div className="flex flex-col gap-4">
                                <div className="flex items-center gap-2 text-zinc-500 text-[10px] font-medium uppercase tracking-widest">
                                    <ShieldCheck size={12} /> Encryption
                                </div>
                                <div className="bg-black/20 p-4 rounded-xl border border-white/5 flex flex-col gap-3">
                                    <label className="text-xs font-medium text-zinc-400 flex justify-between">
                                        Zip Password
                                        <span className="text-[10px] text-zinc-500">Standard ZipCrypto</span>
                                    </label>
                                    <div className="flex items-center gap-2">
                                        <div className="bg-white/5 p-2 rounded-md text-zinc-400 border border-white/5">
                                            <Lock size={14} />
                                        </div>
                                        <input 
                                            type="password" 
                                            value={exportSettings.password} 
                                            onChange={(e) => setExportSettings(s => ({...s, password: e.target.value}))} 
                                            placeholder="Leave empty for no password" 
                                            className="flex-1 bg-black/20 border border-white/10 rounded-md px-3 py-2 text-sm text-white outline-none focus:border-white/30 transition-colors" 
                                        />
                                    </div>
                                    <p className="text-[10px] text-zinc-500 leading-tight">
                                        Note: Password applies only to image files. Metadata file remains unencrypted.
                                    </p>
                                </div>
                            </div>

                        </div>
                        <div className="p-5 border-t border-white/5 bg-white/5 flex justify-end">
                            <button onClick={() => setShowExportModal(false)} className="bg-white text-black hover:bg-zinc-200 px-6 py-2 rounded-lg text-sm font-medium transition-colors">Done</button>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </div>
    </div>
  );
};
