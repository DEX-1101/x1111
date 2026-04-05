import * as ort from 'onnxruntime-web/all';

// Set WASM paths to CDN
ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/";

const DB_NAME = "UpscaleCache";
const STORE_NAME = "models";
const MODEL_URL = 'https://huggingface.co/deepghs/imgutils-models/resolve/main/real_esrgan/RealESRGAN_x4plus_anime_6B.onnx';
const MODEL_ID = 'realesrgan-x4-anime';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getModelFromDB(): Promise<ArrayBuffer | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(MODEL_ID);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch (e) {
    return null;
  }
}

async function saveModelToDB(buffer: ArrayBuffer): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(buffer, MODEL_ID);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (e) {}
}

export class UpscaleService {
  private session: ort.InferenceSession | null = null;
  private currentProvider: string = 'wasm';

  getProvider(): string {
    return this.currentProvider;
  }

  getModelInfo() {
    return {
      name: 'Real-ESRGAN x4 Anime 6B',
      id: MODEL_ID,
      url: MODEL_URL
    };
  }

  async init(onProgress?: (progress: number, status: string) => void) {
    if (this.session) return;

    let modelBuffer = await getModelFromDB();
    
    if (!modelBuffer) {
      if (onProgress) onProgress(0, 'Downloading upscale model (~67MB)...');
      const response = await fetch(MODEL_URL);
      if (!response.ok) throw new Error(`Failed to fetch model: ${response.statusText}`);
      
      const contentLength = response.headers.get('content-length');
      const total = contentLength ? parseInt(contentLength, 10) : 67000000;
      let loaded = 0;
      
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Failed to get reader");
      
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          loaded += value.length;
          if (onProgress) {
            onProgress(Math.round((loaded / total) * 100), `Downloading model (${Math.round(loaded / 1024 / 1024)}MB / ${Math.round(total / 1024 / 1024)}MB)...`);
          }
        }
      }
      
