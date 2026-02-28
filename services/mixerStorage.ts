
import { ImageItem, CollageLayout, WatermarkSettings, AspectRatio, GlobalBlurSettings } from '../types';

const DB_NAME = 'GeminiMixerDB';
const STORE_IMAGES = 'mixer_images';
const STORE_STATE = 'mixer_state';
const DB_VERSION = 1;

interface MixerState {
    id: 'current';
    layout: CollageLayout | null;
    backgroundUrl: string | null;
    showBorders: boolean;
    labelScale: number;
    aspectRatio: AspectRatio;
    watermark: WatermarkSettings;
    globalBlur?: GlobalBlurSettings;
}

const openDB = (): Promise<IDBDatabase> => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = (e) => {
            const db = (e.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains(STORE_IMAGES)) {
                db.createObjectStore(STORE_IMAGES, { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains(STORE_STATE)) {
                db.createObjectStore(STORE_STATE, { keyPath: 'id' });
            }
        };
    });
};

export const saveMixerState = async (
    images: ImageItem[],
    state: Omit<MixerState, 'id'>
) => {
    try {
        const db = await openDB();
        const tx = db.transaction([STORE_IMAGES, STORE_STATE], 'readwrite');
        
        const imgStore = tx.objectStore(STORE_IMAGES);
        // Clear old images and replace with current set
        await imgStore.clear();
        for (const img of images) {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { url, ...rest } = img;
            await imgStore.put(rest); 
        }

        const stateStore = tx.objectStore(STORE_STATE);
        await stateStore.put({ id: 'current', ...state });

        return new Promise<void>((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch (e) {
        console.error("Save failed", e);
    }
};

export const loadMixerState = async (): Promise<{ images: ImageItem[], state: Omit<MixerState, 'id'> | null }> => {
    try {
        const db = await openDB();
        const tx = db.transaction([STORE_IMAGES, STORE_STATE], 'readonly');
        
        const imgReq = tx.objectStore(STORE_IMAGES).getAll();
        const stateReq = tx.objectStore(STORE_STATE).get('current');

        return new Promise((resolve, reject) => {
            tx.oncomplete = () => {
                const storedImages = imgReq.result || [];
                const images = storedImages.map((img: any) => ({
                    ...img,
                    url: URL.createObjectURL(img.file)
                }));
                
                let state = null;
                if (stateReq.result) {
                    // eslint-disable-next-line @typescript-eslint/no-unused-vars
                    const { id, ...rest } = stateReq.result;
                    state = rest;
                }
                
                resolve({ images, state });
            };
            tx.onerror = () => reject(tx.error);
        });
    } catch (e) {
        console.warn("Load failed", e);
        return { images: [], state: null };
    }
};
