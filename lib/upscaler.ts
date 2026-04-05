import * as ort from 'onnxruntime-web/all';

// Set WASM paths to CDN
ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/";

const DB_NAME = "UpscalerCache";
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

export class Upscaler {
  private session: ort.InferenceSession | null = null;
  private currentProvider: string = 'wasm';

  async init(onProgress?: (progress: number, status: string) => void) {
    if (this.session) return;

    if (onProgress) onProgress(0, 'Checking cache...');
    let modelBuffer = await getModelFromDB();

    if (!modelBuffer) {
      if (onProgress) onProgress(0, 'Downloading upscaler model (~67MB)...');
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

    if (onProgress) onProgress(100, 'Initializing upscaler...');
    
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
  }

  async upscale(image: HTMLImageElement, scale: number, onProgress?: (progress: number) => void): Promise<string> {
    if (!this.session) throw new Error("Upscaler not initialized");

    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error("Canvas context failed");
    ctx.drawImage(image, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    
    // Process RGB and Alpha separately
    const upscaledRGB = await this.processChannels(imageData, [0, 1, 2], onProgress, 0, 0.8);
    const upscaledAlpha = await this.processChannels(imageData, [3, 3, 3], onProgress, 0.8, 1.0);

    // Combine
    const outW = canvas.width * 4;
    const outH = canvas.height * 4;
    const finalData = new Uint8ClampedArray(outW * outH * 4);
    
    for (let i = 0; i < outW * outH; i++) {
      finalData[i * 4] = upscaledRGB[i * 3];
      finalData[i * 4 + 1] = upscaledRGB[i * 3 + 1];
      finalData[i * 4 + 2] = upscaledRGB[i * 3 + 2];
      finalData[i * 4 + 3] = upscaledAlpha[i * 3]; // Just take one channel from the alpha upscale
    }

    const outCanvas = document.createElement('canvas');
    outCanvas.width = outW;
    outCanvas.height = outH;
    const outCtx = outCanvas.getContext('2d');
    if (!outCtx) throw new Error("Output canvas context failed");
    outCtx.putImageData(new ImageData(finalData, outW, outH), 0, 0);

    // If target scale is not 4x, resize
    if (scale !== 4) {
      const targetW = Math.round(image.width * scale);
      const targetH = Math.round(image.height * scale);
      const resizedCanvas = document.createElement('canvas');
      resizedCanvas.width = targetW;
      resizedCanvas.height = targetH;
      const rCtx = resizedCanvas.getContext('2d');
      if (rCtx) {
        rCtx.imageSmoothingEnabled = true;
        rCtx.imageSmoothingQuality = 'high';
        rCtx.drawImage(outCanvas, 0, 0, targetW, targetH);
        return resizedCanvas.toDataURL('image/png');
      }
    }

    return outCanvas.toDataURL('image/png');
  }

  private async processChannels(imageData: ImageData, channelIndices: number[], onProgress?: (p: number) => void, progStart: number = 0, progEnd: number = 1): Promise<Uint8Array> {
    const { width, height, data } = imageData;
    const tileSize = 256; // Smaller tiles to prevent GPU timeout
    const pad = 8;
    
    const outW = width * 4;
    const outH = height * 4;
    const output = new Uint8Array(outW * outH * 3);

    const numTilesX = Math.ceil(width / tileSize);
    const numTilesY = Math.ceil(height / tileSize);
    const totalTiles = numTilesX * numTilesY;
    let completedTiles = 0;

    for (let ty = 0; ty < numTilesY; ty++) {
      for (let tx = 0; tx < numTilesX; tx++) {
        const x = tx * tileSize;
        const y = ty * tileSize;
        const w = Math.min(tileSize, width - x);
        const h = Math.min(tileSize, height - y);

        // Extract tile with padding
        const px = Math.max(0, x - pad);
        const py = Math.max(0, y - pad);
        const pw = Math.min(width, x + w + pad) - px;
        const ph = Math.min(height, y + h + pad) - py;

        const tileInput = new Float32Array(3 * pw * ph);
        for (let c = 0; c < 3; c++) {
          const channelIdx = channelIndices[c];
          for (let i = 0; i < ph; i++) {
            for (let j = 0; j < pw; j++) {
              tileInput[c * pw * ph + i * pw + j] = data[((py + i) * width + (px + j)) * 4 + channelIdx] / 255.0;
            }
          }
        }

        const tensor = new ort.Tensor('float32', tileInput, [1, 3, ph, pw]);
        const results = await this.session!.run({ input: tensor });
        const tileOutput = results.output.data as Float32Array;

        // Copy back to output, removing padding
        const tileOutW = pw * 4;
        const tileOutH = ph * 4;
        const startX = (x - px) * 4;
        const startY = (y - py) * 4;
        const copyW = w * 4;
        const copyH = h * 4;

        for (let c = 0; c < 3; c++) {
          for (let i = 0; i < copyH; i++) {
            for (let j = 0; j < copyW; j++) {
              const val = Math.max(0, Math.min(255, Math.round(tileOutput[c * tileOutW * tileOutH + (startY + i) * tileOutW + (startX + j)] * 255)));
              output[((y * 4 + i) * outW + (x * 4 + j)) * 3 + c] = val;
            }
          }
        }

        completedTiles++;
        if (onProgress) {
          onProgress(progStart + (completedTiles / totalTiles) * (progEnd - progStart));
        }
        // Yield
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }

    return output;
  }
}

export const upscaler = new Upscaler();
