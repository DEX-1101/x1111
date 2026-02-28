
export interface ImageItem {
  id: string;
  url: string;
  file: File;
  focusPoint?: { x: number, y: number };
}

export interface LayoutRegion {
  id: number; // Matches the index of the image (1-based)
  clipPath: string; // CSS clip-path polygon
  labelX: string; // Percentage position for the number
  labelY: string;
  zIndex?: number;
}

export interface CollageLayout {
  regions: LayoutRegion[];
  borderColor: string;
  borderWidth: string;
}

export enum AppStatus {
  IDLE = 'idle',
  ANALYZING_FACES = 'analyzing_faces',
  GENERATING_LAYOUT = 'generating_layout',
  GENERATING_BACKGROUND = 'generating_background',
  READY = 'ready',
  ERROR = 'error',
}

export interface LogEntry {
  id: string;
  timestamp: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
}

export type AspectRatio = "1:1" | "3:2" | "2:3" | "4:3" | "3:4" | "16:9" | "9:16";

// --- Watermark Types ---

export interface WatermarkSettings {
  enabled: boolean;
  text: string;
  icon: 'none' | 'patreon' | 'x';
  x: number; // percentage 0-100
  y: number; // percentage 0-100
  opacity: number; // 0-1
  size: number; // scale factor
  iconScale: number; // scale factor for icon
}

export interface GlobalBlurSettings {
  enabled: boolean;
  amount: number; // px radius (0-50)
}

// --- Mosaic Types ---

export interface Point {
  x: number;
  y: number;
}

export interface CensorPath {
  points: Point[];
  size: number;
  type?: 'mosaic' | 'white';
}

export interface VignetteSettings {
  enabled: boolean;
  color: string;
  opacity: number; // 0-1
  range: number; // 0-100 (Size of the hole)
  softness: number; // 0-200 (Blur amount)
  cornerRadius: number; // 0-100 (Roundness of hole)
}

export interface MosaicImageItem extends ImageItem {
  censorPaths: CensorPath[];
  vignette: VignetteSettings;
}
