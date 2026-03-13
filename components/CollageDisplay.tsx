
import React, { useRef, useState, useEffect, useMemo } from 'react';
import { ImageItem, CollageLayout, AspectRatio, WatermarkSettings, GlobalBlurSettings } from '../types';
import { Download, Move, Loader2, GripHorizontal } from 'lucide-react';

interface CollageDisplayProps {
  layout: CollageLayout | null;
  images: ImageItem[];
  backgroundUrl: string | null;
  showBorders: boolean;
  labelScale?: number;
  aspectRatio: AspectRatio;
  onLayoutUpdate?: (newLayout: CollageLayout) => void;
  watermark: WatermarkSettings;
  onWatermarkUpdate: (w: WatermarkSettings) => void;
  globalBlur?: GlobalBlurSettings;
}

interface LabelState {
  x: number;
  y: number;
  rotation: number;
}

interface VertexHandle {
  id: string; // unique key "x,y"
  x: number;
  y: number;
  // Which regions and which point index in that region does this handle control?
  refs: { regionIndex: number; pointIndex: number }[]; 
  // Constraints
  isCorner: boolean; // (0,0), (100,0), etc. - locked
  isEdgeX: boolean; // On top/bottom edge - locked to X axis move
  isEdgeY: boolean; // On left/right edge - locked to Y axis move
}

