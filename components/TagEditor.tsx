import React, { useState, useEffect, useRef } from 'react';
import { FolderOpen, Save, X, Image as ImageIcon, Tag, Send, Undo2, Redo2, Crop as CropIcon, Plus, Settings, Wand2, Trash2, Archive, Download, UploadCloud, Paintbrush, MousePointer2 } from 'lucide-react';
import { 
  DndContext, 
  closestCenter, 
  KeyboardSensor, 
  PointerSensor, 
  useSensor, 
  useSensors, 
  DragEndEvent 
} from '@dnd-kit/core';
import { 
  arrayMove, 
  SortableContext, 
  sortableKeyboardCoordinates, 
  rectSortingStrategy, 
  useSortable 
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import ReactCrop, { type Crop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { wdTagger, deleteModelFromDB, checkModelExists } from '../lib/wdTagger';
import { ZipWriter, BlobWriter, BlobReader, TextReader } from '@zip.js/zip.js';
import { uploadFile } from '@huggingface/hub';

interface FileEntry {
  imageHandle: FileSystemFileHandle;
  textHandle?: FileSystemFileHandle;
  name: string;
  baseName: string;
  tags: string[];
  parentHandle: FileSystemDirectoryHandle;
}

const Thumbnail = ({ imageHandle, name, urlCache }: { imageHandle: FileSystemFileHandle, name: string, urlCache: React.MutableRefObject<Map<string, string>> }) => {
  const [url, setUrl] = useState<string>(urlCache.current.get(name) || '');
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (url) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        const cached = urlCache.current.get(name);
        if (cached) {
          setUrl(cached);
        } else {
          imageHandle.getFile().then(async file => {
            const buffer = await file.arrayBuffer();
            const blob = new Blob([buffer], { type: file.type });
            const newUrl = URL.createObjectURL(blob);
            urlCache.current.set(name, newUrl);
            setUrl(newUrl);
          });
        }
        observer.disconnect();
      }
    }, { rootMargin: '200px' });

    if (imgRef.current) {
      observer.observe(imgRef.current);
    }

    return () => {
      observer.disconnect();
    };
  }, [imageHandle, name, url, urlCache]);

  return (
    <img 
      ref={imgRef}
      src={url || 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'} 
      alt={name} 
      className={`w-full h-full object-cover transition-opacity duration-300 ${url ? 'opacity-100' : 'opacity-0'}`} 
    />
  );
};

const SortableTag = ({ tag, onRemove }: { tag: string, onRemove: (t: string) => void }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: tag });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    zIndex: isDragging ? 10 : 1,
    opacity: isDragging ? 0.8 : 1,
    whiteSpace: 'nowrap' as const,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`flex items-center gap-1.5 bg-themePrimary/10 border border-themePrimary/20 text-white px-3 py-1.5 rounded-md text-sm font-medium group transition-colors hover:bg-themePrimary/20 cursor-grab active:cursor-grabbing relative ${isDragging ? 'shadow-lg shadow-black/50 scale-105 z-50' : ''}`}
    >
      <span>{tag}</span>
      <button 
        onPointerDown={(e) => e.stopPropagation()} // Prevent dragging when clicking X
        onClick={() => onRemove(tag)}
        className="text-white/60 hover:text-white opacity-60 group-hover:opacity-100 transition-opacity ml-1 bg-themePrimary/20 rounded-full p-0.5"
      >
        <X size={12} />
      </button>
    </div>
  );
};