      const buffer = new Uint8Array(loaded);
      let offset = 0;
      for (const chunk of chunks) {
        buffer.set(chunk, offset);
        offset += chunk.length;
      }
      modelBuffer = buffer.buffer;
      await saveModelToDB(modelBuffer);
    }

    if (onProgress) onProgress(100, 'Initializing ONNX session...');
    
    try {
      this.session = await ort.InferenceSession.create(modelBuffer, {
        executionProviders: ['webgpu']
      });
      this.currentProvider = 'webgpu';
    } catch (e) {
      try {
        this.session = await ort.InferenceSession.create(modelBuffer, {
          executionProviders: ['webgl']
        });
        this.currentProvider = 'webgl';
      } catch (e2) {
        this.session = await ort.InferenceSession.create(modelBuffer, {
          executionProviders: ['wasm']
        });
        this.currentProvider = 'wasm';
      }
    }
    
    if (onProgress) onProgress(100, `Ready (${this.currentProvider.toUpperCase()})`);
  }

  async upscale(image: HTMLImageElement, scale: number, onProgress?: (progress: number) => void): Promise<string> {
    if (!this.session) throw new Error("Session not initialized");

    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error("Canvas context failed");
    ctx.drawImage(image, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    
    const hasAlpha = this.checkAlpha(imageData);
    
    let upscaledRGB: ImageData;
    if (hasAlpha) {
      // Split RGB and Alpha
      const rgbData = new Uint8ClampedArray(imageData.data.length);
      const alphaData = new Uint8ClampedArray(imageData.data.length);
      for (let i = 0; i < imageData.data.length; i += 4) {
        rgbData[i] = imageData.data[i];
        rgbData[i+1] = imageData.data[i+1];
        rgbData[i+2] = imageData.data[i+2];
        rgbData[i+3] = 255;

        alphaData[i] = imageData.data[i+3];
        alphaData[i+1] = imageData.data[i+3];
        alphaData[i+2] = imageData.data[i+3];
        alphaData[i+3] = 255;
      }
      
      const upscaledRGBData = await this.processImage(new ImageData(rgbData, canvas.width, canvas.height), (p) => onProgress?.(p * 0.7));
      const upscaledAlphaData = await this.processImage(new ImageData(alphaData, canvas.width, canvas.height), (p) => onProgress?.(0.7 + p * 0.3));
      
      const finalData = new Uint8ClampedArray(upscaledRGBData.data.length);
      for (let i = 0; i < upscaledRGBData.data.length; i += 4) {
        finalData[i] = upscaledRGBData.data[i];
        finalData[i+1] = upscaledRGBData.data[i+1];
        finalData[i+2] = upscaledRGBData.data[i+2];
        finalData[i+3] = upscaledAlphaData.data[i]; // Use R channel of upscaled alpha as new alpha
      }
      upscaledRGB = new ImageData(finalData, upscaledRGBData.width, upscaledRGBData.height);
    } else {
      upscaledRGB = await this.processImage(imageData, onProgress);
    }

    // Final scaling if not exactly 4x
    const finalCanvas = document.createElement('canvas');
    const finalWidth = Math.round(image.width * scale);
    const finalHeight = Math.round(image.height * scale);
    finalCanvas.width = finalWidth;
    finalCanvas.height = finalHeight;
    const finalCtx = finalCanvas.getContext('2d');
    if (!finalCtx) throw new Error("Final canvas context failed");

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = upscaledRGB.width;
    tempCanvas.height = upscaledRGB.height;
    tempCanvas.getContext('2d')?.putImageData(upscaledRGB, 0, 0);

    finalCtx.imageSmoothingEnabled = true;
    finalCtx.imageSmoothingQuality = 'high';
    finalCtx.drawImage(tempCanvas, 0, 0, finalWidth, finalHeight);

    return finalCanvas.toDataURL('image/png');
  }

  private checkAlpha(imageData: ImageData): boolean {
    for (let i = 3; i < imageData.data.length; i += 4) {
      if (imageData.data[i] < 255) return true;
    }
    return false;
  }

  private async processImage(imageData: ImageData, onProgress?: (progress: number) => void): Promise<ImageData> {
    const { width, height, data } = imageData;
    const tileSize = 256; // Smaller tiles for stability
    const overlap = 16;
    const scale = 4;

    const outWidth = width * scale;
    const outHeight = height * scale;
    const outData = new Uint8ClampedArray(outWidth * outHeight * 4);

    const numTilesX = Math.ceil(width / (tileSize - overlap * 2));
    const numTilesY = Math.ceil(height / (tileSize - overlap * 2));
    const totalTiles = numTilesX * numTilesY;
    let completedTiles = 0;

    for (let y = 0; y < height; y += tileSize - overlap * 2) {
      for (let x = 0; x < width; x += tileSize - overlap * 2) {
        const tw = Math.min(tileSize, width - x);
        const th = Math.min(tileSize, height - y);

        const tileImageData = this.getTile(imageData, x, y, tw, th);
        const upscaledTile = await this.runInference(tileImageData);

        this.putTile(outData, outWidth, upscaledTile, x * scale, y * scale);
        
        completedTiles++;
        onProgress?.(completedTiles / totalTiles);
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }

    return new ImageData(outData, outWidth, outHeight);
  }

  private getTile(imageData: ImageData, x: number, y: number, w: number, h: number): ImageData {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx?.putImageData(imageData, -x, -y);
    return ctx!.getImageData(0, 0, w, h);
  }

  private putTile(outData: Uint8ClampedArray, outWidth: number, tile: ImageData, x: number, y: number) {
    for (let ty = 0; ty < tile.height; ty++) {
      for (let tx = 0; tx < tile.width; tx++) {
        const outIdx = ((y + ty) * outWidth + (x + tx)) * 4;
        const tileIdx = (ty * tile.width + tx) * 4;
        outData[outIdx] = tile.data[tileIdx];
        outData[outIdx + 1] = tile.data[tileIdx + 1];
        outData[outIdx + 2] = tile.data[tileIdx + 2];
        outData[outIdx + 3] = tile.data[tileIdx + 3];
      }
    }
  }

  private async runInference(imageData: ImageData): Promise<ImageData> {
    const { width, height, data } = imageData;
    const input = new Float32Array(3 * width * height);
    
    for (let i = 0; i < width * height; i++) {
      input[i] = data[i * 4] / 255.0;
      input[i + width * height] = data[i * 4 + 1] / 255.0;
      input[i + 2 * width * height] = data[i * 4 + 2] / 255.0;
    }

    const tensor = new ort.Tensor('float32', input, [1, 3, height, width]);
    const feeds: Record<string, ort.Tensor> = {};
    feeds[this.session!.inputNames[0]] = tensor;

    const results = await this.session!.run(feeds);
    const output = results[this.session!.outputNames[0]].data as Float32Array;

    const outWidth = width * 4;
    const outHeight = height * 4;
    const outImageData = new Uint8ClampedArray(outWidth * outHeight * 4);

    for (let i = 0; i < outWidth * outHeight; i++) {
      outImageData[i * 4] = Math.max(0, Math.min(255, Math.round(output[i] * 255)));
      outImageData[i * 4 + 1] = Math.max(0, Math.min(255, Math.round(output[i + outWidth * outHeight] * 255)));
      outImageData[i * 4 + 2] = Math.max(0, Math.min(255, Math.round(output[i + 2 * outWidth * outHeight] * 255)));
      outImageData[i * 4 + 3] = 255;
    }

    return new ImageData(outImageData, outWidth, outHeight);
  }
}

export const upscaleService = new UpscaleService();