export const CollageDisplay: React.FC<CollageDisplayProps> = ({ 
    layout, 
    images, 
    backgroundUrl, 
    showBorders, 
    labelScale = 1, 
    aspectRatio,
    onLayoutUpdate,
    watermark,
    onWatermarkUpdate,
    globalBlur = { enabled: false, amount: 0 }
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Local state for smooth dragging without parent re-renders
  const [internalLayout, setInternalLayout] = useState<CollageLayout | null>(layout);
  const [isDragging, setIsDragging] = useState(false);
  
  // Ref to store the latest layout during drag to avoid closure staleness on pointerUp
  const dragLayoutRef = useRef<CollageLayout | null>(null);

  const [labelStates, setLabelStates] = useState<Record<string, LabelState>>({});
  const [isDownloading, setIsDownloading] = useState(false);
  const [activeHandleId, setActiveHandleId] = useState<string | null>(null);
  const [imageTransforms, setImageTransforms] = useState<Record<string, { x: number, y: number, scale: number }>>({});

  // Parse Aspect Ratio
  const [rw, rh] = aspectRatio.split(':').map(Number);
  const ratio = rw / rh;

  // Sync prop layout to internal layout when not dragging
  useEffect(() => {
    if (!isDragging) {
        setInternalLayout(layout);
    }
    if (layout === null) {
        setImageTransforms({});
        setLabelStates({});
    }
  }, [layout, isDragging]);

  const renderLayout = internalLayout || layout;

  // --- Helpers ---

  const getImageForRegion = (id: number) => images[id - 1] || null;

  const parsePolygonPoints = (clipPath: string) => {
    return clipPath
      .replace(/polygon\(/i, '')
      .replace(/\)/, '')
      .split(',')
      .map(pair => {
          const parts = pair.trim().split(/\s+/);
          return { x: parseFloat(parts[0]), y: parseFloat(parts[1]) };
      });
  };

  const pointsToClipPath = (points: {x: number, y: number}[]) => {
      return `polygon(${points.map(p => `${p.x}% ${p.y}%`).join(', ')})`;
  };

  const getPolygonBoundingBox = (points: {x: number, y: number}[]) => {
    if (points.length === 0 || points.some(c => isNaN(c.x) || isNaN(c.y))) {
        return { left: 0, top: 0, width: 100, height: 100 };
    }
    let minX = 100, maxX = 0, minY = 100, maxY = 0;
    points.forEach(p => {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
    });
    return {
        left: minX,
        top: minY,
        width: Math.max(maxX - minX, 1), 
        height: Math.max(maxY - minY, 1)
    };
  };

  const pointsToSvgString = (points: {x: number, y: number}[]) => {
     return points.map(p => `${p.x},${p.y}`).join(' ');
  };

  // --- Vertex Handle Logic ---
  
  const handles = useMemo(() => {
    if (!renderLayout) return [];
    
    // Map to group close vertices together
    const handleMap = new Map<string, VertexHandle>();
    
    renderLayout.regions.forEach((region, rIdx) => {
        const points = parsePolygonPoints(region.clipPath);
        points.forEach((pt, pIdx) => {
            // Quantize keys to group float differences (e.g. 33.333 vs 33.334)
            // Use 1% tolerance
            let foundKey = null;
            for (const key of handleMap.keys()) {
                const h = handleMap.get(key)!;
                if (Math.abs(h.x - pt.x) < 0.5 && Math.abs(h.y - pt.y) < 0.5) {
                    foundKey = key;
                    break;
                }
            }
            
            if (foundKey) {
                handleMap.get(foundKey)?.refs.push({ regionIndex: rIdx, pointIndex: pIdx });
            } else {
                const isLeft = Math.abs(pt.x) < 0.5;
                const isRight = Math.abs(pt.x - 100) < 0.5;
                const isTop = Math.abs(pt.y) < 0.5;
                const isBottom = Math.abs(pt.y - 100) < 0.5;
                
                const isCorner = (isLeft || isRight) && (isTop || isBottom);
                const isEdgeX = isTop || isBottom; 
                const isEdgeY = isLeft || isRight;

                // Don't create handles for the 4 static corners of the canvas
                if (!isCorner) {
                     const key = `${pt.x.toFixed(2)},${pt.y.toFixed(2)}`;
                     handleMap.set(key, {
                         id: key,
                         x: pt.x,
                         y: pt.y,
                         refs: [{ regionIndex: rIdx, pointIndex: pIdx }],
                         isCorner,
                         isEdgeX,
                         isEdgeY
                     });
                }
            }
        });
    });

    return Array.from(handleMap.values());
  }, [renderLayout]);


  // --- Interactions ---

  const handleDragStart = (e: React.PointerEvent, handle: VertexHandle) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (!renderLayout) return;

    setActiveHandleId(handle.id);
    setIsDragging(true);

    const startX = e.clientX;
    const startY = e.clientY;
    const rect = containerRef.current?.getBoundingClientRect();

    if (!rect) return;
    
    // Deep clone layout to modify
    const currentLayout = JSON.parse(JSON.stringify(renderLayout)) as CollageLayout;
    // Pre-parse points to avoid repeated parsing during drag
    const allPoints = currentLayout.regions.map(r => parsePolygonPoints(r.clipPath));
    
    // Use RAF to throttle updates
    let animationFrameId: number;

    const onMove = (mv: PointerEvent) => {
        if (!rect) return;
        
        const dxPx = mv.clientX - startX;
        const dyPx = mv.clientY - startY;
        
        const dxPct = (dxPx / rect.width) * 100;
        const dyPct = (dyPx / rect.height) * 100;

        let newX = handle.x + dxPct;
        let newY = handle.y + dyPct;

        // Apply Constraints
        if (handle.isEdgeX) {
            newY = handle.y; // Locked Y
            newX = Math.max(0, Math.min(100, newX));
        } else if (handle.isEdgeY) {
            newX = handle.x; // Locked X
            newY = Math.max(0, Math.min(100, newY));
        } else {
            // Free move inside box
            newX = Math.max(0, Math.min(100, newX));
            newY = Math.max(0, Math.min(100, newY));
        }

        // Update all references in our temporary points structure
        handle.refs.forEach(ref => {
            allPoints[ref.regionIndex][ref.pointIndex] = { x: newX, y: newY };
        });

        // Reconstruct clipPaths
        currentLayout.regions.forEach((r, i) => {
            r.clipPath = pointsToClipPath(allPoints[i]);
        });

        // Store in ref for onUp
        dragLayoutRef.current = currentLayout;
        
        // Schedule visual update
        cancelAnimationFrame(animationFrameId);
        animationFrameId = requestAnimationFrame(() => {
             setInternalLayout({ ...currentLayout });
        });
    };

    const onUp = () => {
        cancelAnimationFrame(animationFrameId);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        
        setActiveHandleId(null);
        setIsDragging(false);

        // Commit final layout to parent
        if (onLayoutUpdate && dragLayoutRef.current) {
            onLayoutUpdate(dragLayoutRef.current);
        }
        dragLayoutRef.current = null;
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const handleWatermarkDrag = (e: React.PointerEvent) => {
      if (!containerRef.current) return;
      e.preventDefault();
      e.stopPropagation();

      const startX = e.clientX;
      const startY = e.clientY;
      const rect = containerRef.current.getBoundingClientRect();
      const startWX = watermark.x;
      const startWY = watermark.y;

      const onMove = (mv: PointerEvent) => {
          const dx = mv.clientX - startX;
          const dy = mv.clientY - startY;
          const dxPct = (dx / rect.width) * 100;
          const dyPct = (dy / rect.height) * 100;
          
          onWatermarkUpdate({
              ...watermark,
              x: Math.max(0, Math.min(100, startWX + dxPct)),
              y: Math.max(0, Math.min(100, startWY + dyPct))
          });
      };

      const onUp = () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
  };

  const handleImagePointerDown = (e: React.PointerEvent, regionId: number) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const startX = e.clientX;
      const startY = e.clientY;
      const current = imageTransforms[regionId] || { x: 0, y: 0, scale: 1.05 };

      const onMove = (mv: PointerEvent) => {
          const dx = mv.clientX - startX;
          const dy = mv.clientY - startY;
          setImageTransforms(prev => ({
              ...prev,
              [regionId]: { ...current, x: current.x + dx / current.scale, y: current.y + dy / current.scale }
          }));
      };

      const onUp = () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
  };

  const handleImageWheel = (e: React.WheelEvent, regionId: number) => {
      e.preventDefault();
      e.stopPropagation();

      const delta = e.deltaY > 0 ? -0.05 : 0.05;
      setImageTransforms(prev => {
          const current = prev[regionId] || { x: 0, y: 0, scale: 1.05 };
          return {
              ...prev,
              [regionId]: { ...current, scale: Math.max(0.1, Math.min(10.0, current.scale + delta)) }
          };
      });
  };

  const handleDownload = async () => {
    if (!renderLayout || !containerRef.current) return;
    setIsDownloading(true);

    try {
        const MAX_DIM = 3840;
        
        let WIDTH = MAX_DIM;
        let HEIGHT = MAX_DIM;

        if (rw > rh) {
            HEIGHT = Math.round(MAX_DIM * (rh / rw));
        } else {
            WIDTH = Math.round(MAX_DIM * (rw / rh));
        }

        const canvas = document.createElement('canvas');
        canvas.width = WIDTH;
        canvas.height = HEIGHT;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error("Canvas context failed");
        
        // --- CREATE BUFFER CANVAS ---
        // We render the collage sharp on this buffer, then draw it blurred onto main canvas
        const compCanvas = document.createElement('canvas');
        compCanvas.width = WIDTH;
        compCanvas.height = HEIGHT;
        const compCtx = compCanvas.getContext('2d');
        if (!compCtx) throw new Error("Composition context failed");

        const domRect = containerRef.current.getBoundingClientRect();
        // Calculate the scale factor between the DOM display and the high-res canvas
        const scaleFactor = WIDTH / domRect.width;

        // 1. Draw Background on Buffer
        compCtx.fillStyle = '#18181b';
        compCtx.fillRect(0, 0, WIDTH, HEIGHT);
        
        if (backgroundUrl) {
            try {
                const bgImg = new Image();
                bgImg.crossOrigin = "anonymous";
                await new Promise((resolve, reject) => {
                    bgImg.onload = resolve;
                    bgImg.onerror = reject;
                    bgImg.src = backgroundUrl;
                });
                const iRatio = bgImg.naturalWidth / bgImg.naturalHeight;
                const cRatio = WIDTH / HEIGHT;
                let dw, dh, dx, dy;
                if (iRatio > cRatio) { dh = HEIGHT; dw = HEIGHT * iRatio; dx = (WIDTH - dw) / 2; dy = 0; }
                else { dw = WIDTH; dh = WIDTH / iRatio; dx = 0; dy = (HEIGHT - dh) / 2; }
                compCtx.drawImage(bgImg, dx, dy, dw, dh);
            } catch (e) { console.warn("BG load failed", e); }
        }

        const loadImage = (url: string) => new Promise<HTMLImageElement>((resolve) => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => resolve(img);
            img.onerror = () => resolve(img);
            img.src = url;
        });

        // 2. Draw Images & Borders on Buffer
        for (const region of renderLayout.regions) {
            const imgItem = getImageForRegion(region.id);
            if (!imgItem) continue;

            const img = await loadImage(imgItem.url);
            const points = parsePolygonPoints(region.clipPath);
            const bbox = getPolygonBoundingBox(points);
            
            const pxPoints = points.map(p => ({ x: p.x/100 * WIDTH, y: p.y/100 * HEIGHT }));
            const pxBbox = {
                left: bbox.left/100 * WIDTH,
                top: bbox.top/100 * HEIGHT,
                width: bbox.width/100 * WIDTH,
                height: bbox.height/100 * HEIGHT
            };

            compCtx.save();
            compCtx.beginPath();
            pxPoints.forEach((p, i) => i === 0 ? compCtx.moveTo(p.x, p.y) : compCtx.lineTo(p.x, p.y));
            compCtx.closePath();
            compCtx.clip();

            const fx = imgItem.focusPoint?.x ?? 50;
            const fy = imgItem.focusPoint?.y ?? 50;
            const iRatio = img.naturalWidth / img.naturalHeight;
            const bRatio = pxBbox.width / pxBbox.height;
            let dw, dh;
            if (iRatio > bRatio) { dh = pxBbox.height; dw = dh * iRatio; }
            else { dw = pxBbox.width; dh = dw / iRatio; }
            const dx = pxBbox.left - (dw - pxBbox.width) * (fx / 100);
            const dy = pxBbox.top - (dh - pxBbox.height) * (fy / 100);
            
            const cx = pxBbox.left + pxBbox.width/2;
            const cy = pxBbox.top + pxBbox.height/2;
            
            const transform = imageTransforms[region.id] || { x: 0, y: 0, scale: 1.05 };
            const scaledTx = transform.x * scaleFactor;
            const scaledTy = transform.y * scaleFactor;

            compCtx.translate(cx, cy);
            compCtx.scale(transform.scale, transform.scale); 
            compCtx.translate(-cx, -cy);

            compCtx.drawImage(img, dx + scaledTx, dy + scaledTy, dw, dh);
            compCtx.restore();

            if (showBorders) {
                compCtx.save();
                compCtx.beginPath();
                pxPoints.forEach((p, i) => i === 0 ? compCtx.moveTo(p.x, p.y) : compCtx.lineTo(p.x, p.y));
                compCtx.closePath();
                // Scale border width (approx 4px in UI * scale)
                compCtx.lineWidth = 4 * scaleFactor;
                compCtx.strokeStyle = 'black';
                compCtx.lineJoin = 'round';
                compCtx.stroke();
                compCtx.restore();
            }
        }
        
        // 3. Draw Buffer onto Main Canvas with Blur (if enabled)
        if (globalBlur.enabled && globalBlur.amount > 0) {
            // Scale blur amount to match high-res canvas
            const scaledBlur = globalBlur.amount * scaleFactor;
            ctx.filter = `blur(${scaledBlur}px)`;
        }
        
        // Draw the composition
        ctx.drawImage(compCanvas, 0, 0);
        
        // Reset Filter for Sharp Overlays (Labels & Watermark)
        ctx.filter = 'none';

        // 4. Draw Labels
        // Hide labels if blur is active
        if (!globalBlur.enabled || globalBlur.amount === 0) {
            renderLayout.regions.forEach((region, idx) => {
                const displayId = region.id || (idx + 1);
                const state = labelStates[String(displayId)] || { x: 0, y: 0, rotation: 0 };
                const lx = parseFloat(region.labelX)/100 * WIDTH;
                const ly = parseFloat(region.labelY)/100 * HEIGHT;
                const dx = lx + (state.x * scaleFactor);
                const dy = ly + (state.y * scaleFactor);
                
                ctx.save();
                ctx.translate(dx, dy);
                ctx.rotate(state.rotation * Math.PI / 180);
                
                // Draw Label Shape
                ctx.shadowColor = 'rgba(0,0,0,0.5)';
                ctx.shadowBlur = 15;
                ctx.shadowOffsetY = 10;
                ctx.fillStyle = 'black';
                ctx.beginPath();
                
                // Base label size is 56px in UI. We apply labelScale.
                const labelSize = 56 * scaleFactor * labelScale;
                const w = labelSize, h = labelSize;
                const hw = w/2, hh = h/2;
                
                // Polygon: 0 0, 100% 0, 100% 50%, 0% 100%
                ctx.moveTo(-hw, -hh); // Top Left
                ctx.lineTo(hw, -hh);  // Top Right
                ctx.lineTo(hw, -hh + (h * 0.5)); // Right Edge at 50%
                ctx.lineTo(-hw, hh);  // Bottom Left
                
                ctx.closePath();
                ctx.fill();
                
                ctx.shadowColor = 'transparent';
                ctx.rotate(-state.rotation * Math.PI / 180);
                ctx.fillStyle = 'white';
                
                // Dynamic Font Size: Base is ~21px. Apply labelScale.
                const fontSize = 21 * scaleFactor * labelScale; 
                // Explicitly match the DOM font stack: Segoe UI, then system-ui, then sans-serif
                ctx.font = `900 ${fontSize}px "Segoe UI", system-ui, sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                
                const verticalCorrection = -(fontSize * 0.1);

                ctx.fillText(String(displayId), 0, verticalCorrection);
                
                ctx.restore();
            });
        }

        // 5. Draw Watermark
        if (watermark.enabled && (watermark.text || watermark.icon !== 'none') && watermark.opacity > 0) {
            const wx = (watermark.x / 100) * WIDTH;
            const wy = (watermark.y / 100) * HEIGHT;
            
            ctx.save();
            ctx.translate(wx, wy);
            
            // Use user-defined opacity to match preview
            ctx.globalAlpha = watermark.opacity; 
            
            // Shadow for readability on bright backgrounds
            ctx.shadowColor = "rgba(0, 0, 0, 0.8)";
            // Scale shadow to match preview visibility
            ctx.shadowBlur = 2 * scaleFactor;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;
            
            ctx.fillStyle = '#FFFFFF';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            
            // Base font size is 16px in DOM (Tailwind default).
            // In DOM, container is scaled by watermark.size.
            // So effective font size in canvas should be 16 * scaleFactor * watermark.size.
            const wFontSize = 16 * scaleFactor * watermark.size;
            
            // Changed to Segoe UI per user request
            ctx.font = `bold ${wFontSize}px "Segoe UI", sans-serif`;

            // Draw Icon if selected
            if (watermark.icon !== 'none') {
                 // In DOM, Icon is 24px base. Text is 16px base. Ratio is 1.5.
                 // So Icon Size should be 1.5 * wFontSize * iconScale.
                 const iconScale = watermark.iconScale ?? 1;
                 const iconSize = wFontSize * 1.5 * iconScale;
                 const iconHalf = iconSize / 2;
                 
                 // SVG Data URIs with white fill
                 
                 // Patreon: Specific SVG provided by user
                 const patreonSvg = `data:image/svg+xml;base64,${btoa('<svg viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg" fill-rule="evenodd" clip-rule="evenodd" stroke-linejoin="round" stroke-miterlimit="2"><g transform="matrix(.47407 0 0 .47407 .383 .422)"><clipPath id="prefix__a"><path d="M0 0h1080v1080H0z"/></clipPath><g clip-path="url(#prefix__a)" fill="white"><path d="M1033.05 324.45c-.19-137.9-107.59-250.92-233.6-291.7-156.48-50.64-362.86-43.3-512.28 27.2-181.1 85.46-237.99 272.66-240.11 459.36-1.74 153.5 13.58 557.79 241.62 560.67 169.44 2.15 194.67-216.18 273.07-321.33 55.78-74.81 127.6-95.94 216.01-117.82 151.95-37.61 255.51-157.53 255.29-316.38z" fillRule="nonzero"/></g></g></svg>')}`;
                 
                 // X: blackboard bold X
                 const xSvg = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white"><path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" /></svg>')}`;
                 
                 const img = new Image();
                 img.src = watermark.icon === 'patreon' ? patreonSvg : xSvg;
                 
                 await new Promise((resolve) => {
                     if (img.complete) resolve(true);
                     img.onload = () => resolve(true);
                     img.onerror = () => resolve(true);
                 });
                 
                 let iconX = 0;
                 if (watermark.text) {
                     const textMetrics = ctx.measureText(watermark.text);
                     // Gap is gap-2 (8px) in DOM. 8/16 = 0.5em.
                     const gap = wFontSize * 0.5;
                     
                     const totalWidth = iconSize + gap + textMetrics.width;
                     
                     // Center the entire group (Icon + Gap + Text) at 0
                     const groupLeft = -totalWidth / 2;
                     
                     // Center of icon relative to group start
                     iconX = groupLeft + iconHalf;
                     
                     // Text start position (Left aligned)
                     const textLeft = iconX + iconHalf + gap;
                     
                     // Switch to left alignment to draw text immediately after icon
                     ctx.textAlign = 'left';
                     ctx.fillText(watermark.text, textLeft, 0);
                 } else {
                     iconX = 0;
                 }
                 
                 // Draw icon centered vertically at iconX
                 ctx.drawImage(img, iconX - iconHalf, -iconHalf, iconSize, iconSize);
                 
            } else if (watermark.text) {
                 // Center aligned for text-only
                 ctx.fillText(watermark.text, 0, 0);
            }
            
            ctx.restore();
        }

        const dataUrl = canvas.toDataURL('image/png', 1.0);
        const link = document.createElement('a');
        link.download = `collage-mixer-${Date.now()}.png`;
        link.href = dataUrl;
        link.click();
    } catch (e) {
        console.error("Download failed", e);
        alert("Could not generate high-res export.");
    } finally {
        setIsDownloading(false);
    }
  };

  const handleLabelPointerDown = (e: React.PointerEvent, id: string | number) => {
    e.preventDefault();
    e.stopPropagation();
    const key = String(id);
    const startX = e.clientX;
    const startY = e.clientY;
    const current = labelStates[key] || { x: 0, y: 0, rotation: 0 };
    const onMove = (mv: PointerEvent) => {
      const dx = mv.clientX - startX;
      const dy = mv.clientY - startY;
      setLabelStates(prev => ({
        ...prev,
        [key]: { ...current, x: current.x + dx, y: current.y + dy, rotation: current.rotation }
      }));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const handleLabelWheel = (e: React.WheelEvent, id: string | number) => {
    e.preventDefault();
    e.stopPropagation();
    const key = String(id);
    const delta = e.deltaY > 0 ? 5 : -5;
    setLabelStates(prev => {
        const current = prev[key] || { x: 0, y: 0, rotation: 0 };
        return { ...prev, [key]: { ...current, rotation: current.rotation + delta } };
    });
  };

  // Extract icon scale from watermark settings for React render
  const iconScale = watermark.iconScale ?? 1;
  const iconSize = 24 * iconScale;

  return (
    <div className="w-full flex flex-col items-center justify-center p-0 md:p-4">
        
        {/* The canvas container needs to fit in the available space */}
        <div className="w-full flex items-center justify-center relative">
            {!renderLayout ? (
                <div 
                    className="w-full relative rounded-3xl overflow-hidden bg-white/5 shadow-2xl transition-all duration-500 border border-white/10 backdrop-blur-sm" 
                    style={{ 
                        aspectRatio: `${rw}/${rh}`,
                        maxWidth: `calc(75vh * ${ratio})`
                    }}
                >
                    {/* Placeholder Content */}
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-2xl rounded-3xl flex flex-col items-center justify-center gap-6">
                        <div className="relative w-48 h-[3px] bg-white/10 rounded-full overflow-hidden">
                            <div className="absolute inset-0 bg-blue-500/30 blur-[4px] animate-pulse"></div>
                            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-blue-400 to-transparent w-full h-full -translate-x-full animate-shimmer"></div>
                        </div>
                        <p className="text-zinc-400 font-semibold text-sm uppercase tracking-[0.3em] animate-pulse">
                            Ready for Input
                        </p>
                    </div>
                </div>
            ) : (
                <div 
                  ref={containerRef}
                  className="relative bg-black/40 overflow-hidden shadow-2xl ring-1 ring-white/10 rounded-2xl group/container touch-none transition-all duration-500 w-full backdrop-blur-sm"
                  style={{
                    aspectRatio: `${rw}/${rh}`,
                    maxWidth: `calc(75vh * ${ratio})`,
                    marginLeft: 'auto',
                    marginRight: 'auto'
                  }}
                >
                  {/* WRAPPER FOR BLURRED CONTENT (Background + Images + Borders) */}
                  <div 
                    className="absolute inset-0" 
                    style={{ 
                        filter: globalBlur.enabled && globalBlur.amount > 0 ? `blur(${globalBlur.amount}px)` : 'none',
                        // Move background styles here so they get blurred too
                        backgroundImage: backgroundUrl ? `url(${backgroundUrl})` : 'none',
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                        // Ensure background fills this div
                        backgroundColor: '#18181b',
                    }}
                  >
                      {renderLayout.regions.map((region) => {
                        const img = getImageForRegion(region.id);
                        if (!img) return null;
                        const focusX = img.focusPoint?.x ?? 50;
                        const focusY = img.focusPoint?.y ?? 50;
                        const points = parsePolygonPoints(region.clipPath);
                        const bbox = getPolygonBoundingBox(points);
                        const transform = imageTransforms[region.id] || { x: 0, y: 0, scale: 1.05 };

                        return (
                          <div
                            key={`img-${region.id}`}
                            className="absolute inset-0 pointer-events-none"
                            style={{ clipPath: region.clipPath, zIndex: region.zIndex || 1, willChange: isDragging ? 'clip-path' : 'auto' }}
                          >
                            <div 
                                className="absolute overflow-hidden bg-zinc-800 cursor-move touch-none"
                                style={{
                                    left: `${bbox.left}%`,
                                    top: `${bbox.top}%`,
                                    width: `${bbox.width}%`,
                                    height: `${bbox.height}%`,
                                    pointerEvents: 'auto'
                                }}
                                onPointerDown={(e) => handleImagePointerDown(e, region.id)}
                                onWheel={(e) => handleImageWheel(e, region.id)}
                            >
                              <img
                                src={img.url}
                                alt={`slice-${region.id}`}
                                className="w-full h-full object-cover"
                                style={{ 
                                    objectPosition: `calc(${focusX}% + ${transform.x}px) calc(${focusY}% + ${transform.y}px)`, 
                                    transform: `scale(${transform.scale})`,
                                    transformOrigin: 'center'
                                }}
                              />
                              <div className="absolute inset-0 bg-black/0 hover:bg-black/10 transition-colors pointer-events-none" />
                            </div>
                          </div>
                        );
                      })}
                       
                       {showBorders && (
                           <svg className="absolute inset-0 w-full h-full pointer-events-none z-40" viewBox="0 0 100 100" preserveAspectRatio="none">
                              {renderLayout.regions.map(region => (
                                  <polygon 
                                    key={`border-main-${region.id}`}
                                    points={pointsToSvgString(parsePolygonPoints(region.clipPath))}
                                    fill="none"
                                    stroke="black"
                                    strokeWidth="4" 
                                    strokeLinejoin="round"
                                    vectorEffect="non-scaling-stroke"
                                    className="drop-shadow-2xl"
                                  />
                              ))}
                           </svg>
                       )}
                  </div>
                  {/* END OF BLURRED CONTENT WRAPPER */}

                    {/* Vertices Handles - Outside Blur */}
                    {handles.map(handle => (
                        <div
                            key={handle.id}
                            className={`absolute z-[60] w-8 h-8 -ml-4 -mt-4 flex items-center justify-center cursor-move transition-opacity duration-300
                                ${activeHandleId ? (activeHandleId === handle.id ? 'opacity-100' : 'opacity-0') : 'opacity-0 group-hover/container:opacity-100'}
                            `}
                            style={{ left: `${handle.x}%`, top: `${handle.y}%` }}
                            onPointerDown={(e) => handleDragStart(e, handle)}
                        >
                            <div className={`w-3 h-3 bg-white border-2 border-black rounded-full shadow-lg transition-transform ${activeHandleId === handle.id ? 'scale-150 bg-accent' : 'hover:scale-150'}`} />
                        </div>
                    ))}

                   {/* Labels - Outside Blur - Hidden when blurred */}
                   {(!globalBlur.enabled || globalBlur.amount === 0) && renderLayout.regions.map((region, idx) => {
                     const displayId = region.id || (idx + 1);
                     const state = labelStates[String(displayId)] || { x: 0, y: 0, rotation: 0 };
                     const baseSize = 56; // Base size of the label (w-14)
                     const scaledSize = baseSize * labelScale;
                     
                     return (
                       <div 
                          key={`label-${displayId}`}
                          className="absolute flex items-center justify-center z-50 cursor-move touch-none pb-[0.1em]"
                          onPointerDown={(e) => handleLabelPointerDown(e, displayId)}
                          onWheel={(e) => handleLabelWheel(e, displayId)}
                          title="Drag to move, Scroll to rotate"
                          style={{
                            left: `calc(${region.labelX} + ${state.x}px)`,
                            top: `calc(${region.labelY} + ${state.y}px)`,
                            width: `${scaledSize}px`,
                            height: `${scaledSize}px`,
                            fontSize: `${1.25 * labelScale}rem`, // text-xl is 1.25rem
                            transform: `translate(-50%, -50%) rotate(${state.rotation}deg)`,
                            backgroundColor: 'black',
                            clipPath: 'polygon(0 0, 100% 0, 100% 50%, 0% 100%)',
                            filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.5))'
                          }}
                        >
                          <span 
                            className="text-white font-sans font-black leading-none select-none pointer-events-none"
                            style={{ transform: `rotate(${-state.rotation}deg)` }}
                          >
                            {displayId}
                          </span>
                        </div>
                     );
                   })}
                   
                   {/* Watermark Overlay - Outside Blur */}
                   {watermark.enabled && (watermark.text || watermark.icon !== 'none') && watermark.opacity > 0 && (
                       <div 
                         className="absolute z-[70] cursor-move select-none flex items-center gap-2 whitespace-nowrap"
                         style={{
                             left: `${watermark.x}%`,
                             top: `${watermark.y}%`,
                             opacity: watermark.opacity,
                             transform: `translate(-50%, -50%) scale(${watermark.size})`,
                             fontSize: '16px', // Enforce base font size to match canvas logic
                             fontFamily: '"Segoe UI", sans-serif',
                             fontWeight: 'bold',
                             color: 'white',
                             // Shadow for brightness readability
                             filter: 'drop-shadow(0 0 2px rgba(0,0,0,0.8))'
                         }}
                         onPointerDown={handleWatermarkDrag}
                       >
                           {watermark.icon === 'patreon' && (
                                <svg width={iconSize} height={iconSize} viewBox="0 0 512 512" fill="currentColor" fillRule="evenodd" clipRule="evenodd" strokeLinejoin="round" strokeMiterlimit="2">
                                    <g transform="matrix(.47407 0 0 .47407 .383 .422)">
                                        <clipPath id="prefix__a"><path d="M0 0h1080v1080H0z"/></clipPath>
                                        <g clipPath="url(#prefix__a)" fill="white"><path d="M1033.05 324.45c-.19-137.9-107.59-250.92-233.6-291.7-156.48-50.64-362.86-43.3-512.28 27.2-181.1 85.46-237.99 272.66-240.11 459.36-1.74 153.5 13.58 557.79 241.62 560.67 169.44 2.15 194.67-216.18 273.07-321.33 55.78-74.81 127.6-95.94 216.01-117.82 151.95-37.61 255.51-157.53 255.29-316.38z" fillRule="nonzero"/>
                                        </g>
                                    </g>
                                </svg>
                           )}
                           {watermark.icon === 'x' && (
                                <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="currentColor">
                                  <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" />
                                </svg>
                           )}
                           {watermark.text && <span style={{ textShadow: '0 0 2px rgba(0,0,0,0.8)' }}>{watermark.text}</span>}
                       </div>
                   )}
                   
                   <div className="absolute bottom-2 right-2 z-50 opacity-0 group-hover/container:opacity-100 transition-opacity pointer-events-none flex flex-col items-end gap-1">
                        <div className="bg-black/80 text-white text-[9px] px-2 py-1 rounded font-mono border border-white/10 flex items-center gap-2">
                            <GripHorizontal size={8} />
                            <span>DRAG POINTS TO RESIZE</span>
                        </div>
                        <div className="bg-black/80 text-white text-[9px] px-2 py-1 rounded font-mono border border-white/10 flex items-center gap-2">
                            <Move size={8} />
                            <span>DRAG LABEL • SCROLL TO ROTATE</span>
                        </div>
                   </div>
                   
                   {/* Export Button Overlay - Only visible when layout exists */}
                   <div className="absolute top-2 right-2 z-50 opacity-0 group-hover/container:opacity-100 transition-opacity">
                        <button 
                            onClick={handleDownload} 
                            disabled={isDownloading}
                            className="bg-zinc-900/90 hover:bg-black border border-white/10 text-zinc-300 hover:text-white px-3 py-1.5 rounded-lg flex items-center gap-2 transition-all shadow-lg backdrop-blur-md"
                        >
                             {isDownloading ? <Loader2 size={12} className="animate-spin text-accent" /> : <Download size={12} />} 
                             <span className="text-[10px] font-mono font-bold">{isDownloading ? 'SAVING...' : 'SAVE PNG'}</span>
                        </button>
                   </div>
                </div>
            )}
        </div>
    </div>
  );
};