export const TagEditor: React.FC = () => {
  const [directoryHandle, setDirectoryHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  
  const [tagState, setTagState] = useState<{
    current: string[];
    history: string[][];
    index: number;
  }>({
    current: [],
    history: [[]],
    index: 0
  });
  const activeTags = tagState.current;

  const [imageState, setImageState] = useState<{
    history: string[];
    index: number;
  }>({
    history: [],
    index: 0
  });

  const [newTag, setNewTag] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [previewUrl, setPreviewUrl] = useState<string>('');
  const [crop, setCrop] = useState<Crop>();
  const [isCropping, setIsCropping] = useState(false);
  const previewImgRef = useRef<HTMLImageElement>(null);
  const urlCache = useRef<Map<string, string>>(new Map());

  // Auto Tag & Batch Processing State
  const [isAutoTagModalOpen, setIsAutoTagModalOpen] = useState(false);
  const [batchActivationTags, setBatchActivationTags] = useState(() => localStorage.getItem('batch_activation') || '');
  const [batchEmphasizeTags, setBatchEmphasizeTags] = useState(() => localStorage.getItem('batch_emphasize') || '');
  const [batchRemoveTags, setBatchRemoveTags] = useState(() => localStorage.getItem('batch_remove') || '');
  const [batchRename, setBatchRename] = useState(() => localStorage.getItem('batch_rename') === 'true');
  const [batchStatus, setBatchStatus] = useState<'idle' | 'processing' | 'done'>('idle');
  const [batchProgress, setBatchProgress] = useState(0);
  const [batchProgressText, setBatchProgressText] = useState('');

  // WD Tagger State
  const [selectedModelId, setSelectedModelId] = useState(() => localStorage.getItem('wd_modelId') || 'eva02-v3');
  const [wdStatus, setWdStatus] = useState<'idle' | 'loading' | 'processing' | 'done'>('idle');
  const [wdProgress, setWdProgress] = useState(0);
  const [wdProgressText, setWdProgressText] = useState('');
  const [wdThreshold, setWdThreshold] = useState(() => parseFloat(localStorage.getItem('wd_thresh') || '0.35'));
  const [wdCharThreshold, setWdCharThreshold] = useState(() => parseFloat(localStorage.getItem('wd_charThresh') || '0.85'));
  const [wdOverwrite, setWdOverwrite] = useState(() => localStorage.getItem('wd_overwrite') === 'true');
  const [wdRemoveRedundant, setWdRemoveRedundant] = useState(() => localStorage.getItem('wd_removeRedundant') === 'true');
  const [wdExcludeCategories, setWdExcludeCategories] = useState<number[]>(() => {
    const saved = localStorage.getItem('wd_excludeCategories');
    return saved ? JSON.parse(saved) : [];
  });
  const [wdTopK, setWdTopK] = useState(() => parseInt(localStorage.getItem('wd_topK') || '0'));
  const [wdRecursive, setWdRecursive] = useState(() => localStorage.getItem('wd_recursive') === 'true');
  const [wdModelExists, setWdModelExists] = useState(false);

  // ZIP State
  const [isZipModalOpen, setIsZipModalOpen] = useState(false);
  const [zipFilename, setZipFilename] = useState('dataset.zip');
  const [zipPassword, setZipPassword] = useState('');
  const [zipLegacy, setZipLegacy] = useState(true);
  const [zipLevel, setZipLevel] = useState<number>(5);
  const [hfToken, setHfToken] = useState(() => localStorage.getItem('hf_token') || '');
  const [hfRepo, setHfRepo] = useState(() => localStorage.getItem('hf_repo') || '');
  const [hfFolder, setHfFolder] = useState('');
  const [zipStatus, setZipStatus] = useState<'idle' | 'zipping' | 'uploading' | 'done'>('idle');
  const [zipProgress, setZipProgress] = useState(0);
  const [zipProgressText, setZipProgressText] = useState('');

  // Inpaint State
  const [isInpaintOpen, setIsInpaintOpen] = useState(false);
  const [brushSize, setBrushSize] = useState(() => parseInt(localStorage.getItem('inpaint_brushSize') || '40'));
  const [brushColor, setBrushColor] = useState(() => localStorage.getItem('inpaint_brushColor') || '#ff0000');
  const [inpaintMode, setInpaintMode] = useState<'draw' | 'pan'>(() => (localStorage.getItem('inpaint_mode') as 'draw' | 'pan') || 'draw');
  const inpaintCanvasRef = useRef<HTMLCanvasElement>(null);
  const inpaintCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [inpaintCursorPos, setInpaintCursorPos] = useState({ x: -1000, y: -1000 });
  const [isHoveringCanvas, setIsHoveringCanvas] = useState(false);

  const [inpaintState, setInpaintState] = useState<{
    history: string[];
    index: number;
  }>({
    history: [],
    index: 0
  });

  const cancelRef = useRef<boolean>(false);
  const handleCancel = () => {
    cancelRef.current = true;
  };

  const [deleteConfirm, setDeleteConfirm] = useState<{
    isOpen: boolean;
    type: 'model' | 'file';
    idx?: number;
    fileName?: string;
  }>({ isOpen: false, type: 'file' });

  const confirmDelete = async () => {
    if (deleteConfirm.type === 'model') {
      await deleteModelFromDB(selectedModelId);
      setWdModelExists(false);
    } else if (deleteConfirm.type === 'file' && deleteConfirm.idx !== undefined) {
      const file = files[deleteConfirm.idx];
      try {
        await file.parentHandle.removeEntry(file.imageHandle.name);
        if (file.textHandle) {
          await file.parentHandle.removeEntry(file.textHandle.name);
        }
        
        const newFiles = [...files];
        newFiles.splice(deleteConfirm.idx, 1);
        setFiles(newFiles);
        
        if (selectedIndex === deleteConfirm.idx) {
          setSelectedIndex(-1);
          setTagState({ current: [], history: [], index: 0 });
        } else if (selectedIndex > deleteConfirm.idx) {
          setSelectedIndex(selectedIndex - 1);
        }
      } catch (err) {
        console.error("Failed to delete file", err);
        alert("Failed to delete file.");
      }
    }
    setDeleteConfirm({ isOpen: false, type: 'file' });
  };

  const isProcessing = wdStatus !== 'idle' || batchStatus !== 'idle' || zipStatus !== 'idle';

  // Save settings to localStorage
  useEffect(() => {
    localStorage.setItem('wd_modelId', selectedModelId);
    localStorage.setItem('wd_thresh', wdThreshold.toString());
    localStorage.setItem('wd_charThresh', wdCharThreshold.toString());
    localStorage.setItem('wd_overwrite', wdOverwrite.toString());
    localStorage.setItem('wd_removeRedundant', wdRemoveRedundant.toString());
    localStorage.setItem('wd_excludeCategories', JSON.stringify(wdExcludeCategories));
    localStorage.setItem('wd_topK', wdTopK.toString());
    localStorage.setItem('wd_recursive', wdRecursive.toString());
    localStorage.setItem('batch_activation', batchActivationTags);
    localStorage.setItem('batch_emphasize', batchEmphasizeTags);
    localStorage.setItem('batch_remove', batchRemoveTags);
    localStorage.setItem('batch_rename', batchRename.toString());
    localStorage.setItem('hf_token', hfToken);
    localStorage.setItem('hf_repo', hfRepo);
    localStorage.setItem('inpaint_brushSize', brushSize.toString());
    localStorage.setItem('inpaint_brushColor', brushColor);
    localStorage.setItem('inpaint_mode', inpaintMode);
  }, [selectedModelId, wdThreshold, wdCharThreshold, wdOverwrite, wdRemoveRedundant, wdExcludeCategories, wdTopK, batchActivationTags, batchEmphasizeTags, batchRemoveTags, batchRename, hfToken, hfRepo, brushSize, brushColor, inpaintMode]);

  useEffect(() => {
    checkModelExists(selectedModelId).then(exists => setWdModelExists(exists));
  }, [isAutoTagModalOpen, selectedModelId]);

  const handleWdProcess = async () => {
    if (!directoryHandle) return;
    cancelRef.current = false;
    setWdStatus('loading');
    setWdProgress(0);
    setWdProgressText('Initializing WD Tagger...');

    try {
      await wdTagger.init(selectedModelId, (progress, status) => {
        setWdProgress(progress);
        setWdProgressText(status);
      });

      setWdStatus('processing');
      const updatedFiles = [...files];
      const totalSteps = updatedFiles.length;

      for (let i = 0; i < updatedFiles.length; i++) {
        if (cancelRef.current) {
          setWdProgressText('Cancelled');
          break;
        }
        const file = updatedFiles[i];
        
        // Skip if not overwriting and tags already exist
        if (!wdOverwrite && file.tags.length > 0) {
          setWdProgress(Math.round(((i + 1) / totalSteps) * 100));
          setWdProgressText(`Skipping ${file.name} (${i + 1}/${totalSteps})...`);
          continue;
        }

        setWdProgress(Math.round(((i + 1) / totalSteps) * 100));
        setWdProgressText(`Tagging ${file.name} (${i + 1}/${totalSteps})...`);

        // Load image to HTMLImageElement
        const imgFile = await file.imageHandle.getFile();
        const imgUrl = URL.createObjectURL(imgFile);
        const img = new Image();
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
          img.src = imgUrl;
        });

        let generatedTags = await wdTagger.predict(img, wdThreshold, wdCharThreshold, wdExcludeCategories, wdTopK);
        URL.revokeObjectURL(imgUrl);

        // Yield to main thread to prevent freezing
        await new Promise(resolve => setTimeout(resolve, 10));

        if (wdRemoveRedundant) {
          generatedTags = generatedTags.filter(tag => {
            const isRedundant = generatedTags.some(otherTag => {
              if (tag === otherTag) return false;
              // Check if tag is a distinct word/phrase in otherTag
              const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              const regex = new RegExp(`\\b${escapedTag}\\b`, 'i');
              return regex.test(otherTag);
            });
            return !isRedundant;
          });
        }

        updatedFiles[i].tags = generatedTags;

        // @ts-ignore
        const writable = await file.parentHandle.getFileHandle(`${file.baseName.split('/').pop()}.txt`, { create: true }).then(h => {
          updatedFiles[i].textHandle = h;
          // @ts-ignore
          return h.createWritable();
        });
        await writable.write(generatedTags.join(', '));
        await writable.close();
      }

      setFiles(updatedFiles);
      if (selectedIndex !== -1) {
        setTagState({
          current: updatedFiles[selectedIndex].tags,
          history: [updatedFiles[selectedIndex].tags],
          index: 0
        });
      }
      
      if (cancelRef.current) {
        setWdStatus('idle');
        setWdProgress(0);
        setWdProgressText('');
      } else {
        setWdStatus('done');
        setWdProgress(100);
        setWdProgressText('Done!');
        setTimeout(() => {
          setWdStatus('idle');
          setWdProgress(0);
          setWdProgressText('');
        }, 1500);
      }

    } catch (err) {
      console.error(err);
      alert('Failed to process WD Tagger.');
      setWdStatus('idle');
      setWdProgress(0);
      setWdProgressText('');
    }
  };

  const handleDeleteModel = async () => {
    setDeleteConfirm({ isOpen: true, type: 'model' });
  };

  const cleanAndSplitTags = (tagsStr: string) => {
    return tagsStr.split(',').map(t => t.trim()).filter(t => t.length > 0);
  };

  const handleBatchProcess = async () => {
    if (!directoryHandle) return;
    cancelRef.current = false;
    setBatchStatus('processing');
    setBatchProgress(0);
    setBatchProgressText('Starting batch process...');

    try {
      const actTags = cleanAndSplitTags(batchActivationTags);
      const emphTags = cleanAndSplitTags(batchEmphasizeTags);
      const remTags = cleanAndSplitTags(batchRemoveTags);

      let previousActTags: string[] = [];
      try {
        const metaHandle = await directoryHandle.getFileHandle('.last_activation_tags.txt');
        const metaFile = await metaHandle.getFile();
        const metaText = await metaFile.text();
        previousActTags = cleanAndSplitTags(metaText);
      } catch (e) {
        // Ignore if not found
      }

      const tagsToDrop = [...remTags, ...previousActTags];
      const updatedFiles = [...files];
      
      const totalSteps = updatedFiles.length * (batchRename ? 2 : 1);
      let currentStep = 0;

      for (let i = 0; i < updatedFiles.length; i++) {
        if (cancelRef.current) {
          setBatchProgressText('Cancelled');
          break;
        }
        const file = updatedFiles[i];
        let currentTags = [...file.tags];
        const originalTags = [...currentTags];

        currentTags = currentTags.filter(t => !tagsToDrop.includes(t));
        const validEmphTags = emphTags.filter(t => originalTags.includes(t));
        currentTags = currentTags.filter(t => !validEmphTags.includes(t) && !actTags.includes(t));
        
        const finalTags = [...actTags, ...validEmphTags, ...currentTags];
        const uniqueTags = Array.from(new Set(finalTags));

        updatedFiles[i].tags = uniqueTags;

        // @ts-ignore
        const writable = await file.parentHandle.getFileHandle(`${file.baseName.split('/').pop()}.txt`, { create: true }).then(h => {
          updatedFiles[i].textHandle = h;
          // @ts-ignore
          return h.createWritable();
        });
        await writable.write(uniqueTags.join(', '));
        await writable.close();
        
        currentStep++;
        setBatchProgress(Math.round((currentStep / totalSteps) * 100));
        setBatchProgressText(`Processing ${file.name} (${currentStep}/${totalSteps})...`);
        
        // Yield to main thread
        await new Promise(resolve => setTimeout(resolve, 0));
      }

      try {
        const metaHandle = await directoryHandle.getFileHandle('.last_activation_tags.txt', { create: true });
        // @ts-ignore
        const writable = await metaHandle.createWritable();
        await writable.write(batchActivationTags);
        await writable.close();
      } catch (e) {
        console.error("Failed to save meta file", e);
      }

      if (batchRename && !cancelRef.current) {
        let counter = 1;
        for (let i = 0; i < updatedFiles.length; i++) {
          if (cancelRef.current) {
            setBatchProgressText('Cancelled');
            break;
          }
          const file = updatedFiles[i];
          const ext = file.name.substring(file.name.lastIndexOf('.'));
          const newImgName = `${counter}${ext}`;
          const newTxtName = `${counter}.txt`;

          if (file.name !== newImgName) {
            const newImgHandle = await file.parentHandle.getFileHandle(newImgName, { create: true });
            const imgFile = await file.imageHandle.getFile();
            // @ts-ignore
            const imgWritable = await newImgHandle.createWritable();
            await imgWritable.write(imgFile);
            await imgWritable.close();
            await file.parentHandle.removeEntry(file.imageHandle.name);
            updatedFiles[i].imageHandle = newImgHandle;
            updatedFiles[i].name = (file.name.includes('/') ? file.name.substring(0, file.name.lastIndexOf('/') + 1) : '') + newImgName;
            updatedFiles[i].baseName = (file.baseName.includes('/') ? file.baseName.substring(0, file.baseName.lastIndexOf('/') + 1) : '') + `${counter}`;
          }

          if (file.textHandle && file.textHandle.name !== newTxtName) {
            const newTxtHandle = await file.parentHandle.getFileHandle(newTxtName, { create: true });
            const txtFile = await file.textHandle.getFile();
            // @ts-ignore
            const txtWritable = await newTxtHandle.createWritable();
            await txtWritable.write(txtFile);
            await txtWritable.close();
            await file.parentHandle.removeEntry(file.textHandle.name);
            updatedFiles[i].textHandle = newTxtHandle;
          }
          counter++;
          
          currentStep++;
          setBatchProgress(Math.round((currentStep / totalSteps) * 100));
          setBatchProgressText(`Renaming ${file.name} (${currentStep}/${totalSteps})...`);
          
          // Yield to main thread
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }

      setFiles(updatedFiles);
      if (selectedIndex !== -1) {
        setTagState({
          current: updatedFiles[selectedIndex].tags,
          history: [updatedFiles[selectedIndex].tags],
          index: 0
        });
      }
      
      if (cancelRef.current) {
        setBatchStatus('idle');
        setBatchProgress(0);
        setBatchProgressText('');
      } else {
        setBatchStatus('done');
        setBatchProgress(100);
        setBatchProgressText('Batch process complete!');
        setTimeout(() => {
          setBatchStatus('idle');
          setBatchProgress(0);
          setBatchProgressText('');
        }, 1500);
      }

    } catch (err) {
      console.error(err);
      alert('Failed to process batch.');
      setBatchStatus('idle');
      setBatchProgress(0);
      setBatchProgressText('');
    }
  };

  const handleCreateZip = async (action: 'download' | 'upload') => {
    if (!directoryHandle) return;
    cancelRef.current = false;
    setZipStatus(action === 'download' ? 'zipping' : 'uploading');
    setZipProgress(0);
    setZipProgressText('Creating ZIP...');

    try {
      const zipFileWriter = new BlobWriter();
      const options: any = { level: zipLevel };
      if (zipPassword) {
        options.password = zipPassword;
        options.zipCrypto = zipLegacy;
      }
      const zipWriter = new ZipWriter(zipFileWriter, options);

      const totalFiles = files.length;
      for (let i = 0; i < totalFiles; i++) {
        if (cancelRef.current) {
          setZipProgressText('Cancelled');
          break;
        }
        const file = files[i];
        setZipProgress(Math.round(((i + 1) / totalFiles) * (action === 'download' ? 100 : 50)));
        setZipProgressText(`Zipping ${file.name} (${i + 1}/${totalFiles})...`);
        
        const imgFile = await file.imageHandle.getFile();
        await zipWriter.add(file.name, new BlobReader(imgFile));
        
        const tagsStr = file.tags.join(', ');
        await zipWriter.add(`${file.baseName.split('/').pop()}.txt`, new TextReader(tagsStr));
        
        // Yield to main thread
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      
      await zipWriter.close();
      
      if (cancelRef.current) {
        setZipStatus('idle');
        setZipProgress(0);
        setZipProgressText('');
        return;
      }

      const zipBlob = await zipFileWriter.getData();

      if (action === 'download') {
        const url = URL.createObjectURL(zipBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = zipFilename || 'dataset.zip';
        a.click();
        URL.revokeObjectURL(url);
        setZipStatus('done');
        setZipProgress(100);
        setZipProgressText('Downloaded successfully!');
      } else if (action === 'upload') {
        if (cancelRef.current) {
          setZipStatus('idle');
          setZipProgress(0);
          setZipProgressText('');
          return;
        }
        setZipProgress(50);
        setZipProgressText('Uploading to Hugging Face...');
        
        const pathInRepo = hfFolder ? `${hfFolder}/${zipFilename || 'dataset.zip'}` : (zipFilename || 'dataset.zip');
        
        await uploadFile({
          repo: { type: 'dataset', name: hfRepo },
          credentials: { accessToken: hfToken },
          file: {
            path: pathInRepo,
            content: zipBlob
          }
        });
        
        setZipStatus('done');
        setZipProgress(100);
        setZipProgressText('Uploaded successfully!');
      }
      
      setTimeout(() => {
        setZipStatus('idle');
        setZipProgress(0);
        setZipProgressText('');
      }, 3000);

    } catch (err) {
      console.error(err);
      alert(`Failed to ${action} ZIP: ${err instanceof Error ? err.message : String(err)}`);
      setZipStatus('idle');
      setZipProgress(0);
      setZipProgressText('');
    }
  };

  useEffect(() => {
    if (isInpaintOpen && previewUrl && inpaintCanvasRef.current) {
      const canvas = inpaintCanvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      inpaintCtxRef.current = ctx;

      const img = new Image();
      img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
        // Initialize history with the original image
        const dataUrl = canvas.toDataURL('image/png');
        setInpaintState({ history: [dataUrl], index: 0 });
      };
      img.src = previewUrl;
    }
  }, [isInpaintOpen, previewUrl]);

  const getInpaintCoordinates = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = inpaintCanvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    
    let clientX, clientY;
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = (e as React.MouseEvent).clientX;
      clientY = (e as React.MouseEvent).clientY;
    }

    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
      clientX,
      clientY
    };
  };

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (inpaintMode !== 'draw') return;
    setIsDrawing(true);
    draw(e);
  };

  const saveInpaintState = () => {
    if (!inpaintCanvasRef.current) return;
    const dataUrl = inpaintCanvasRef.current.toDataURL('image/png');
    setInpaintState(prev => {
      const newHistory = prev.history.slice(0, prev.index + 1);
      newHistory.push(dataUrl);
      return { history: newHistory, index: newHistory.length - 1 };
    });
  };

  const stopDrawing = () => {
    if (isDrawing) {
      setIsDrawing(false);
      if (inpaintCtxRef.current) {
        inpaintCtxRef.current.beginPath();
      }
      saveInpaintState();
    }
  };

  const handleUndoInpaint = () => {
    if (inpaintState.index > 0) {
      const newIndex = inpaintState.index - 1;
      setInpaintState(prev => ({ ...prev, index: newIndex }));
      const img = new Image();
      img.onload = () => {
        if (inpaintCtxRef.current && inpaintCanvasRef.current) {
          inpaintCtxRef.current.clearRect(0, 0, inpaintCanvasRef.current.width, inpaintCanvasRef.current.height);
          inpaintCtxRef.current.drawImage(img, 0, 0);
        }
      };
      img.src = inpaintState.history[newIndex];
    }
  };

  const handleRedoInpaint = () => {
    if (inpaintState.index < inpaintState.history.length - 1) {
      const newIndex = inpaintState.index + 1;
      setInpaintState(prev => ({ ...prev, index: newIndex }));
      const img = new Image();
      img.onload = () => {
        if (inpaintCtxRef.current && inpaintCanvasRef.current) {
          inpaintCtxRef.current.clearRect(0, 0, inpaintCanvasRef.current.width, inpaintCanvasRef.current.height);
          inpaintCtxRef.current.drawImage(img, 0, 0);
        }
      };
      img.src = inpaintState.history[newIndex];
    }
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const coords = getInpaintCoordinates(e);
    if (!coords) return;

    if (!('touches' in e)) {
      setInpaintCursorPos({ x: coords.clientX, y: coords.clientY });
    }

    if (!isDrawing || inpaintMode !== 'draw') return;

    const ctx = inpaintCtxRef.current;
    if (!ctx) return;

    ctx.lineWidth = brushSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = brushColor;

    ctx.lineTo(coords.x, coords.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(coords.x, coords.y);
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    setInpaintCursorPos({ x: e.clientX, y: e.clientY });
    if (isDrawing) {
      draw(e);
    }
  };

  const handleApplyInpaint = async () => {
    if (!inpaintCanvasRef.current || !directoryHandle || selectedIndex === -1) return;
    
    const canvas = inpaintCanvasRef.current;
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      
      try {
        const fileEntry = files[selectedIndex];
        // @ts-ignore
        const writable = await fileEntry.imageHandle.createWritable();
        await writable.write(blob);
        await writable.close();
        
        const newUrl = URL.createObjectURL(blob);
        urlCache.current.set(fileEntry.name, newUrl);
        setPreviewUrl(newUrl);
        
        setIsInpaintOpen(false);
      } catch (err) {
        console.error("Failed to save inpainted image", err);
        alert("Failed to save image.");
      }
    }, 'image/jpeg', 0.95);
  };

  const updateTags = (updater: string[] | ((prev: string[]) => string[])) => {
    setTagState(prev => {
      const resolvedTags = typeof updater === 'function' ? updater(prev.current) : updater;
      if (JSON.stringify(resolvedTags) === JSON.stringify(prev.current)) {
        return prev;
      }
      const newHistory = prev.history.slice(0, prev.index + 1);
      newHistory.push(resolvedTags);
      return {
        current: resolvedTags,
        history: newHistory,
        index: newHistory.length - 1
      };
    });
  };

  const handleUndo = () => {
    setTagState(prev => {
      if (prev.index > 0) {
        const newIndex = prev.index - 1;
        return { ...prev, current: prev.history[newIndex], index: newIndex };
      }
      return prev;
    });
  };

  const handleRedo = () => {
    setTagState(prev => {
      if (prev.index < prev.history.length - 1) {
        const newIndex = prev.index + 1;
        return { ...prev, current: prev.history[newIndex], index: newIndex };
      }
      return prev;
    });
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (document.activeElement?.tagName === 'INPUT') return;
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    return () => {
      urlCache.current.forEach(url => URL.revokeObjectURL(url));
      urlCache.current.clear();
    };
  }, []);

  const lastLoadedIndex = useRef<number>(-1);

  const currentImageHandle = files[selectedIndex]?.imageHandle;
  useEffect(() => {
    if (currentImageHandle) {
      const name = currentImageHandle.name;
      const cached = urlCache.current.get(name);
      
      const isNewImage = lastLoadedIndex.current !== selectedIndex;
      if (isNewImage) {
        lastLoadedIndex.current = selectedIndex;
      }

      if (cached) {
        setPreviewUrl(cached);
        if (isNewImage) {
          setImageState({ history: [cached], index: 0 });
        }
      } else {
        currentImageHandle.getFile().then(async file => {
          const buffer = await file.arrayBuffer();
          const blob = new Blob([buffer], { type: file.type });
          const objectUrl = URL.createObjectURL(blob);
          urlCache.current.set(name, objectUrl);
          // Only update state if we haven't switched to another image while loading
          if (lastLoadedIndex.current === selectedIndex) {
            setPreviewUrl(objectUrl);
            if (isNewImage) {
              setImageState({ history: [objectUrl], index: 0 });
            }
          }
        });
      }
    } else {
      setPreviewUrl('');
      setImageState({ history: [], index: 0 });
      lastLoadedIndex.current = -1;
    }
  }, [currentImageHandle, selectedIndex]);

  // Preload adjacent images for instant switching
  useEffect(() => {
    if (selectedIndex === -1) return;
    
    const preloadIndex = async (idx: number) => {
      if (idx >= 0 && idx < files.length) {
        const handle = files[idx].imageHandle;
        const name = handle.name;
        if (!urlCache.current.has(name)) {
          try {
            const file = await handle.getFile();
            const buffer = await file.arrayBuffer();
            const blob = new Blob([buffer], { type: file.type });
            urlCache.current.set(name, URL.createObjectURL(blob));
          } catch (e) {
            // ignore
          }
        }
      }
    };

    preloadIndex(selectedIndex + 1);
    preloadIndex(selectedIndex - 1);
  }, [selectedIndex, files]);

  const handleOpenFolder = async () => {
    try {
      // @ts-ignore - File System Access API
      const dirHandle = await window.showDirectoryPicker({
        mode: 'readwrite'
      });
      
      // Clear cache when opening a new folder
      urlCache.current.forEach(url => URL.revokeObjectURL(url));
      urlCache.current.clear();
      
      setDirectoryHandle(dirHandle);
      await loadFiles(dirHandle, wdRecursive);
    } catch (err) {
      console.error(err);
    }
  };

  const loadFiles = async (dirHandle: FileSystemDirectoryHandle, isRecursive: boolean) => {
    const fileList: FileEntry[] = [];

    async function scan(handle: FileSystemDirectoryHandle, relativePath: string = '') {
      const entries: FileSystemHandle[] = [];
      // @ts-ignore
      for await (const entry of handle.values()) {
        entries.push(entry);
      }

      const imageEntries = entries.filter((e: any) => e.kind === 'file' && /\.(png|jpe?g|webp|gif)$/i.test(e.name)) as FileSystemFileHandle[];
      const textEntries = entries.filter((e: any) => e.kind === 'file' && /\.txt$/i.test(e.name)) as FileSystemFileHandle[];

      for (const imgHandle of imageEntries) {
        const baseName = imgHandle.name.substring(0, imgHandle.name.lastIndexOf('.'));
        const txtHandle = textEntries.find((t: any) => t.name === `${baseName}.txt`);
        fileList.push({
          imageHandle: imgHandle,
          textHandle: txtHandle,
          name: relativePath + imgHandle.name,
          baseName: relativePath + baseName,
          tags: [],
          parentHandle: handle
        });
      }

      if (isRecursive) {
        const subDirs = entries.filter((e: any) => e.kind === 'directory') as FileSystemDirectoryHandle[];
        for (const subDir of subDirs) {
          await scan(subDir, relativePath + subDir.name + '/');
        }
      }
    }

    await scan(dirHandle);

    // Load tags concurrently
    await Promise.all(fileList.map(async (file) => {
      if (file.textHandle) {
        try {
          const txtFile = await file.textHandle.getFile();
          const text = await txtFile.text();
          file.tags = text.split(',').map((t: string) => t.trim()).filter((t: string) => t.length > 0);
        } catch (e) {
          console.error("Error reading tags for", file.name, e);
        }
      }
    }));

    setFiles(fileList);
    if (fileList.length > 0) {
      setSelectedIndex(0);
      setTagState({
        current: fileList[0].tags,
        history: [fileList[0].tags],
        index: 0
      });
    }
  };

  const getCroppedImg = async (image: HTMLImageElement, crop: Crop): Promise<Blob | null> => {
    const canvas = document.createElement('canvas');
    const scaleX = image.naturalWidth / image.width;
    const scaleY = image.naturalHeight / image.height;
    canvas.width = crop.width;
    canvas.height = crop.height;
    const ctx = canvas.getContext('2d');

    if (!ctx) return null;

    ctx.drawImage(
      image,
      crop.x * scaleX,
      crop.y * scaleY,
      crop.width * scaleX,
      crop.height * scaleY,
      0,
      0,
      crop.width,
      crop.height
    );

    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        resolve(blob);
      }, 'image/jpeg', 1);
    });
  };

  const handleSave = async () => {
    if (selectedIndex === -1 || !directoryHandle) return;
    setSaveStatus('saving');
    try {
      const currentFile = files[selectedIndex];
      let txtHandle = currentFile.textHandle;
      
      if (!txtHandle) {
        // @ts-ignore
        txtHandle = await currentFile.parentHandle.getFileHandle(`${currentFile.baseName.split('/').pop()}.txt`, { create: true });
      }

      // @ts-ignore
      const writable = await txtHandle.createWritable();
      await writable.write(activeTags.join(', '));
      await writable.close();

      // Save Crop if exists
      if (crop && crop.width > 0 && crop.height > 0 && previewImgRef.current) {
        const croppedBlob = await getCroppedImg(previewImgRef.current, crop);
        if (croppedBlob) {
          // @ts-ignore
          const writableImg = await currentFile.imageHandle.createWritable();
          await writableImg.write(croppedBlob);
          await writableImg.close();
          
          // Update preview URL to reflect new crop
          const newObjectUrl = URL.createObjectURL(croppedBlob);
          urlCache.current.set(currentFile.name, newObjectUrl);
          setPreviewUrl(newObjectUrl);
          
          setImageState(prev => {
            const newHistory = prev.history.slice(0, prev.index + 1);
            newHistory.push(newObjectUrl);
            return { history: newHistory, index: newHistory.length - 1 };
          });

          setCrop(undefined); // reset crop
        }
      }

      // Update state to reflect that it now has a text handle and updated tags
      setFiles(prev => {
        const newFiles = [...prev];
        newFiles[selectedIndex] = { ...newFiles[selectedIndex], textHandle: txtHandle, tags: activeTags };
        return newFiles;
      });
      
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (err) {
      console.error(err);
      alert('Failed to save.');
      setSaveStatus('idle');
    }
  };

  const handleUndoCrop = async () => {
    if (imageState.index > 0) {
      const newIndex = imageState.index - 1;
      const previousUrl = imageState.history[newIndex];
      setImageState(prev => ({ ...prev, index: newIndex }));
      setPreviewUrl(previousUrl);
      urlCache.current.set(files[selectedIndex].name, previousUrl);
      
      try {
        const response = await fetch(previousUrl);
        const blob = await response.blob();
        // @ts-ignore
        const writableImg = await files[selectedIndex].imageHandle.createWritable();
        await writableImg.write(blob);
        await writableImg.close();
      } catch (e) {
        console.error("Failed to write undo crop to disk", e);
      }
    }
  };

  const handleRedoCrop = async () => {
    if (imageState.index < imageState.history.length - 1) {
      const newIndex = imageState.index + 1;
      const nextUrl = imageState.history[newIndex];
      setImageState(prev => ({ ...prev, index: newIndex }));
      setPreviewUrl(nextUrl);
      urlCache.current.set(files[selectedIndex].name, nextUrl);
      
      try {
        const response = await fetch(nextUrl);
        const blob = await response.blob();
        // @ts-ignore
        const writableImg = await files[selectedIndex].imageHandle.createWritable();
        await writableImg.write(blob);
        await writableImg.close();
      } catch (e) {
        console.error("Failed to write redo crop to disk", e);
      }
    }
  };

  const handleDeleteFile = async (e: React.MouseEvent, idx: number) => {
    e.stopPropagation();
    if (isProcessing) return;
    
    const file = files[idx];
    setDeleteConfirm({ isOpen: true, type: 'file', idx, fileName: file.name });
  };

  const commitNewTag = () => {
    if (newTag.trim()) {
      const tagsToAdd = newTag.split(',').map(t => t.trim()).filter(t => t.length > 0);
      updateTags(prev => {
        const newTags = [...prev, ...tagsToAdd.filter(t => !prev.includes(t))];
        return newTags;
      });
      setNewTag('');
    }
  };

  const handleAddTag = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      commitNewTag();
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    updateTags(prev => prev.filter(t => t !== tagToRemove));
  };

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5, // 5px movement before drag starts, allows clicking buttons
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      updateTags((items) => {
        const oldIndex = items.indexOf(active.id as string);
        const newIndex = items.indexOf(over.id as string);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };

  return (
    <div className="w-full h-full flex flex-row overflow-hidden bg-[#09090b]">
      {/* Sidebar (Left) */}
      <div className="w-[300px] flex flex-col bg-black/40 border-r border-white/5 shrink-0 overflow-hidden z-10">
        <div className="p-4 border-b border-white/5 flex flex-col gap-2">
          <div className="flex items-center gap-2 px-1">
            <input 
              type="checkbox" id="wdRecursive"
              checked={wdRecursive} onChange={e => setWdRecursive(e.target.checked)}
              className="w-4 h-4 rounded border-white/20 bg-black/50 text-themePrimary focus:ring-themePrimary/50 focus:ring-offset-0"
            />
            <label htmlFor="wdRecursive" className="text-xs font-medium text-zinc-400 cursor-pointer select-none">
              Recursive Scan
            </label>
          </div>
          <button 
            onClick={handleOpenFolder}
            disabled={isProcessing}
            className="w-full flex items-center justify-center gap-2 bg-white/10 hover:bg-white/20 text-white py-2.5 px-4 rounded-xl transition-colors font-medium text-sm border border-white/10 disabled:opacity-50"
          >
            <FolderOpen size={16} />
            Open Folder
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 custom-scrollbar">
          <div className="grid grid-cols-3 gap-2">
            {files.map((file, idx) => (
              <div 
                key={file.name}
                onClick={() => {
                  if (isProcessing) return;
                  setSelectedIndex(idx);
                  setTagState({
                    current: file.tags,
                    history: [file.tags],
                    index: 0
                  });
                }}
                className={`relative aspect-square rounded-lg overflow-hidden cursor-pointer border-2 transition-all duration-150 group ${idx === selectedIndex ? 'border-themePrimary shadow-[0_0_20px_var(--theme-primary-hover)] z-10 scale-105 brightness-110' : 'border-transparent hover:border-white/30 opacity-60 hover:opacity-100'}`}
              >
                <Thumbnail imageHandle={file.imageHandle} name={file.name} urlCache={urlCache} />
                <div className="absolute bottom-1 right-1 bg-black/80 backdrop-blur-sm text-[10px] px-1.5 py-0.5 rounded text-white font-medium border border-white/10">
                  {file.tags.length}
                </div>
                <button
                  onClick={(e) => handleDeleteFile(e, idx)}
                  disabled={isProcessing}
                  className="absolute top-1 right-1 p-1 bg-black/60 hover:bg-red-600/90 text-white rounded-md opacity-0 group-hover:opacity-100 transition-all disabled:opacity-0"
                  title="Delete image and tags"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
          {files.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-zinc-500 gap-3 opacity-50">
              <ImageIcon size={48} strokeWidth={1} />
              <p className="text-sm text-center px-4">Select a folder to load images and tags.</p>
            </div>
          )}
        </div>
      </div>

      {/* Main Content - Fullscreen Image & Overlay */}
      <div className="flex-1 relative overflow-hidden bg-black/90 flex items-center justify-center">
        {selectedIndex !== -1 ? (
          <>
            {/* Image Area */}
            {isCropping ? (
              <div className="w-full h-full flex items-center justify-center p-8">
                <ReactCrop crop={crop} onChange={c => setCrop(c)}>
                  <img 
                    ref={previewImgRef}
                    src={previewUrl || 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'} 
                    alt={files[selectedIndex].name}
                    className={`max-w-full max-h-[85vh] object-contain transition-opacity duration-300 ${previewUrl ? 'opacity-100' : 'opacity-0'}`}
                  />
                </ReactCrop>
              </div>
            ) : isInpaintOpen ? (
              <div 
                className="w-full h-full relative flex items-center justify-center overflow-hidden"
                onMouseEnter={() => setIsHoveringCanvas(true)}
                onMouseLeave={() => {
                  setIsHoveringCanvas(false);
                  stopDrawing();
                }}
              >
                <TransformWrapper 
                  disabled={inpaintMode === 'draw'} 
                  centerOnInit 
                  minScale={0.1} 
                  maxScale={10} 
                  wheel={{ step: 0.1 }}
                >
                  <TransformComponent wrapperStyle={{ width: '100%', height: '100%' }} contentStyle={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <canvas
                      ref={inpaintCanvasRef}
                      onMouseDown={startDrawing}
                      onMouseMove={handleCanvasMouseMove}
                      onMouseUp={stopDrawing}
                      onTouchStart={startDrawing}
                      onTouchMove={handleCanvasMouseMove}
                      onTouchEnd={stopDrawing}
                      className={`max-w-full max-h-full object-contain shadow-2xl ${inpaintMode === 'draw' ? 'cursor-none' : 'cursor-grab active:cursor-grabbing'}`}
                    />
                  </TransformComponent>
                </TransformWrapper>

                {/* Custom Cursor for Brush */}
                {isHoveringCanvas && inpaintMode === 'draw' && (
                  <div 
                    className="fixed pointer-events-none rounded-full border-2 border-white mix-blend-difference z-50 transform -translate-x-1/2 -translate-y-1/2"
                    style={{
                      left: inpaintCursorPos.x,
                      top: inpaintCursorPos.y,
                      width: brushSize * (inpaintCanvasRef.current ? (inpaintCanvasRef.current.getBoundingClientRect().width / inpaintCanvasRef.current.width) : 1),
                      height: brushSize * (inpaintCanvasRef.current ? (inpaintCanvasRef.current.getBoundingClientRect().height / inpaintCanvasRef.current.height) : 1),
                      backgroundColor: brushColor + '40'
                    }}
                  />
                )}
              </div>
            ) : (
              <TransformWrapper centerOnInit minScale={0.1} maxScale={10} wheel={{ step: 0.1 }}>
                <TransformComponent wrapperStyle={{ width: '100%', height: '100%' }} contentStyle={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <img 
                    ref={previewImgRef}
                    src={previewUrl || 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'} 
                    alt={files[selectedIndex].name}
                    className={`max-w-full max-h-full object-contain transition-opacity duration-300 ${previewUrl ? 'opacity-100' : 'opacity-0'}`}
                  />
                </TransformComponent>
              </TransformWrapper>
            )}

            {/* Overlays Wrapper */}
            <div className="absolute bottom-8 left-1/2 -translate-x-1/2 w-[960px] max-w-[95vw] flex flex-col items-center justify-end z-50 pointer-events-none">
              
              {/* Global Floating Progress Bar */}
              <div className={`absolute bottom-full mb-4 w-[400px] max-w-[90vw] bg-black/80 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl p-4 pointer-events-auto transition-all duration-300 ease-in-out ${(wdStatus !== 'idle' || batchStatus !== 'idle' || zipStatus !== 'idle') ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8 pointer-events-none'}`}>
                <div className="flex justify-between text-sm text-white font-medium mb-2 gap-2">
                  <span className="truncate">
                    {wdStatus !== 'idle' ? wdProgressText : 
                     batchStatus !== 'idle' ? batchProgressText : 
                     zipProgressText}
                  </span>
                  <span className="shrink-0">
                    {wdStatus !== 'idle' ? wdProgress : 
                     batchStatus !== 'idle' ? batchProgress : 
                     zipProgress}%
                  </span>
                </div>
                <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                  <div 
                    className={`h-full transition-all duration-300 ease-out bg-themePrimary`}
                    style={{ width: `${
                      wdStatus !== 'idle' ? wdProgress : 
                      batchStatus !== 'idle' ? batchProgress : 
                      zipProgress
                    }%` }}
                  />
                </div>
              </div>

              <div className="relative w-full flex justify-center">
                {/* Floating Tag Editor Overlay (Centered Landscape) */}
                <div className={`w-full max-h-[85vh] flex flex-col bg-black/60 backdrop-blur-2xl rounded-2xl border border-white/10 shadow-2xl overflow-hidden transition-all duration-300 ease-in-out ${isCropping || isAutoTagModalOpen || isZipModalOpen || isInpaintOpen ? 'opacity-0 translate-y-8 absolute bottom-0 pointer-events-none' : 'opacity-100 translate-y-0 relative pointer-events-auto'}`}>
               
               {/* Tags Area (Top) */}
               <div className="p-5 min-h-[120px] max-h-[30vh] overflow-y-auto custom-scrollbar">
                 <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                   <SortableContext items={activeTags} strategy={rectSortingStrategy}>
                     <div className="flex flex-wrap gap-2 content-start">
                       {activeTags.map((tag) => (
                         <SortableTag key={tag} tag={tag} onRemove={handleRemoveTag} />
                       ))}
                       {activeTags.length === 0 && (
                         <div className="w-full text-left text-zinc-400 text-sm italic p-2">
                           No tags yet. Type below to add!
                         </div>
                       )}
                     </div>
                   </SortableContext>
                 </DndContext>
               </div>

               {/* Bottom Control Bar */}
               <div className="flex items-center justify-between p-3 bg-black/40 border-t border-white/10 gap-4">
                  {/* Left: Other Buttons */}
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="flex items-center bg-white/5 rounded-lg overflow-hidden border border-white/10">
                      <button 
                        onClick={handleUndo} 
                        disabled={tagState.index <= 0} 
                        className="px-3 py-2 hover:bg-white/10 text-white disabled:opacity-30 transition-colors border-r border-white/10 flex items-center gap-1"
                        title="Undo (Ctrl+Z)"
                      >
                        <Undo2 size={16}/>
                      </button>
                      <button 
                        onClick={handleRedo} 
                        disabled={tagState.index >= tagState.history.length - 1} 
                        className="px-3 py-2 hover:bg-white/10 text-white disabled:opacity-30 transition-colors flex items-center gap-1"
                        title="Redo (Ctrl+Shift+Z)"
                      >
                        <Redo2 size={16}/>
                      </button>
                    </div>

                    <button 
                      onClick={() => setIsAutoTagModalOpen(true)} 
                      disabled={isProcessing}
                      className="px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors border border-white/10 bg-white/5 hover:bg-white/10 text-white disabled:opacity-50"
                      title="Auto-tag & Batch Process"
                    >
                      <Wand2 size={16}/> Auto Tag
                    </button>

                    <button 
                      onClick={() => setIsZipModalOpen(true)} 
                      disabled={isProcessing}
                      className="px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors border border-white/10 bg-white/5 hover:bg-white/10 text-white disabled:opacity-50"
                      title="Export to ZIP / Hugging Face"
                    >
                      <Archive size={16}/> ZIP
                    </button>

                    <button 
                      onClick={() => setIsInpaintOpen(true)} 
                      disabled={isProcessing}
                      className="px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors border border-white/10 bg-white/5 hover:bg-white/10 text-white disabled:opacity-50"
                      title="Inpaint / Draw"
                    >
                      <Paintbrush size={16}/> Inpaint
                    </button>

                    <button 
                      onClick={() => setIsCropping(true)} 
                      disabled={isProcessing}
                      className="px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors border border-white/10 bg-white/5 hover:bg-white/10 text-white disabled:opacity-50"
                    >
                      <CropIcon size={16}/> Crop
                    </button>
                  </div>

                  {/* Right: Input & Save */}
                  <div className="flex items-center gap-2 flex-1">
                    <div className="relative flex-1 flex items-center">
                      <input 
                        type="text"
                        value={newTag}
                        onChange={(e) => setNewTag(e.target.value)}
                        onKeyDown={handleAddTag}
                        disabled={isProcessing}
                        placeholder="Add tags (comma separated)..."
                        className="w-full bg-white/5 border border-white/10 rounded-lg pl-4 pr-10 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-themePrimary/50 focus:bg-white/10 transition-all disabled:opacity-50"
                      />
                      <button
                        onClick={commitNewTag}
                        disabled={!newTag.trim() || isProcessing}
                        className="absolute right-2 p-1.5 text-zinc-400 hover:text-white hover:bg-white/10 rounded-md transition-colors disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-zinc-400"
                        title="Add Tag"
                      >
                        <Plus size={16} />
                      </button>
                    </div>
                    <button 
                      onClick={handleSave}
                      disabled={saveStatus === 'saving' || isProcessing}
                      className="shrink-0 px-6 py-2 rounded-lg bg-themeBtn hover:bg-themeBtnHover text-themeBtnText border border-themeBorder text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50 transition-colors"
                    >
                      {saveStatus === 'saving' ? (
                        <div className="w-4 h-4 border-2 border-black/20 border-t-black rounded-full animate-spin" />
                      ) : saveStatus === 'saved' ? (
                        <Save size={16} />
                      ) : (
                        <Save size={16} />
                      )}
                      {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? 'Saved!' : 'Save'}
                    </button>
                  </div>
               </div>
            </div>

            {/* Floating Crop Controls */}
            <div className={`flex items-center gap-3 bg-black/80 backdrop-blur-2xl rounded-2xl border border-white/10 shadow-2xl p-3 transition-all duration-300 ease-in-out ${isCropping ? 'opacity-100 translate-y-0 relative pointer-events-auto' : 'opacity-0 translate-y-8 absolute bottom-0 pointer-events-none'}`}>
              <div className="flex items-center bg-white/5 rounded-lg overflow-hidden border border-white/10 mr-2">
                <button 
                  onClick={handleUndoCrop} 
                  disabled={imageState.index <= 0} 
                  className="px-3 py-2 hover:bg-white/10 text-white disabled:opacity-30 transition-colors border-r border-white/10 flex items-center gap-1"
                  title="Undo Crop"
                >
                  <Undo2 size={16}/>
                </button>
                <button 
                  onClick={handleRedoCrop} 
                  disabled={imageState.index >= imageState.history.length - 1} 
                  className="px-3 py-2 hover:bg-white/10 text-white disabled:opacity-30 transition-colors flex items-center gap-1"
                  title="Redo Crop"
                >
                  <Redo2 size={16}/>
                </button>
              </div>
              <button 
                onClick={() => {
                  setIsCropping(false);
                  setCrop(undefined);
                }} 
                className="px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors bg-white/10 hover:bg-white/20 text-white"
              >
                <X size={16}/> Cancel
              </button>
              <button 
                onClick={handleSave}
                disabled={saveStatus === 'saving' || !crop || crop.width === 0 || isProcessing}
                className="px-6 py-2 rounded-lg bg-themeBtn hover:bg-themeBtnHover text-themeBtnText border border-themeBorder text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50 transition-colors"
              >
                {saveStatus === 'saving' ? (
                  <div className="w-4 h-4 border-2 border-black/20 border-t-black rounded-full animate-spin" />
                ) : (
                  <CropIcon size={16} />
                )}
                {saveStatus === 'saving' ? 'Applying...' : 'Apply Crop'}
              </button>
            </div>

            {/* Floating Auto Tag & Batch Processing Overlay */}
            <div className={`w-full max-h-[85vh] flex flex-col bg-black/80 backdrop-blur-2xl rounded-2xl border border-white/10 shadow-2xl overflow-hidden transition-all duration-300 ease-in-out ${isAutoTagModalOpen ? 'opacity-100 translate-y-0 relative pointer-events-auto' : 'opacity-0 translate-y-8 absolute bottom-0 pointer-events-none'}`}>
        <button 
          onClick={() => !isProcessing && setIsAutoTagModalOpen(false)}
          disabled={isProcessing}
          className="absolute top-4 right-4 p-1.5 text-zinc-400 hover:text-white hover:bg-white/10 rounded-md transition-colors z-10 disabled:opacity-50"
        >
          <X size={18} />
        </button>
        
        <div className="p-6 pt-8 grid grid-cols-2 gap-6 overflow-y-auto custom-scrollbar flex-1 relative">
          {/* Left Column: Tag Generation */}
          <div className="flex flex-col gap-4">
            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <label className="text-sm text-zinc-300">Model</label>
                {wdModelExists && (
                  <button onClick={handleDeleteModel} className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1">
                    <Trash2 size={12} /> Delete Cached Model
                  </button>
                )}
              </div>
              <select 
                value={selectedModelId} 
                onChange={e => setSelectedModelId(e.target.value)} 
                className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white/30"
              >
                <option value="eva02-v3">EVA02 Large v3 (~1.2GB)</option>
                <option value="vit-v3">ViT Large v3 (~1.2GB)</option>
                <option value="swinv2-v2">SwinV2 v2 (~1.1GB)</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-zinc-300 flex justify-between">
                  <span>General Thresh</span>
                  <span className="text-zinc-500">{wdThreshold.toFixed(2)}</span>
                </label>
                <input 
                  type="range" min="0" max="1" step="0.01"
                  value={wdThreshold} onChange={e => setWdThreshold(parseFloat(e.target.value))}
                  className="w-full accent-themePrimary"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-zinc-300 flex justify-between">
                  <span>Char Thresh</span>
                  <span className="text-zinc-500">{wdCharThreshold.toFixed(2)}</span>
                </label>
                <input 
                  type="range" min="0" max="1" step="0.01"
                  value={wdCharThreshold} onChange={e => setWdCharThreshold(parseFloat(e.target.value))}
                  className="w-full accent-themePrimary"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-zinc-300 flex justify-between">
                <span>Limit by Maximum Number (Top-K)</span>
                <span className="text-zinc-500">{wdTopK === 0 ? 'No Limit' : wdTopK}</span>
              </label>
              <input 
                type="range" min="0" max="100" step="1"
                value={wdTopK} onChange={e => setWdTopK(parseInt(e.target.value))}
                className="w-full accent-themePrimary"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-zinc-300">Exclude Categories</label>
              <div className="grid grid-cols-3 gap-1.5">
                {[0, 1, 3, 4, 5].map(id => {
                  const name = ['General', 'Artist', '', 'Copyright', 'Character', 'Meta'][id];
                  if (!name) return null;
                  const isExcluded = wdExcludeCategories.includes(id);
                  return (
                    <button
                      key={id}
                      onClick={() => {
                        if (isExcluded) {
                          setWdExcludeCategories(prev => prev.filter(x => x !== id));
                        } else {
                          setWdExcludeCategories(prev => [...prev, id]);
                        }
                      }}
                      className={`px-2 py-1.5 rounded-md text-[11px] font-medium transition-all border ${isExcluded ? 'bg-themePrimary/20 border-themePrimary/40 text-white' : 'bg-white/5 border-white/10 text-zinc-400 hover:bg-white/10'}`}
                    >
                      {name}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center gap-3 p-3 bg-white/5 rounded-lg border border-white/5 mt-auto">
              <input 
                type="checkbox" id="wdRemoveRedundant"
                checked={wdRemoveRedundant} onChange={e => setWdRemoveRedundant(e.target.checked)}
                className="w-4 h-4 rounded border-white/20 bg-black/50 text-themePrimary focus:ring-themePrimary/50 focus:ring-offset-0"
              />
              <label htmlFor="wdRemoveRedundant" className="text-sm font-medium text-zinc-300 cursor-pointer select-none leading-tight">
                Remove redundant tags
              </label>
            </div>

            <div className="flex items-center gap-3 p-3 bg-white/5 rounded-lg border border-white/5 mt-2">
              <input 
                type="checkbox" id="wdOverwrite"
                checked={wdOverwrite} onChange={e => setWdOverwrite(e.target.checked)}
                className="w-4 h-4 rounded border-white/20 bg-black/50 text-themePrimary focus:ring-themePrimary/50 focus:ring-offset-0"
              />
              <label htmlFor="wdOverwrite" className="text-sm font-medium text-zinc-300 cursor-pointer select-none leading-tight">
                Overwrite existing tags
              </label>
            </div>

            {wdStatus === 'loading' || wdStatus === 'processing' ? (
              <button 
                onClick={handleCancel}
                className="w-full py-2.5 rounded-lg bg-red-600 hover:bg-red-700 text-white border border-red-500 text-sm font-bold flex items-center justify-center gap-2 transition-colors"
              >
                <X size={16} /> Cancel
              </button>
            ) : (
              <button 
                onClick={handleWdProcess}
                disabled={isProcessing}
                className="w-full py-2.5 rounded-lg bg-themeBtn hover:bg-themeBtnHover text-themeBtnText border border-themeBorder text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50 transition-colors"
              >
                {wdStatus === 'done' ? <Save size={16} /> : <Wand2 size={16} />}
                {wdStatus === 'done' ? 'Done!' : 'Generate Tags'}
              </button>
            )}
          </div>

          {/* Right Column: Batch Processing */}
          <div className="flex flex-col gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-zinc-300">Activation Tags</label>
              <div className="relative flex items-center">
                <input 
                  type="text" value={batchActivationTags} onChange={e => setBatchActivationTags(e.target.value)}
                  placeholder="e.g., sakura, 1girl"
                  className="w-full bg-black/50 border border-white/10 rounded-lg px-3 pr-8 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-white/30"
                />
                {batchActivationTags && (
                  <button onClick={() => setBatchActivationTags('')} className="absolute right-2 p-1 text-zinc-400 hover:text-white transition-colors">
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-zinc-300">Tags to Emphasize</label>
              <div className="relative flex items-center">
                <input 
                  type="text" value={batchEmphasizeTags} onChange={e => setBatchEmphasizeTags(e.target.value)}
                  placeholder="e.g., solo, long hair"
                  className="w-full bg-black/50 border border-white/10 rounded-lg px-3 pr-8 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-white/30"
                />
                {batchEmphasizeTags && (
                  <button onClick={() => setBatchEmphasizeTags('')} className="absolute right-2 p-1 text-zinc-400 hover:text-white transition-colors">
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-zinc-300">Tags to Remove</label>
              <div className="relative flex items-center">
                <input 
                  type="text" value={batchRemoveTags} onChange={e => setBatchRemoveTags(e.target.value)}
                  placeholder="e.g., blurry, bad anatomy"
                  className="w-full bg-black/50 border border-white/10 rounded-lg px-3 pr-8 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-white/30"
                />
                {batchRemoveTags && (
                  <button onClick={() => setBatchRemoveTags('')} className="absolute right-2 p-1 text-zinc-400 hover:text-white transition-colors">
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3 p-3 bg-white/5 rounded-lg border border-white/5 mt-auto">
              <input 
                type="checkbox" id="renameSeq"
                checked={batchRename} onChange={e => setBatchRename(e.target.checked)}
                className="w-4 h-4 rounded border-white/20 bg-black/50 text-themePrimary focus:ring-themePrimary/50 focus:ring-offset-0"
              />
              <label htmlFor="renameSeq" className="text-sm font-medium text-zinc-300 cursor-pointer select-none leading-tight">
                Rename files sequentially (1.jpg, 1.txt)
              </label>
            </div>

            <button 
              onClick={handleBatchProcess}
              disabled={isProcessing || (!batchActivationTags && !batchEmphasizeTags && !batchRemoveTags && !batchRename)}
              className="w-full py-2.5 rounded-lg bg-themeBtn hover:bg-themeBtnHover text-themeBtnText border border-themeBorder text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50 transition-colors"
            >
              {batchStatus === 'processing' ? (
                <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
              ) : batchStatus === 'done' ? (
                <Save size={16} />
              ) : (
                <Settings size={16} />
              )}
              {batchStatus === 'processing' ? 'Processing...' : batchStatus === 'done' ? 'Done!' : 'Process Tag'}
            </button>
          </div>
        </div>
      </div>

            {/* Floating ZIP Overlay */}
            <div className={`w-full max-h-[85vh] flex flex-col bg-black/80 backdrop-blur-2xl rounded-2xl border border-white/10 shadow-2xl overflow-hidden transition-all duration-300 ease-in-out ${isZipModalOpen ? 'opacity-100 translate-y-0 relative pointer-events-auto' : 'opacity-0 translate-y-8 absolute bottom-0 pointer-events-none'}`}>
        <button 
          onClick={() => !isProcessing && setIsZipModalOpen(false)}
          disabled={isProcessing}
          className="absolute top-4 right-4 p-1.5 text-zinc-400 hover:text-white hover:bg-white/10 rounded-md transition-colors z-10 disabled:opacity-50"
        >
          <X size={18} />
        </button>
        
        <div className="p-6 pt-8 grid grid-cols-2 gap-6 overflow-y-auto custom-scrollbar flex-1 relative">
          {/* Left Column: ZIP Options */}
          <div className="flex flex-col gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-zinc-300">Filename</label>
              <input 
                type="text" value={zipFilename} onChange={e => setZipFilename(e.target.value)}
                placeholder="dataset.zip"
                className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-white/30"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-zinc-300">Password (Optional)</label>
              <input 
                type="password" value={zipPassword} onChange={e => setZipPassword(e.target.value)}
                placeholder="Leave blank for no password"
                className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-white/30"
              />
            </div>

            <div className="flex items-center gap-3 p-3 bg-white/5 rounded-lg border border-white/5">
              <input 
                type="checkbox" id="zipLegacy"
                checked={zipLegacy} onChange={e => setZipLegacy(e.target.checked)}
                disabled={!zipPassword}
                className="w-4 h-4 rounded border-white/20 bg-black/50 text-themePrimary focus:ring-themePrimary/50 focus:ring-offset-0 disabled:opacity-50"
              />
              <label htmlFor="zipLegacy" className={`text-sm font-medium cursor-pointer select-none leading-tight ${!zipPassword ? 'text-zinc-500' : 'text-zinc-300'}`}>
                Use Legacy Encryption (ZipCrypto)
              </label>
            </div>

            <div className="space-y-1.5 mt-auto">
              <label className="text-sm font-medium text-zinc-300 flex justify-between">
                <span>Compression Level</span>
                <span className="text-zinc-500">{zipLevel === 0 ? 'Store' : zipLevel}</span>
              </label>
              <input 
                type="range" min="0" max="9" step="1"
                value={zipLevel} onChange={e => setZipLevel(parseInt(e.target.value))}
                className="w-full accent-themePrimary"
              />
            </div>

            {zipStatus === 'zipping' ? (
              <button 
                onClick={handleCancel}
                className="w-full py-2.5 rounded-lg bg-red-600 hover:bg-red-700 text-white border border-red-500 text-sm font-bold flex items-center justify-center gap-2 transition-colors mt-2"
              >
                <X size={16} /> Cancel
              </button>
            ) : (
              <button 
                onClick={() => handleCreateZip('download')}
                disabled={isProcessing}
                className="w-full py-2.5 rounded-lg bg-themeBtn hover:bg-themeBtnHover text-themeBtnText border border-themeBorder text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50 transition-colors mt-2"
              >
                {zipStatus === 'done' ? <Save size={16} /> : <Download size={16} />}
                {zipStatus === 'done' ? 'Done!' : 'Download ZIP'}
              </button>
            )}
          </div>

          {/* Right Column: Hugging Face Upload */}
          <div className="flex flex-col gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-zinc-300">Access Token (Write)</label>
              <input 
                type="password" value={hfToken} onChange={e => setHfToken(e.target.value)}
                placeholder="hf_..."
                className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-white/30"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-zinc-300">Dataset Repo ID</label>
              <input 
                type="text" value={hfRepo} onChange={e => setHfRepo(e.target.value)}
                placeholder="username/dataset-name"
                className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-white/30"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-zinc-300">Folder in Repo (Optional)</label>
              <input 
                type="text" value={hfFolder} onChange={e => setHfFolder(e.target.value)}
                placeholder="e.g., data/images"
                className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-white/30"
              />
            </div>

            {zipStatus === 'uploading' || (zipStatus === 'zipping' && hfToken) ? (
              <button 
                onClick={handleCancel}
                className="w-full py-2.5 rounded-lg bg-red-600 hover:bg-red-700 text-white border border-red-500 text-sm font-bold flex items-center justify-center gap-2 transition-colors mt-auto"
              >
                <X size={16} /> Cancel
              </button>
            ) : (
              <button 
                onClick={() => handleCreateZip('upload')}
                disabled={isProcessing || !hfToken || !hfRepo}
                className="w-full py-2.5 rounded-lg bg-themeBtn hover:bg-themeBtnHover text-themeBtnText border border-themeBorder text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50 transition-colors mt-auto"
              >
                {zipStatus === 'done' ? <Save size={16} /> : <UploadCloud size={16} />}
                {zipStatus === 'done' ? 'Done!' : 'Upload to Hugging Face'}
              </button>
            )}
          </div>
        </div>
      </div>

            {/* Floating Inpaint Controls */}
            <div className={`flex items-center gap-3 bg-black/80 backdrop-blur-2xl rounded-2xl border border-white/10 shadow-2xl p-3 transition-all duration-300 ease-in-out ${isInpaintOpen ? 'opacity-100 translate-y-0 relative pointer-events-auto' : 'opacity-0 translate-y-8 absolute bottom-0 pointer-events-none'}`}>
        <div className="flex items-center bg-white/5 rounded-lg overflow-hidden border border-white/10 mr-2">
          <button 
            onClick={handleUndoInpaint} 
            disabled={inpaintState.index <= 0} 
            className="px-3 py-2 hover:bg-white/10 text-white disabled:opacity-30 transition-colors border-r border-white/10 flex items-center gap-1"
            title="Undo Inpaint"
          >
            <Undo2 size={16}/>
          </button>
          <button 
            onClick={handleRedoInpaint} 
            disabled={inpaintState.index >= inpaintState.history.length - 1} 
            className="px-3 py-2 hover:bg-white/10 text-white disabled:opacity-30 transition-colors flex items-center gap-1"
            title="Redo Inpaint"
          >
            <Redo2 size={16}/>
          </button>
        </div>
        <div className="flex items-center gap-2 bg-white/5 p-1 rounded-lg border border-white/10">
          <button 
            onClick={() => setInpaintMode('draw')}
            className={`p-2 rounded-md transition-colors ${inpaintMode === 'draw' ? 'bg-themePrimary text-themeBtnText' : 'text-zinc-400 hover:text-white hover:bg-white/10'}`}
            title="Draw Mode"
          >
            <Paintbrush size={16} />
          </button>
          <button 
            onClick={() => setInpaintMode('pan')}
            className={`p-2 rounded-md transition-colors ${inpaintMode === 'pan' ? 'bg-themePrimary text-white' : 'text-zinc-400 hover:text-white hover:bg-white/10'}`}
            title="Pan Mode"
          >
            <MousePointer2 size={16} />
          </button>
        </div>

        <div className="flex items-center gap-3 px-2">
          <input 
            type="range" min="1" max="200" 
            value={brushSize} onChange={e => setBrushSize(parseInt(e.target.value))}
            className="w-24 accent-themePrimary"
            title="Brush Size"
          />
          <input 
            type="color" 
            value={brushColor} onChange={e => setBrushColor(e.target.value)}
            className="w-6 h-6 rounded cursor-pointer bg-transparent border-0 p-0"
            title="Brush Color"
          />
        </div>

        <div className="h-6 w-px bg-white/10 mx-1"></div>

        <button 
          onClick={() => setIsInpaintOpen(false)}
          className="px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors bg-white/10 hover:bg-white/20 text-white"
        >
          <X size={16}/> Cancel
        </button>
        <button 
          onClick={handleApplyInpaint}
          disabled={isProcessing}
          className="px-4 py-2 rounded-lg bg-themeBtn hover:bg-themeBtnHover text-themeBtnText border border-themeBorder text-sm font-bold flex items-center gap-2 transition-colors disabled:opacity-50"
        >
          <Save size={16} /> Apply
        </button>
      </div>

              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center text-zinc-500 gap-4">
            <ImageIcon size={64} strokeWidth={1} className="opacity-50" />
            <p>Select an image from the sidebar</p>
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {deleteConfirm.isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="bg-surface border border-white/10 rounded-2xl p-6 max-w-md w-full shadow-2xl">
            <h3 className="text-xl font-bold text-white mb-2">Confirm Deletion</h3>
            <p className="text-zinc-400 mb-6">
              {deleteConfirm.type === 'model' 
                ? 'Are you sure you want to delete the downloaded model? It will need to be downloaded again.'
                : `Are you sure you want to delete ${deleteConfirm.fileName} and its tags? This cannot be undone.`}
            </p>
            <div className="flex items-center justify-end gap-3">
              <button 
                onClick={() => setDeleteConfirm({ isOpen: false, type: 'file' })}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-white/5 hover:bg-white/10 transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={confirmDelete}
                className="px-4 py-2 rounded-lg text-sm font-bold text-white bg-red-600 hover:bg-red-700 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
