import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Upload, Settings, Image as ImageIcon, Film, Play, Pause, Download, Trash2, Loader2, AlertCircle, Archive, Plus, Minus } from 'lucide-react';
import JSZip from 'jszip';

interface ExtractedFrame {
  id: string;
  url: string;
}

export const GifMaker: React.FC = () => {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoDuration, setVideoDuration] = useState<number>(0);
  
  // Extraction Options
  const [numFrames, setNumFrames] = useState<number>(() => {
    const saved = localStorage.getItem('gifMaker_numFrames');
    return saved ? Number(saved) : 10;
  });
  const [frameDistance, setFrameDistance] = useState<number>(() => {
    const saved = localStorage.getItem('gifMaker_frameDistance');
    return saved ? Number(saved) : 100;
  }); // in ms
  const [compression, setCompression] = useState<number>(() => {
    const saved = localStorage.getItem('gifMaker_compression');
    return saved ? Number(saved) : 80;
  }); // 1 to 100 JPG quality
  const [resolutionScale, setResolutionScale] = useState<number>(() => {
    const saved = localStorage.getItem('gifMaker_resolutionScale');
    return saved ? Number(saved) : 100;
  }); // 10 to 100%
  
  // State
  const [isExtracting, setIsExtracting] = useState(false);
  const [isZipping, setIsZipping] = useState(false);
  const [extractedFrames, setExtractedFrames] = useState<ExtractedFrame[]>([]);
  const [progress, setProgress] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  
  // Playback Options
  const [playbackDelay, setPlaybackDelay] = useState<number>(() => {
    const saved = localStorage.getItem('gifMaker_playbackDelay');
    return saved ? Number(saved) : 100;
  }); // delay in ms
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);

  // Save settings to localStorage
  useEffect(() => {
    localStorage.setItem('gifMaker_numFrames', numFrames.toString());
    localStorage.setItem('gifMaker_frameDistance', frameDistance.toString());
    localStorage.setItem('gifMaker_compression', compression.toString());
    localStorage.setItem('gifMaker_resolutionScale', resolutionScale.toString());
    localStorage.setItem('gifMaker_playbackDelay', playbackDelay.toString());
  }, [numFrames, frameDistance, compression, resolutionScale, playbackDelay]);

  useEffect(() => {
    if (videoFile) {
      const url = URL.createObjectURL(videoFile);
      setVideoUrl(url);
      return () => URL.revokeObjectURL(url);
    }
  }, [videoFile]);

  const handleVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith('video/')) {
      setVideoFile(file);
      setExtractedFrames([]);
      setIsPlaying(false);
      setCurrentFrameIndex(0);
      setError(null);
    } else if (file) {
      setError("Please upload a valid video file.");
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      const duration = videoRef.current.duration;
      setVideoDuration(duration);
      setNumFrames(Math.floor((duration * 1000) / frameDistance) + 1);
    }
  };

  const handleNumFramesChange = (val: number) => {
    const newNum = Math.max(2, val);
    setNumFrames(newNum);
    if (videoDuration > 0) {
      const dist = (videoDuration * 1000) / (newNum - 1);
      setFrameDistance(Number(dist.toFixed(2)));
    }
  };

  const handleFrameDistanceChange = (val: number) => {
    const newDist = Math.max(0.1, val);
    setFrameDistance(newDist);
    if (videoDuration > 0) {
      const frames = Math.floor((videoDuration * 1000) / newDist) + 1;
      setNumFrames(frames);
    }
  };

  const initWebGPU = async (width: number, height: number) => {
    if (!navigator.gpu) return null;
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) return null;
      const device = await adapter.requestDevice();
      
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('webgpu');
      if (!context) return null;

      const format = navigator.gpu.getPreferredCanvasFormat();
      context.configure({
        device,
        format,
        alphaMode: 'premultiplied',
      });

      const shaderCode = `
        struct VertexOutput {
          @builtin(position) position : vec4<f32>,
          @location(0) uv : vec2<f32>,
        }

        @vertex
        fn vs_main(@builtin(vertex_index) VertexIndex : u32) -> VertexOutput {
          var pos = array<vec2<f32>, 6>(
            vec2<f32>(-1.0, -1.0),
            vec2<f32>( 1.0, -1.0),
            vec2<f32>(-1.0,  1.0),
            vec2<f32>(-1.0,  1.0),
            vec2<f32>( 1.0, -1.0),
            vec2<f32>( 1.0,  1.0)
          );
          var uv = array<vec2<f32>, 6>(
            vec2<f32>(0.0, 1.0),
            vec2<f32>(1.0, 1.0),
            vec2<f32>(0.0, 0.0),
            vec2<f32>(0.0, 0.0),
            vec2<f32>(1.0, 1.0),
            vec2<f32>(1.0, 0.0)
          );
          var output : VertexOutput;
          output.position = vec4<f32>(pos[VertexIndex], 0.0, 1.0);
          output.uv = uv[VertexIndex];
          return output;
        }

        @group(0) @binding(0) var mySampler: sampler;
        @group(0) @binding(1) var myTexture: texture_2d<f32>;

        @fragment
        fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
          return textureSample(myTexture, mySampler, uv);
        }
      `;

      const module = device.createShaderModule({ code: shaderCode });
      const pipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: { module, entryPoint: 'vs_main' },
        fragment: { module, entryPoint: 'fs_main', targets: [{ format }] },
        primitive: { topology: 'triangle-list' },
      });

      const sampler = device.createSampler({
        magFilter: 'linear',
        minFilter: 'linear',
      });

      return { device, context, pipeline, sampler, canvas, format };
    } catch (e) {
      console.warn("WebGPU initialization failed, falling back to Canvas 2D", e);
      return null;
    }
  };

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isPlaying && extractedFrames.length > 0) {
      interval = setInterval(() => {
        setCurrentFrameIndex((prev) => (prev + 1) % extractedFrames.length);
      }, playbackDelay);
    }
    return () => clearInterval(interval);
  }, [isPlaying, playbackDelay, extractedFrames.length]);

  const extractFrames = async () => {
    if (!videoRef.current || !videoUrl) return;
    
    setIsExtracting(true);
    setError(null);
    setProgress(0);
    setExtractedFrames([]);
    setIsPlaying(false);
    setCurrentFrameIndex(0);

    const video = videoRef.current;
    const originalWidth = video.videoWidth;
    const originalHeight = video.videoHeight;
    const targetWidth = Math.floor(originalWidth * (resolutionScale / 100));
    const targetHeight = Math.floor(originalHeight * (resolutionScale / 100));

    const frames: ExtractedFrame[] = [];
    
    // Try WebGPU first
    const gpu = await initWebGPU(targetWidth, targetHeight);
    
    // Fallback 2D canvas for final read or if WebGPU fails
    const canvas2d = document.createElement('canvas');
    canvas2d.width = targetWidth;
    canvas2d.height = targetHeight;
    const ctx2d = canvas2d.getContext('2d', { willReadFrequently: true });

    if (!ctx2d) {
      setError("Failed to create 2D canvas context.");
      setIsExtracting(false);
      return;
    }

    try {
      let lastExtractedTime = -1;
      for (let i = 0; i < numFrames; i++) {
        let time = i * (frameDistance / 1000);
        if (time > videoDuration) time = videoDuration;
        
        if (time === lastExtractedTime) break;
        lastExtractedTime = time;
        
        await new Promise<void>((resolve) => {
          const onSeeked = () => {
            video.removeEventListener('seeked', onSeeked);
            resolve();
          };
          video.addEventListener('seeked', onSeeked);
          video.currentTime = time;
        });

        if (gpu) {
          // WebGPU Path
          const srcTexture = gpu.device.createTexture({
            size: [originalWidth, originalHeight, 1],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
          });

          gpu.device.queue.copyExternalImageToTexture(
            { source: video },
            { texture: srcTexture },
            [originalWidth, originalHeight]
          );

          const bindGroup = gpu.device.createBindGroup({
            layout: gpu.pipeline.getBindGroupLayout(0),
            entries: [
              { binding: 0, resource: gpu.sampler },
              { binding: 1, resource: srcTexture.createView() },
            ],
          });

          const commandEncoder = gpu.device.createCommandEncoder();
          const textureView = gpu.context.getCurrentTexture().createView();
          const renderPass = commandEncoder.beginRenderPass({
            colorAttachments: [{
              view: textureView,
              clearValue: { r: 0, g: 0, b: 0, a: 1 },
              loadOp: 'clear',
              storeOp: 'store',
            }],
          });
          renderPass.setPipeline(gpu.pipeline);
          renderPass.setBindGroup(0, bindGroup);
          renderPass.draw(6);
          renderPass.end();
          gpu.device.queue.submit([commandEncoder.finish()]);

          // Draw WebGPU canvas to 2D canvas to get data URL and ImageData
          ctx2d.drawImage(gpu.canvas, 0, 0);
          srcTexture.destroy();
        } else {
          // Canvas 2D Fallback Path
          ctx2d.drawImage(video, 0, 0, targetWidth, targetHeight);
        }

        const quality = compression / 100;
        const dataUrl = canvas2d.toDataURL('image/jpeg', quality);

        frames.push({
          id: Math.random().toString(36).substr(2, 9),
          url: dataUrl
        });

        setProgress(((i + 1) / numFrames) * 100);
      }

      setExtractedFrames(frames);
    } catch (err) {
      console.error(err);
      setError("An error occurred during frame extraction.");
    } finally {
      setIsExtracting(false);
    }
  };

  const downloadZip = async () => {
    if (extractedFrames.length === 0) return;
    
    setIsZipping(true);
    setError(null);
    
    try {
      const zip = new JSZip();
      
      for (let i = 0; i < extractedFrames.length; i++) {
        const frame = extractedFrames[i];
        // Convert data URL to blob
        const response = await fetch(frame.url);
        const blob = await response.blob();
        
        // Add to zip with zero-padded filename
        const filename = `frame_${String(i + 1).padStart(4, '0')}.jpg`;
        zip.file(filename, blob);
        
        setProgress(((i + 1) / extractedFrames.length) * 100);
      }
      
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(zipBlob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = 'extracted_frames.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
    } catch (err) {
      console.error(err);
      setError("Failed to create ZIP file.");
    } finally {
      setIsZipping(false);
    }
  };

  return (
    <div className="w-full max-w-6xl mx-auto space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Upload & Options */}
        <div className="lg:col-span-1 space-y-6">
          {/* Upload Area */}
          <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-6">
            <h3 className="text-sm font-bold text-zinc-400 uppercase tracking-widest mb-4">Source Video</h3>
            
            {!videoFile ? (
              <label className="flex flex-col items-center justify-center w-full h-48 border-2 border-dashed border-white/20 rounded-2xl cursor-pointer hover:bg-white/5 hover:border-white/40 transition-all group">
                <div className="p-4 bg-white/5 rounded-full mb-3 group-hover:scale-110 transition-transform">
                  <Upload className="w-8 h-8 text-zinc-400 group-hover:text-white transition-colors" />
                </div>
                <span className="text-sm font-medium text-zinc-300">Click to upload video</span>
                <span className="text-xs text-zinc-500 mt-1">MP4, WebM, MOV</span>
                <input type="file" accept="video/*" className="hidden" onChange={handleVideoUpload} />
              </label>
            ) : (
              <div className="space-y-4">
                <div className="relative rounded-2xl overflow-hidden bg-black/50 border border-white/10 aspect-video">
                  <video 
                    ref={videoRef}
                    src={videoUrl!} 
                    className="w-full h-full object-contain"
                    controls
                    onLoadedMetadata={handleLoadedMetadata}
                  />
                  <button 
                    onClick={() => {
                      setVideoFile(null);
                      setVideoUrl(null);
                      setExtractedFrames([]);
                      setIsPlaying(false);
                      setCurrentFrameIndex(0);
                    }}
                    className="absolute top-2 right-2 p-2 bg-black/60 hover:bg-red-500/80 text-white rounded-xl backdrop-blur-md transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex justify-between text-xs text-zinc-400 px-1">
                  <span>{videoFile.name}</span>
                  <span>{videoDuration.toFixed(1)}s</span>
                </div>
              </div>
            )}
          </div>

          {/* Extraction Options */}
          <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-6 space-y-5">
            <div className="flex items-center gap-2 mb-2">
              <Settings className="w-4 h-4 text-purple-400" />
              <h3 className="text-sm font-bold text-zinc-300 uppercase tracking-widest">Extraction Settings</h3>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <label className="text-xs font-medium text-zinc-400">Number of Frames</label>
                  <div className="flex items-center gap-1 bg-black/50 border border-white/10 rounded-lg p-1">
                    <button onClick={() => handleNumFramesChange(numFrames - 1)} className="p-1 hover:bg-white/10 rounded text-zinc-400 hover:text-white transition-colors">
                      <Minus className="w-3 h-3" />
                    </button>
                    <input 
                      type="number" min="2" value={numFrames} 
                      onChange={(e) => handleNumFramesChange(Number(e.target.value))}
                      className="w-12 bg-transparent text-xs text-white font-mono text-center focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    <button onClick={() => handleNumFramesChange(numFrames + 1)} className="p-1 hover:bg-white/10 rounded text-zinc-400 hover:text-white transition-colors">
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <label className="text-xs font-medium text-zinc-400">Distance Between Frames (ms)</label>
                  <div className="flex items-center gap-1 bg-black/50 border border-white/10 rounded-lg p-1">
                    <button onClick={() => handleFrameDistanceChange(frameDistance - 10)} className="p-1 hover:bg-white/10 rounded text-zinc-400 hover:text-white transition-colors">
                      <Minus className="w-3 h-3" />
                    </button>
                    <input 
                      type="number" min="0.1" step="0.1" value={frameDistance} 
                      onChange={(e) => handleFrameDistanceChange(Number(e.target.value))}
                      className="w-16 bg-transparent text-xs text-white font-mono text-center focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    <button onClick={() => handleFrameDistanceChange(frameDistance + 10)} className="p-1 hover:bg-white/10 rounded text-zinc-400 hover:text-white transition-colors">
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between">
                  <label className="text-xs font-medium text-zinc-400">Resolution Scale</label>
                  <span className="text-xs text-white font-mono">{resolutionScale}%</span>
                </div>
                <input 
                  type="range" min="10" max="100" value={resolutionScale} 
                  onChange={(e) => setResolutionScale(Number(e.target.value))}
                  className="w-full accent-purple-500"
                />
              </div>

              <div className="space-y-2">
                <div className="flex justify-between">
                  <label className="text-xs font-medium text-zinc-400">JPG Compression Quality</label>
                  <span className="text-xs text-white font-mono">{compression}%</span>
                </div>
                <input 
                  type="range" min="1" max="100" value={compression} 
                  onChange={(e) => setCompression(Number(e.target.value))}
                  className="w-full accent-purple-500"
                />
              </div>
            </div>

            <button
              onClick={extractFrames}
              disabled={!videoFile || isExtracting}
              className="w-full py-3 bg-purple-600 hover:bg-purple-500 disabled:bg-white/5 disabled:text-zinc-500 text-white rounded-xl font-bold tracking-wide transition-colors flex items-center justify-center gap-2"
            >
              {isExtracting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Extracting ({Math.round(progress)}%)
                </>
              ) : (
                <>
                  <ImageIcon className="w-5 h-5" />
                  Extract Frames
                </>
              )}
            </button>
          </div>
        </div>

        {/* Right Column: Results */}
        <div className="lg:col-span-2 space-y-6">
          {error && (
            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex gap-3 items-start">
              <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
              <p className="text-red-200 text-sm">{error}</p>
            </div>
          )}

          {/* Extracted Frames Grid */}
          <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-zinc-400 uppercase tracking-widest">Extracted Frames ({extractedFrames.length})</h3>
              {extractedFrames.length > 0 && (
                <button
                  onClick={downloadZip}
                  disabled={isZipping || isExtracting}
                  className="px-4 py-2 bg-white/10 hover:bg-white/20 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                >
                  {isZipping ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Zipping ({Math.round(progress)}%)
                    </>
                  ) : (
                    <>
                      <Archive className="w-4 h-4" />
                      Download ZIP
                    </>
                  )}
                </button>
              )}
            </div>
            
            {extractedFrames.length > 0 ? (
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3 max-h-[300px] overflow-y-auto p-2">
                <AnimatePresence>
                  {extractedFrames.map((frame, idx) => (
                    <motion.div
                      key={frame.id}
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="relative aspect-video rounded-lg overflow-hidden border border-white/10 bg-black/50 group"
                    >
                      <img src={frame.url} className="w-full h-full object-cover" alt={`Frame ${idx}`} />
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <span className="text-xs font-bold text-white">#{idx + 1}</span>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            ) : (
              <div className="h-32 flex items-center justify-center border-2 border-dashed border-white/10 rounded-2xl">
                <p className="text-sm text-zinc-500">No frames extracted yet.</p>
              </div>
            )}
          </div>

          {/* Animation Playback */}
          <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl overflow-hidden flex flex-col">
            {extractedFrames.length > 0 ? (
              <div className="relative w-full aspect-video bg-black/50 group">
                <img 
                  src={extractedFrames[currentFrameIndex]?.url} 
                  className="w-full h-full object-contain" 
                  alt="Playback Frame" 
                />
                
                {/* Floating Play/Pause Button */}
                <div className={`absolute inset-0 flex items-center justify-center bg-black/20 transition-opacity ${isPlaying ? 'opacity-0 group-hover:opacity-100' : 'opacity-100'}`}>
                  <button
                    onClick={() => setIsPlaying(!isPlaying)}
                    className="p-5 bg-emerald-500/90 hover:bg-emerald-400 text-white rounded-full backdrop-blur-md shadow-2xl transition-transform hover:scale-110"
                  >
                    {isPlaying ? <Pause className="w-8 h-8" /> : <Play className="w-8 h-8 ml-1" />}
                  </button>
                </div>

                {/* Frame Counter Overlay */}
                <div className="absolute top-4 right-4 px-3 py-1.5 bg-black/60 backdrop-blur-md rounded-full text-xs text-white font-mono border border-white/10 shadow-lg">
                  {currentFrameIndex + 1} / {extractedFrames.length}
                </div>
              </div>
            ) : (
              <div className="w-full aspect-video flex flex-col items-center justify-center border-b border-white/10 bg-black/20">
                <Play className="w-8 h-8 text-zinc-600 mb-3" />
                <p className="text-sm text-zinc-500">Extract frames to preview playback</p>
              </div>
            )}
            
            {/* Speed Control */}
            <div className="p-5 bg-white/5">
              <div className="flex items-center gap-4">
                <label className="text-xs font-medium text-zinc-400 whitespace-nowrap">Speed ({playbackDelay}ms)</label>
                <input 
                  type="range" min="20" max="1000" step="10" value={playbackDelay} 
                  onChange={(e) => setPlaybackDelay(Number(e.target.value))}
                  className="w-full accent-emerald-500"
                />
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};
