import React, { useState, useEffect, useRef } from 'react';
import { 
  Search, Image as ImageIcon, Info, Shield, ShieldAlert, Loader2, 
  Tag as TagIcon, User, Copyright, Hash, X, Copy, Check, 
  ExternalLink, ChevronLeft, ChevronRight, Play, Pause, 
  Volume2, VolumeX, Download 
} from 'lucide-react';
import { useDebounce } from 'use-debounce';
import { searchTags, getTagWiki, getPostsByTag, getTag, getPostById } from '../lib/danbooruApi';
import { Tag, Post, WikiPage } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';

const isVideo = (ext?: string) => {
  if (!ext) return false;
  return ['mp4', 'webm', 'zip'].includes(ext.toLowerCase());
};

const PostPreview: React.FC<{ id: string }> = ({ id }) => {
  const [post, setPost] = useState<Post | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getPostById(id).then(data => {
      setPost(data);
      setLoading(false);
    });
  }, [id]);

  if (loading) return <span className="text-slate-400 italic">[Loading Post #{id}...]</span>;
  if (!post) return <span className="text-red-400 italic">[Post #{id} not found]</span>;

  const isVid = isVideo(post.file_ext);
  const previewUrl = post.preview_file_url || post.file_url;

  if (!previewUrl) {
    return (
      <a href={`https://danbooru.donmai.us/posts/${id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-slate-400 hover:text-slate-300 hover:underline">
        [Deleted Post #{id}]
        <ExternalLink className="w-3 h-3 inline" />
      </a>
    );
  }

  return (
    <a href={`https://danbooru.donmai.us/posts/${id}`} target="_blank" rel="noopener noreferrer" className="inline-block m-1 border border-slate-700 rounded overflow-hidden hover:border-indigo-500 transition-colors relative group bg-slate-800/50">
      {isVid && !post.preview_file_url ? (
        <video src={post.file_url} className="h-32 w-auto object-cover" autoPlay loop muted playsInline />
      ) : (
        <img src={previewUrl} alt={`Post #${id}`} className="h-32 w-auto object-cover" referrerPolicy="no-referrer" />
      )}
      {(isVid || post.file_ext === 'gif') && (
        <div className="absolute top-1 right-1 bg-black/60 rounded p-1 pointer-events-none">
          <Play className="w-3 h-3 text-white fill-white" />
        </div>
      )}
      <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-xs text-white p-1 truncate opacity-0 group-hover:opacity-100 transition-opacity">
        Post #{id}
      </div>
    </a>
  );
};

const renderDText = (text: string, onTagClick: (tag: string) => void) => {
  if (!text) return null;

  const lines = text.split(/\r?\n/);
  
  let isBold = false;
  let isItalic = false;
  let isUnderline = false;
  let isStrike = false;
  let isSpoiler = false;
  let isQuote = false;

  const renderInline = (inlineText: string, lineKey: number) => {
    const regex = /(\[\[.*?\]\]|"[^"]+":\S+|\[url=.*?\].*?\[\/url\]|\[url\].*?\[\/url\]|\[(?:tag|wiki|artist|copyright|character|general|meta)(?:=.*?)?\].*?\[\/(?:tag|wiki|artist|copyright|character|general|meta)\]|!?(?:post|comment|forum|pool|set|favgroup|user|asset)\s*#\d+|(?:https?:\/\/\S+)|\[b\]|\[\/b\]|\[i\]|\[\/i\]|\[u\]|\[\/u\]|\[s\]|\[\/s\]|\[spoiler\]|\[\/spoiler\]|\[spoilers\]|\[\/spoilers\]|\[quote\]|\[\/quote\]|<br>)/gim;
    const parts = inlineText.split(regex);

    return parts.map((part, i) => {
      if (!part) return null;

      const lowerPart = part.toLowerCase();
      if (lowerPart === '[b]') { isBold = true; return null; }
      if (lowerPart === '[/b]') { isBold = false; return null; }
      if (lowerPart === '[i]') { isItalic = true; return null; }
      if (lowerPart === '[/i]') { isItalic = false; return null; }
      if (lowerPart === '[u]') { isUnderline = true; return null; }
      if (lowerPart === '[/u]') { isUnderline = false; return null; }
      if (lowerPart === '[s]') { isStrike = true; return null; }
      if (lowerPart === '[/s]') { isStrike = false; return null; }
      if (lowerPart === '[spoiler]' || lowerPart === '[spoilers]') { isSpoiler = true; return null; }
      if (lowerPart === '[/spoiler]' || lowerPart === '[/spoilers]') { isSpoiler = false; return null; }
      if (lowerPart === '[quote]') { isQuote = true; return null; }
      if (lowerPart === '[/quote]') { isQuote = false; return null; }
      if (lowerPart === '<br>') { return <br key={i} />; }

      const getClasses = (base: string) => {
        let cls = base;
        if (isBold) cls += ' font-bold text-white';
        if (isItalic) cls += ' italic';
        if (isUnderline) cls += ' underline';
        if (isStrike) cls += ' line-through';
        if (isSpoiler) cls += ' bg-slate-800 text-transparent hover:text-slate-200 transition-colors cursor-help px-1 rounded';
        if (isQuote) cls += ' text-slate-400 italic';
        return cls.trim() || undefined;
      };

      const tagMatch = part.match(/^\[\[(.*?)\]\]$/);
      if (tagMatch) {
        const content = tagMatch[1];
        const [tag, label] = content.includes('|') ? content.split('|') : [content, content];
        return (
          <a 
            key={i} 
            href="#" 
            onClick={(e) => { e.preventDefault(); onTagClick(tag); }}
            className={getClasses("text-indigo-400 hover:text-indigo-300 hover:underline cursor-pointer")}
          >
            {label}
          </a>
        );
      }
      
      const linkMatch = part.match(/^"([^"]+)":(\S+)$/);
      if (linkMatch) {
        const [, label, url] = linkMatch;
        let href = url;
        if (url.startsWith('/')) href = `https://danbooru.donmai.us${url}`;
        else if (!url.startsWith('http')) href = `https://danbooru.donmai.us/${url}`;
        return (
          <a key={i} href={href} target="_blank" rel="noopener noreferrer" className={getClasses("text-indigo-400 hover:text-indigo-300 hover:underline cursor-pointer inline-flex items-center gap-1")}>
            {label}
            <ExternalLink className="w-3 h-3 inline" />
          </a>
        );
      }

      const urlTagMatch = part.match(/^\[url=(.*?)\](.*?)\[\/url\]$/i) || part.match(/^\[url\](.*?)\[\/url\]$/i);
      if (urlTagMatch) {
        const url = urlTagMatch[1];
        const label = urlTagMatch[2] || url;
        let href = url;
        if (url.startsWith('/')) href = `https://danbooru.donmai.us${url}`;
        else if (!url.startsWith('http')) href = `https://danbooru.donmai.us/${url}`;
        return (
          <a key={i} href={href} target="_blank" rel="noopener noreferrer" className={getClasses("text-indigo-400 hover:text-indigo-300 hover:underline cursor-pointer inline-flex items-center gap-1")}>
            {label}
            <ExternalLink className="w-3 h-3 inline" />
          </a>
        );
      }

      const tagTypeMatch = part.match(/^\[(tag|wiki|artist|copyright|character|general|meta)(?:=(.*?))?\](.*?)\[\/\1\]$/i);
      if (tagTypeMatch) {
        const [, type, tagVal, label] = tagTypeMatch;
        const tag = tagVal || label;
        if (type.toLowerCase() === 'wiki') {
          return (
            <a key={i} href={`https://danbooru.donmai.us/wiki_pages/${tag}`} target="_blank" rel="noopener noreferrer" className={getClasses("text-indigo-400 hover:text-indigo-300 hover:underline cursor-pointer inline-flex items-center gap-1")}>
              {label}
              <ExternalLink className="w-3 h-3 inline" />
            </a>
          );
        }
        return (
          <a key={i} href="#" onClick={(e) => { e.preventDefault(); onTagClick(tag); }} className={getClasses("text-indigo-400 hover:text-indigo-300 hover:underline cursor-pointer")}>
            {label}
          </a>
        );
      }

      const refMatch = part.match(/^(!?)(post|comment|forum|pool|set|favgroup|user|asset)\s*#(\d+)$/i);
      if (refMatch) {
        const [, isEmbed, type, id] = refMatch;
        if (isEmbed && type.toLowerCase() === 'post') {
          return <PostPreview key={i} id={id} />;
        }
        const href = `https://danbooru.donmai.us/${type}s/${id}`;
        return (
          <a key={i} href={href} target="_blank" rel="noopener noreferrer" className={getClasses("text-indigo-400 hover:text-indigo-300 hover:underline cursor-pointer inline-flex items-center gap-1")}>
            {isEmbed ? `[Image: ${type} #${id}]` : `${type} #${id}`}
            <ExternalLink className="w-3 h-3 inline" />
          </a>
        );
      }

      if (lowerPart.startsWith('http')) {
        return (
          <a key={i} href={part} target="_blank" rel="noopener noreferrer" className={getClasses("text-indigo-400 hover:text-indigo-300 hover:underline cursor-pointer inline-flex items-center gap-1")}>
            {part.length > 40 ? part.substring(0, 37) + '...' : part}
            <ExternalLink className="w-3 h-3 inline" />
          </a>
        );
      }

      return <span key={i} className={getClasses("")}>{part}</span>;
    });
  };

  return lines.map((line, lineIndex) => {
    const headerMatch = line.match(/^\s*h(\d)(?:#[\w-]+)?\.\s*(.*)$/i);
    if (headerMatch) {
      const level = parseInt(headerMatch[1]);
      const content = headerMatch[2];
      const Tag = `h${level}` as any;
      const fontSize = level === 1 ? 'text-2xl' : level === 2 ? 'text-xl' : level === 3 ? 'text-lg' : 'text-base';
      return (
        <Tag key={lineIndex} className={`${fontSize} text-white font-bold mt-6 mb-3 border-b border-slate-800/50 pb-2`}>
          {renderInline(content, lineIndex)}
        </Tag>
      );
    }

    const listMatch = line.match(/^\s*(\*+)\s*(.*)$/);
    if (listMatch) {
      const depth = listMatch[1].length;
      const content = listMatch[2];
      return (
        <div key={lineIndex} style={{ marginLeft: `${(depth - 1) * 1.5}rem` }} className="flex items-start gap-2 my-1">
          <span className="text-slate-500 mt-1">•</span>
          <div>{renderInline(content, lineIndex)}</div>
        </div>
      );
    }

    const numListMatch = line.match(/^\s*(#+)\s*(.*)$/);
    if (numListMatch) {
      const depth = numListMatch[1].length;
      const content = numListMatch[2];
      return (
        <div key={lineIndex} style={{ marginLeft: `${(depth - 1) * 1.5}rem` }} className="flex items-start gap-2 my-1">
          <span className="text-slate-500 font-mono text-sm mt-0.5">{depth}.</span>
          <div>{renderInline(content, lineIndex)}</div>
        </div>
      );
    }

    const quoteMatch = line.match(/^\s*>\s*(.*)$/);
    if (quoteMatch) {
      const content = quoteMatch[1];
      return (
        <blockquote key={lineIndex} className="border-l-4 border-indigo-500/50 pl-4 py-1 my-2 text-slate-400 bg-slate-800/30 rounded-r-lg">
          {renderInline(content, lineIndex)}
        </blockquote>
      );
    }

    return (
      <div key={lineIndex} className="min-h-[1.5rem] my-1">
        {renderInline(line, lineIndex)}
      </div>
    );
  });
};

const CustomVideoPlayer = ({ src, className, onPlayPause }: { src: string, className?: string, onPlayPause?: (playing: boolean) => void }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isBuffering, setIsBuffering] = useState(false);
  const [progress, setProgress] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const controlsTimeoutRef = useRef<NodeJS.Timeout>();

  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
      onPlayPause?.(!isPlaying);
    }
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
      setProgress((videoRef.current.currentTime / videoRef.current.duration) * 100);
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseFloat(e.target.value);
    setVolume(newVolume);
    if (videoRef.current) {
      videoRef.current.volume = newVolume;
      setIsMuted(newVolume === 0);
    }
  };

  const toggleMute = () => {
    if (videoRef.current) {
      const newMuted = !isMuted;
      videoRef.current.muted = newMuted;
      setIsMuted(newMuted);
      if (newMuted) {
        setVolume(0);
      } else {
        setVolume(1);
        videoRef.current.volume = 1;
      }
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTime = (parseFloat(e.target.value) / 100) * duration;
    if (videoRef.current) {
      videoRef.current.currentTime = newTime;
      setCurrentTime(newTime);
      setProgress(parseFloat(e.target.value));
    }
  };

  const formatTime = (time: number) => {
    if (isNaN(time)) return "0:00";
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const handleMouseMove = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying) setShowControls(false);
    }, 2000);
  };

  const handleMouseLeave = () => {
    if (isPlaying) setShowControls(false);
  };

  return (
    <div 
      className="relative w-full h-full flex items-center justify-center group"
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <video
        ref={videoRef}
        src={src}
        autoPlay
        loop
        playsInline
        className={className}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onWaiting={() => setIsBuffering(true)}
        onPlaying={() => { setIsBuffering(false); setIsPlaying(true); onPlayPause?.(true); }}
        onPlay={() => { setIsPlaying(true); onPlayPause?.(true); }}
        onPause={() => { setIsPlaying(false); onPlayPause?.(false); }}
        onClick={(e) => {
          const video = e.currentTarget;
          const rect = video.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;
          
          if (y > rect.height - 50) return;
          
          if (x > rect.width * 0.7) {
            video.currentTime = Math.min(video.duration || 0, video.currentTime + 5);
          } else if (x < rect.width * 0.3) {
            video.currentTime = Math.max(0, video.currentTime - 5);
          } else {
            togglePlay();
          }
        }}
      />
      
      {isBuffering && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <Loader2 className="w-12 h-12 text-white animate-spin opacity-75" />
        </div>
      )}

      <div 
        className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-4 transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-2">
          <span className="text-white text-xs font-mono w-10 text-right">{formatTime(currentTime)}</span>
          <input
            type="range"
            min="0"
            max="100"
            value={progress || 0}
            onChange={handleSeek}
            className="flex-1 h-1.5 bg-white/30 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full"
          />
          <span className="text-white text-xs font-mono w-10">{formatTime(duration)}</span>
        </div>
        
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={togglePlay} className="text-white hover:text-indigo-400 transition-colors">
              {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current" />}
            </button>
            
            <div className="flex items-center gap-2">
              <button onClick={toggleMute} className="text-white hover:text-indigo-400 transition-colors">
                {isMuted || volume === 0 ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={isMuted ? 0 : volume}
                onChange={handleVolumeChange}
                className="w-20 transition-all duration-300 h-1.5 bg-white/30 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const CATEGORY_COLORS: Record<number, { bg: string, text: string, icon: React.ReactNode }> = {
  0: { bg: 'bg-blue-500/20', text: 'text-blue-300', icon: <Hash className="w-4 h-4" /> }, // General
  1: { bg: 'bg-red-500/20', text: 'text-red-300', icon: <User className="w-4 h-4" /> }, // Artist
  3: { bg: 'bg-purple-500/20', text: 'text-purple-300', icon: <Copyright className="w-4 h-4" /> }, // Copyright
  4: { bg: 'bg-green-500/20', text: 'text-green-300', icon: <User className="w-4 h-4" /> }, // Character
  5: { bg: 'bg-orange-500/20', text: 'text-orange-300', icon: <TagIcon className="w-4 h-4" /> }, // Meta
};

const CATEGORY_NAMES: Record<number, string> = {
  0: 'General',
  1: 'Artist',
  3: 'Copyright',
  4: 'Character',
  5: 'Meta',
};

const RunningLines = () => {
  return (
    <div 
      className="absolute -inset-[2px] pointer-events-none z-0 rounded-2xl overflow-hidden"
      style={{
        WebkitMaskImage: 'linear-gradient(to right, black 35%, transparent 45% 55%, black 65%)',
        maskImage: 'linear-gradient(to right, black 35%, transparent 45% 55%, black 65%)'
      }}
    >
      <div 
        className="absolute top-[-150%] left-[-150%] w-[400%] h-[400%] animate-rotateGlow"
        style={{
          background: 'conic-gradient(from 0deg, transparent 20%, rgba(255, 0, 0, 0.8) 25%, transparent 30%, transparent 70%, rgba(0, 100, 255, 0.8) 75%, transparent 80%)'
        }}
      />
    </div>
  );
};

export const DanbooruSearch: React.FC = () => {
  const [hasSearched, setHasSearched] = useState(false);
  const [queryTags, setQueryTags] = useState<string[]>([]);
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const [debouncedWord] = useDebounce(inputValue, 300);
  const [suggestions, setSuggestions] = useState<Tag[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  
  const [selectedTag, setSelectedTag] = useState<Tag | null>(null);
  const [wiki, setWiki] = useState<WikiPage | null>(null);
  const [isWikiExpanded, setIsWikiExpanded] = useState(false);
  const [posts, setPosts] = useState<Post[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  
  const [selectedImagePost, setSelectedImagePost] = useState<Post | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [postsPerPage, setPostsPerPage] = useState(50);
  const [pageInput, setPageInput] = useState('1');
  const [showUnderscores, setShowUnderscores] = useState(() => {
    const saved = localStorage.getItem('showUnderscores');
    return saved !== null ? JSON.parse(saved) : false;
  });
  const [copiedAll, setCopiedAll] = useState(false);
  const [copiedTag, setCopiedTag] = useState<string | null>(null);
  const [downloadingIds, setDownloadingIds] = useState<Set<number>>(new Set());
  
  const [safeMode, setSafeMode] = useState(() => {
    const saved = localStorage.getItem('safeMode');
    return saved !== null ? JSON.parse(saved) : true;
  });

  interface HistoryState {
    queryTags: string[];
    currentPage: number;
    postsPerPage: number;
    safeMode: boolean;
    selectedTag: Tag | null;
    hasSearched: boolean;
  }
  const historyRef = useRef<HistoryState[]>([]);
  const historyIndexRef = useRef<number>(-1);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const isUndoRedoAction = useRef(false);

  const updateUndoRedoState = () => {
    setCanUndo(historyIndexRef.current > 0);
    setCanRedo(historyIndexRef.current < historyRef.current.length - 1);
  };

  useEffect(() => {
    if (isUndoRedoAction.current) {
      isUndoRedoAction.current = false;
      return;
    }
    
    const currentState: HistoryState = {
      queryTags,
      currentPage,
      postsPerPage,
      safeMode,
      selectedTag,
      hasSearched
    };
    
    const currentIndex = historyIndexRef.current;
    const last = historyRef.current[currentIndex];
    
    if (last && 
        JSON.stringify(last.queryTags) === JSON.stringify(currentState.queryTags) &&
        last.currentPage === currentState.currentPage &&
        last.postsPerPage === currentState.postsPerPage &&
        last.safeMode === currentState.safeMode &&
        last.selectedTag?.name === currentState.selectedTag?.name &&
        last.hasSearched === currentState.hasSearched) {
      return;
    }
    
    const newHistory = historyRef.current.slice(0, currentIndex + 1);
    newHistory.push(currentState);
    historyRef.current = newHistory;
    historyIndexRef.current = newHistory.length - 1;
    updateUndoRedoState();
  }, [queryTags, currentPage, postsPerPage, safeMode, selectedTag, hasSearched]);

  const handleUndo = () => {
    if (historyIndexRef.current > 0) {
      isUndoRedoAction.current = true;
      historyIndexRef.current -= 1;
      const prevState = historyRef.current[historyIndexRef.current];
      
      setQueryTags(prevState.queryTags);
      setCurrentPage(prevState.currentPage);
      setPostsPerPage(prevState.postsPerPage);
      setSafeMode(prevState.safeMode);
      setSelectedTag(prevState.selectedTag);
      setHasSearched(prevState.hasSearched);
      
      updateUndoRedoState();
    }
  };

  const handleRedo = () => {
    if (historyIndexRef.current < historyRef.current.length - 1) {
      isUndoRedoAction.current = true;
      historyIndexRef.current += 1;
      const nextState = historyRef.current[historyIndexRef.current];
      
      setQueryTags(nextState.queryTags);
      setCurrentPage(nextState.currentPage);
      setPostsPerPage(nextState.postsPerPage);
      setSafeMode(nextState.safeMode);
      setSelectedTag(nextState.selectedTag);
      setHasSearched(nextState.hasSearched);
      
      updateUndoRedoState();
    }
  };

  useEffect(() => {
    const handleMouseUp = (e: MouseEvent) => {
      if (e.button === 3) {
        e.preventDefault();
        handleUndo();
      } else if (e.button === 4) {
        e.preventDefault();
        handleRedo();
      }
    };
    
    const handleMouseDown = (e: MouseEvent) => {
      if (e.button === 3 || e.button === 4) {
        e.preventDefault();
      }
    };

    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('mousedown', handleMouseDown);
    return () => {
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('mousedown', handleMouseDown);
    };
  }, []);

  const handleDownload = async (post: Post) => {
    if (!post || downloadingIds.has(post.id)) return;
    setDownloadingIds(prev => new Set(prev).add(post.id));
    try {
      let url = post.file_url;
      try {
        const fullPost = await getPostById(post.id.toString());
        if (fullPost && fullPost.file_url) {
          url = fullPost.file_url;
        }
      } catch (err) {
        console.warn("Failed to fetch full post details, falling back to cached URLs", err);
      }

      if (!url) {
        url = post.large_file_url;
      }
      
      if (!url) throw new Error("No URL available");
      
      const response = await fetch(url);
      if (!response.ok) throw new Error("Network response was not ok");
      
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = blobUrl;
      
      let filename = `danbooru_${post.id}.${post.file_ext}`;
      if (url.includes('url=')) {
        const decoded = decodeURIComponent(url.split('url=')[1]);
        const extracted = decoded.split('/').pop()?.split('?')[0];
        if (extracted) filename = extracted;
      } else {
        const extracted = url.split('/').pop()?.split('?')[0];
        if (extracted) filename = extracted;
      }
      
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      
      window.URL.revokeObjectURL(blobUrl);
      document.body.removeChild(a);
    } catch (error) {
      console.error("Download failed:", error);
      alert("Failed to download image.");
    } finally {
      setDownloadingIds(prev => {
        const next = new Set(prev);
        next.delete(post.id);
        return next;
      });
    }
  };

  const maxPages = selectedTag ? Math.ceil(selectedTag.post_count / 50) : 0;

  const dropdownRef = useRef<HTMLDivElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const skipNextDropdownRef = useRef(false);
  
  useEffect(() => {
    setSelectedIndex(-1);
  }, [suggestions, showDropdown]);

  useEffect(() => {
    if (selectedIndex >= 0 && suggestionsRef.current) {
      const selectedElement = suggestionsRef.current.children[selectedIndex] as HTMLElement;
      if (selectedElement) {
        selectedElement.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex]);

  useEffect(() => {
    localStorage.setItem('showUnderscores', JSON.stringify(showUnderscores));
  }, [showUnderscores]);

  useEffect(() => {
    localStorage.setItem('safeMode', JSON.stringify(safeMode));
  }, [safeMode]);

  useEffect(() => {
    setPageInput(currentPage.toString());
  }, [currentPage]);

  const formatTag = (tag: string) => showUnderscores ? tag : tag.replace(/_/g, ' ');

  const getOrderedTagsWithCategory = (post: Post) => {
    const parseTags = (str: string, category: number) => 
      (str ? str.split(' ').filter(Boolean) : []).map(tag => ({ tag, category }));
    
    return [
      ...parseTags(post.tag_string_artist, 1),
      ...parseTags(post.tag_string_copyright, 3),
      ...parseTags(post.tag_string_character, 4),
      ...parseTags(post.tag_string_general, 0),
      ...parseTags(post.tag_string_meta, 5),
    ];
  };

  const handleCopyAllTags = (post: Post) => {
    const orderedTags = getOrderedTagsWithCategory(post)
      .filter(t => t.category !== 5)
      .map(t => t.tag);
    const formattedTags = orderedTags.map(formatTag).join(', ');
    navigator.clipboard.writeText(formattedTags);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  };

  const handleCopySingleTag = (tag: string) => {
    navigator.clipboard.writeText(formatTag(tag));
    setCopiedTag(tag);
    setTimeout(() => setCopiedTag(null), 2000);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!selectedImagePost) return;
      const target = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'VIDEO'].includes(target.tagName)) return;

      const currentIndex = posts.findIndex(p => p.id === selectedImagePost.id);
      if (e.key === 'ArrowLeft' && currentIndex > 0) {
        setSelectedImagePost(posts[currentIndex - 1]);
      } else if (e.key === 'ArrowRight' && currentIndex < posts.length - 1) {
        setSelectedImagePost(posts[currentIndex + 1]);
      } else if (e.key === 'Escape') {
        setSelectedImagePost(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedImagePost, posts]);

  useEffect(() => {
    const fetchSuggestions = async () => {
      if (!debouncedWord.trim() || debouncedWord.trim() === '-') {
        setSuggestions([]);
        return;
      }
      setIsSearching(true);
      const searchTerm = debouncedWord.startsWith('-') ? debouncedWord.substring(1) : debouncedWord;
      const results = await searchTags(searchTerm);
      setSuggestions(results);
      setIsSearching(false);
      
      if (skipNextDropdownRef.current) {
        skipNextDropdownRef.current = false;
      } else {
        setShowDropdown(true);
      }
    };
    fetchSuggestions();
  }, [debouncedWord]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleTagClick = (tagName: string) => {
    const formattedTag = tagName.toLowerCase().replace(/ /g, '_');
    handleSelectTag({ 
      id: 0, 
      name: formattedTag, 
      category: 0, 
      post_count: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
  };

  const handleSearchSubmit = async () => {
    const finalTags = [...queryTags];
    if (inputValue.trim()) {
      finalTags.push(inputValue.trim());
      setQueryTags(finalTags);
      setInputValue('');
    }
    
    const formattedQuery = finalTags.join(' ').toLowerCase();
    if (!formattedQuery) return;
    
    setHasSearched(true);
    
    if (finalTags.length === 1) {
      handleTagClick(finalTags[0]);
      return;
    }
    
    skipNextDropdownRef.current = true;
    setShowDropdown(false);
    
    const dummyTag: Tag = {
      id: 0,
      name: formattedQuery,
      category: 0,
      post_count: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    setSelectedTag(dummyTag);
    setCurrentPage(1);
    setIsWikiExpanded(false);
    setIsLoadingDetails(true);
    setWiki(null);
    
    try {
      const { posts: postsData, hasMore } = await getPostsByTag(formattedQuery, safeMode, 1, postsPerPage);
      setHasMore(hasMore);
      setPosts(postsData.filter(p => p.file_url || p.preview_file_url));
    } catch (error) {
      console.error("Failed to fetch posts for multi-tag search", error);
    } finally {
      setIsLoadingDetails(false);
    }
  };

  const handleSuggestionClick = (tag: Tag) => {
    skipNextDropdownRef.current = true;
    const isNegated = inputValue.startsWith('-');
    const finalTagName = isNegated ? `-${tag.name}` : tag.name;
    setQueryTags([...queryTags, finalTagName]);
    setInputValue('');
    setShowDropdown(false);
    setTimeout(() => {
      if (inputRef.current) inputRef.current.focus();
    }, 0);
  };

  const handleSelectTag = async (tag: Tag) => {
    skipNextDropdownRef.current = true;
    setHasSearched(true);
    setQueryTags([tag.name]);
    setInputValue('');
    setShowDropdown(false);
    setSelectedTag(tag);
    setCurrentPage(1);
    setIsWikiExpanded(false);
    setIsLoadingDetails(true);
    
    try {
      const [wikiData, { posts: postsData, hasMore }, tagDetails] = await Promise.all([
        getTagWiki(tag.name),
        getPostsByTag(tag.name, safeMode, 1, postsPerPage),
        getTag(tag.name)
      ]);
      setWiki(wikiData);
      setHasMore(hasMore);
      setPosts(postsData.filter(p => p.file_url || p.preview_file_url));
      if (tagDetails) setSelectedTag(tagDetails);
    } catch (error) {
      console.error('Error fetching details:', error);
    } finally {
      setIsLoadingDetails(false);
    }
  };

  const handlePageChange = (newPage: number) => {
    if (newPage === currentPage) return;
    setCurrentPage(newPage);
  };

  const parseRelatedTags = (str?: string) => {
    if (!str) return [];
    const parts = str.split(' ');
    const tags: { tag: string, count: number }[] = [];
    for (let i = 0; i < parts.length; i += 2) {
      if (parts[i] && parts[i+1]) {
        tags.push({ tag: parts[i], count: parseInt(parts[i+1]) });
      }
    }
    return tags.filter(t => t.tag !== selectedTag?.name).sort((a, b) => b.count - a.count);
  };

  useEffect(() => {
    if (selectedTag) {
      setIsLoadingDetails(true);
      getPostsByTag(selectedTag.name, safeMode, currentPage, postsPerPage).then(({ posts: postsData, hasMore }) => {
        setHasMore(hasMore);
        setPosts(postsData.filter(p => p.file_url || p.preview_file_url));
        setIsLoadingDetails(false);
      });
    }
  }, [safeMode, currentPage, postsPerPage, selectedTag]);

  return (
    <div className={`w-full flex flex-col transition-all duration-700 ease-in-out ${!hasSearched ? 'flex-1 justify-center' : 'min-h-[600px]'}`}>
      <motion.div 
        layout
        transition={{ duration: 0.7, ease: [0.4, 0, 0.2, 1] }}
        className={`w-full flex flex-col items-center gap-4 mb-8 mx-auto sticky top-4 z-50 transition-all duration-500`} 
        style={{ maxWidth: queryTags.length === 0 ? '56rem' : `min(95%, ${56 + queryTags.length * 8}rem)` }}
        ref={dropdownRef}
      >
        <div className="relative w-full flex items-center gap-2">
          {hasSearched && (
            <button 
              onClick={handleUndo} 
              disabled={!canUndo}
              className="p-3 bg-black/80 backdrop-blur-2xl border border-white/10 rounded-2xl text-white disabled:opacity-50 hover:bg-black transition-colors shrink-0"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          )}
          <div className="relative flex-1">
            <form 
              className="relative bg-black/80 backdrop-blur-2xl p-1.5 rounded-2xl border border-white/10 shadow-2xl group flex flex-col"
              onSubmit={(e) => {
                e.preventDefault();
                handleSearchSubmit();
              }}
            >
            <div 
              className="w-full bg-transparent rounded-xl py-1 pl-3 pr-1 transition-all flex flex-wrap items-center gap-2 min-h-[52px] cursor-text relative z-10"
              onClick={() => inputRef.current?.focus()}
            >
              {queryTags.map((tag, index) => {
                const isNegated = tag.startsWith('-');
                return (
                  <span key={index} className={`px-2.5 py-1 rounded-lg inline-flex items-center gap-1.5 text-sm font-medium border ${isNegated ? 'bg-red-500/20 text-red-200 border-red-500/30' : 'bg-white/10 text-white border-white/10'}`}>
                    {tag}
                    <button 
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        const newTags = queryTags.filter((_, i) => i !== index);
                        setQueryTags(newTags);
                        if (newTags.length === 0 && !inputValue.trim()) {
                          setSelectedTag(null);
                          setPosts([]);
                          setWiki(null);
                          setHasSearched(false);
                        }
                      }}
                      className={`rounded-full p-0.5 transition-colors ${isNegated ? 'hover:bg-red-500/30 hover:text-red-100' : 'hover:bg-white/20 hover:text-white'}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                );
              })}
              
              <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val.includes(' ')) {
                    const parts = val.split(/\s+/);
                    const newInputValue = parts.pop() || '';
                    const newTags = parts.filter(Boolean);
                    if (newTags.length > 0) setQueryTags([...queryTags, ...newTags]);
                    setInputValue(newInputValue);
                  } else {
                    setInputValue(val);
                  }
                  setShowDropdown(true);
                }}
                onKeyDown={(e) => {
                  if (showDropdown && suggestions.length > 0) {
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      setSelectedIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : prev));
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : -1));
                    } else if (e.key === 'Enter' && selectedIndex >= 0) {
                      e.preventDefault();
                      handleSuggestionClick(suggestions[selectedIndex]);
                    } else if (e.key === 'Escape') {
                      setShowDropdown(false);
                    }
                  }
                  if (e.key === 'Backspace' && !inputValue && queryTags.length > 0) {
                    e.preventDefault();
                    const newTags = [...queryTags];
                    const removed = newTags.pop();
                    setQueryTags(newTags);
                    setInputValue(removed || '');
                  }
                }}
                placeholder={queryTags.length === 0 ? "Search tags (e.g., hatsune_miku)..." : ""}
                className="flex-1 min-w-[120px] w-0 bg-transparent text-white placeholder-zinc-500 focus:outline-none text-lg py-1"
              />

              <div className="flex items-center gap-2 ml-auto z-20" onClick={(e) => e.stopPropagation()}>
                {isSearching && <Loader2 className="w-5 h-5 text-white/50 animate-spin" />}
                
                <div className="flex items-center gap-1.5 px-2 py-1.5 bg-black/40 border border-white/10 rounded-xl hidden sm:flex">
                  <input 
                    type="number" 
                    min="1" 
                    max="200" 
                    value={postsPerPage} 
                    onChange={(e) => {
                      setPostsPerPage(Number(e.target.value) || 50);
                      setCurrentPage(1);
                    }}
                    className="w-10 bg-transparent text-white text-sm text-center focus:outline-none font-mono [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setSafeMode(!safeMode);
                    setCurrentPage(1);
                  }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-medium transition-all duration-300 whitespace-nowrap border ${
                    safeMode 
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20 hover:border-emerald-500/30' 
                      : 'bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/20 hover:border-red-500/30'
                  }`}
                >
                  {safeMode ? <Shield className="w-4 h-4" /> : <ShieldAlert className="w-4 h-4" />}
                  <span className="hidden sm:inline text-sm">{safeMode ? 'Safe' : 'NSFW'}</span>
                </button>
                <button type="submit" className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl transition-colors border border-white/10 text-xs font-semibold tracking-wide">
                  SEARCH
                </button>
              </div>
            </div>
            </form>

            <AnimatePresence>
              {showDropdown && suggestions.length > 0 && (
                <motion.div
                  ref={suggestionsRef}
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="absolute top-full left-0 right-0 mt-3 bg-black/80 backdrop-blur-2xl rounded-2xl shadow-2xl border border-white/10 overflow-hidden z-50 max-h-[40vh] overflow-y-auto"
                >
                {suggestions.map((tag, index) => {
                  const color = CATEGORY_COLORS[tag.category] || CATEGORY_COLORS[0];
                  const isSelected = index === selectedIndex;
                  return (
                    <button
                      key={tag.id}
                      onClick={() => handleSuggestionClick(tag)}
                      onMouseEnter={() => setSelectedIndex(index)}
                      className={`w-full text-left px-5 py-4 border-b border-white/5 last:border-0 flex items-center justify-between group transition-colors ${
                        isSelected ? 'bg-white/10' : 'hover:bg-white/10'
                      }`}
                    >
                      <div className="flex items-center gap-4">
                        <span className={`p-2 rounded-xl ${color.bg} ${color.text}`}>
                          {color.icon}
                        </span>
                        <span className={`font-medium text-lg ${isSelected ? 'text-white' : 'text-slate-200'}`}>
                          {tag.name.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <span className="text-sm font-medium text-slate-400 bg-black/20 px-3 py-1.5 rounded-full border border-white/10">
                        {tag.post_count.toLocaleString()} posts
                      </span>
                    </button>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        {hasSearched && (
          <button 
            onClick={handleRedo} 
            disabled={!canRedo}
            className="p-3 bg-black/80 backdrop-blur-2xl border border-white/10 rounded-2xl text-white disabled:opacity-50 hover:bg-black transition-colors shrink-0"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        )}
      </div>
    </motion.div>

      <div className="flex-1">
        <AnimatePresence mode="wait">
          {isLoadingDetails ? (
            <motion.div 
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center py-32"
            >
              <Loader2 className="w-12 h-12 text-indigo-500 animate-spin mb-6" />
              <p className="text-slate-400 font-medium animate-pulse text-lg">Fetching tag details and images...</p>
            </motion.div>
          ) : selectedTag ? (
            <motion.div 
              key="content"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="grid grid-cols-1 lg:grid-cols-12 gap-8"
            >
              <div className="lg:col-span-4 xl:col-span-3 space-y-6">
                <div className="bg-white/5 backdrop-blur-xl rounded-2xl p-6 shadow-2xl border border-white/10">
                  <h2 className="text-2xl font-bold text-white mb-2 capitalize break-words">
                    {selectedTag.name.replace(/_/g, ' ')}
                  </h2>
                  
                  {wiki?.other_names && wiki.other_names.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-4">
                      {wiki.other_names.filter(name => /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\uFAFF\uFF66-\uFF9F]/.test(name)).map((name, i) => (
                        <div key={i} className="flex items-center gap-1.5 bg-white/5 px-2.5 py-1 rounded-lg border border-white/10">
                          <a 
                            href={`https://www.pixiv.net/tags/${encodeURIComponent(name)}/artworks`} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-sm text-slate-300 hover:text-indigo-400 transition-colors flex items-center gap-1"
                          >
                            {name}
                            <ExternalLink className="w-3 h-3" />
                          </a>
                          <button 
                            onClick={() => {
                              navigator.clipboard.writeText(name);
                              setCopiedTag(name);
                              setTimeout(() => setCopiedTag(null), 2000);
                            }}
                            className="text-slate-500 hover:text-slate-300 transition-colors p-0.5"
                            title="Copy name"
                          >
                            {copiedTag === name ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2 mb-6">
                    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium ${CATEGORY_COLORS[selectedTag.category]?.bg || CATEGORY_COLORS[0].bg} ${CATEGORY_COLORS[selectedTag.category]?.text || CATEGORY_COLORS[0].text}`}>
                      {CATEGORY_COLORS[selectedTag.category]?.icon || CATEGORY_COLORS[0].icon}
                      {CATEGORY_NAMES[selectedTag.category] || 'General'}
                    </span>
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium bg-white/5 border border-white/10 text-slate-300">
                      <ImageIcon className="w-4 h-4" />
                      {selectedTag.post_count.toLocaleString()} posts
                    </span>
                  </div>

                  <div className="pt-6 border-t border-white/10">
                    <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider mb-3 flex items-center gap-2">
                      Wiki Information
                    </h3>
                    {wiki ? (
                      <div className="prose prose-sm prose-invert max-w-none">
                        <div className={`whitespace-pre-wrap text-slate-300 leading-relaxed break-words ${!isWikiExpanded && wiki.body && wiki.body.length > 400 ? 'max-h-64 overflow-hidden relative' : ''}`}>
                          {renderDText(wiki.body, handleTagClick) || 'No detailed description available.'}
                          {!isWikiExpanded && wiki.body && wiki.body.length > 400 && (
                            <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-slate-900 to-transparent pointer-events-none" />
                          )}
                        </div>
                        {wiki.body && wiki.body.length > 400 && (
                          <button onClick={() => setIsWikiExpanded(!isWikiExpanded)} className="mt-2 text-indigo-400 hover:text-indigo-300 text-sm font-medium">
                            {isWikiExpanded ? 'Show Less' : 'Read More'}
                          </button>
                        )}
                      </div>
                    ) : (
                      <p className="text-slate-500 italic text-sm">No wiki page exists.</p>
                    )}
                  </div>

                  {selectedTag.related_tags && (
                    <div className="mt-6 pt-6 border-t border-white/10">
                      <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider mb-3 flex items-center gap-2">
                        <TagIcon className="w-4 h-4 text-indigo-400" />
                        Related Tags
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        {parseRelatedTags(selectedTag.related_tags).slice(0, 15).map((t, i) => (
                          <button
                            key={i}
                            onClick={() => handleTagClick(t.tag)}
                            className="px-3 py-1 bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white rounded-lg text-xs font-medium transition-colors border border-white/10"
                          >
                            {formatTag(t.tag)}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="lg:col-span-8 xl:col-span-9">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-xl font-bold text-white flex items-center gap-2">
                    <ImageIcon className="w-5 h-5 text-indigo-400" />
                    Posts
                  </h3>
                  <span className="text-sm text-slate-400">Showing {posts.length} posts</span>
                </div>

                {posts.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
                    {posts.map((post) => (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        key={post.id}
                        className="relative group rounded-xl overflow-hidden bg-white/5 border border-white/10 aspect-[3/4]"
                      >
                        <div 
                          onClick={() => setSelectedImagePost(post)}
                          className="w-full h-full cursor-pointer"
                        >
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDownload(post);
                            }}
                            disabled={downloadingIds.has(post.id)}
                            className="absolute top-2 left-2 z-20 p-2 bg-black/60 backdrop-blur-md text-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity hover:bg-indigo-600 border border-white/10"
                          >
                            {downloadingIds.has(post.id) ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                          </button>

                          {isVideo(post.file_ext) && !post.preview_file_url ? (
                            <video src={post.large_file_url || post.file_url} autoPlay loop muted playsInline className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
                          ) : (
                            <img src={post.preview_file_url || post.large_file_url || post.file_url} alt={`Post ${post.id}`} loading="lazy" referrerPolicy="no-referrer" className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
                          )}
                          
                          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-4">
                            <div className="flex items-center justify-between text-white">
                              <span className="text-xs font-medium bg-black/60 px-2 py-1 rounded-md">Score: {post.score}</span>
                              <span className="text-xs font-medium bg-black/60 px-2 py-1 rounded-md uppercase">{post.rating === 's' || post.rating === 'g' ? 'Safe' : 'NSFW'}</span>
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                ) : (
                  <div className="bg-white/5 backdrop-blur-xl rounded-2xl p-12 text-center border border-white/10 shadow-2xl">
                    <ImageIcon className="w-12 h-12 text-slate-500 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-white mb-1">No images found</h3>
                    <p className="text-slate-400">{safeMode ? "Try turning off Safe Mode." : "No images available."}</p>
                  </div>
                )}

                {(posts.length > 0 || currentPage > 1 || hasMore) && (
                  <div className="fixed bottom-4 left-1/2 -translate-x-1/2 flex items-center justify-center gap-3 bg-black/80 backdrop-blur-xl p-2 rounded-2xl border border-white/10 shadow-2xl z-50">
                    <button onClick={() => handlePageChange(Math.max(1, currentPage - 1))} disabled={currentPage === 1} className="p-2.5 bg-white/10 text-white rounded-xl disabled:opacity-50 hover:bg-white/20 transition-colors">
                      <ChevronLeft className="w-5 h-5" />
                    </button>
                    <div className="flex items-center gap-2 px-2">
                      <span className="text-slate-300 text-sm font-medium">Page</span>
                      <input
                        type="text"
                        value={pageInput}
                        onChange={(e) => setPageInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            const newPage = parseInt(pageInput);
                            if (!isNaN(newPage) && newPage > 0) handlePageChange(newPage);
                            else setPageInput(currentPage.toString());
                          }
                        }}
                        className="w-12 py-1 bg-white/10 border border-white/20 text-white text-center rounded-lg focus:outline-none focus:border-indigo-500 font-mono text-sm"
                      />
                      {maxPages > 0 && <span className="text-slate-300 text-sm font-medium">of {maxPages}</span>}
                    </div>
                    <button onClick={() => handlePageChange(currentPage + 1)} disabled={!hasMore} className="p-2.5 bg-white/10 text-white rounded-xl disabled:opacity-50 hover:bg-white/20 transition-colors">
                      <ChevronRight className="w-5 h-5" />
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          ) : (
            null
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {selectedImagePost && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-sm" 
            onClick={() => setSelectedImagePost(null)}
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-slate-950/90 backdrop-blur-2xl rounded-2xl max-w-7xl w-full max-h-[90vh] overflow-hidden flex flex-col md:flex-row shadow-2xl border border-white/10" 
              onClick={e => e.stopPropagation()}
            >
              <div className="w-full md:w-2/3 bg-black flex items-center justify-center p-4 relative group">
                {posts.findIndex(p => p.id === selectedImagePost.id) > 0 && (
                  <button onClick={(e) => { e.stopPropagation(); setSelectedImagePost(posts[posts.findIndex(p => p.id === selectedImagePost.id) - 1]); }} className="absolute left-4 top-1/2 -translate-y-1/2 p-2 bg-black/50 hover:bg-black/80 text-white rounded-full backdrop-blur-sm transition-colors z-10">
                    <ChevronLeft className="w-6 h-6" />
                  </button>
                )}
                {isVideo(selectedImagePost.file_ext) ? (
                  <CustomVideoPlayer src={selectedImagePost.large_file_url || selectedImagePost.file_url} className="max-w-full max-h-[40vh] md:max-h-[85vh] object-contain" />
                ) : (
                  <TransformWrapper
                    initialScale={1}
                    minScale={0.5}
                    maxScale={8}
                    centerOnInit
                    wheel={{ step: 0.1 }}
                  >
                    <TransformComponent wrapperClass="w-full h-full flex items-center justify-center" contentClass="w-full h-full flex items-center justify-center" wrapperStyle={{ width: '100%', height: '100%' }} contentStyle={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <img src={selectedImagePost.large_file_url || selectedImagePost.file_url || selectedImagePost.preview_file_url} alt={`Post ${selectedImagePost.id}`} referrerPolicy="no-referrer" className="max-w-full max-h-[40vh] md:max-h-[85vh] object-contain cursor-grab active:cursor-grabbing" />
                    </TransformComponent>
                  </TransformWrapper>
                )}
                {posts.findIndex(p => p.id === selectedImagePost.id) < posts.length - 1 && (
                  <button onClick={(e) => { e.stopPropagation(); setSelectedImagePost(posts[posts.findIndex(p => p.id === selectedImagePost.id) + 1]); }} className="absolute right-4 top-1/2 -translate-y-1/2 p-2 bg-black/50 hover:bg-black/80 text-white rounded-full backdrop-blur-sm transition-colors z-10">
                    <ChevronRight className="w-6 h-6" />
                  </button>
                )}
              </div>
              
              <div className="w-full md:w-1/3 p-6 flex flex-col max-h-[50vh] md:max-h-[90vh]">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xl font-bold text-white flex items-center gap-2">
                    <TagIcon className="w-5 h-5 text-indigo-400" />
                    Post Tags
                  </h3>
                  <button onClick={() => setSelectedImagePost(null)} className="p-2 hover:bg-white/10 rounded-full text-slate-400 hover:text-white transition-colors">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                
                <div className="flex items-center justify-between mb-4 bg-white/5 p-3 rounded-xl border border-white/10">
                  <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-slate-300">
                    <input type="checkbox" checked={showUnderscores} onChange={(e) => setShowUnderscores(e.target.checked)} className="rounded border-white/20 text-indigo-500 focus:ring-indigo-500/50 bg-white/10 w-4 h-4" />
                    Show Underscores
                  </label>
                  <button onClick={() => handleCopyAllTags(selectedImagePost)} className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-500/20 text-indigo-400 hover:bg-indigo-500/30 rounded-lg text-sm font-medium transition-colors">
                    {copiedAll ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    {copiedAll ? 'Copied!' : 'Copy Tags'}
                  </button>
                </div>
                
                <div className="flex-1 overflow-y-auto pr-2 pb-4 custom-scrollbar">
                  <div className="flex flex-wrap gap-2">
                    {getOrderedTagsWithCategory(selectedImagePost).map((t, i) => {
                      const color = CATEGORY_COLORS[t.category] || CATEGORY_COLORS[0];
                      const isCopied = copiedTag === t.tag;
                      return (
                        <button 
                          key={i} 
                          onClick={() => handleCopySingleTag(t.tag)}
                          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all border ${color.bg} ${color.text} border-transparent hover:border-current flex items-center gap-2`}
                        >
                          {formatTag(t.tag)}
                          {isCopied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3 opacity-0 group-hover:opacity-100" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
                
                <div className="mt-4 pt-4 border-t border-white/10 text-sm text-slate-300 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500">ID</span>
                    <span className="font-mono">{selectedImagePost.id}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500">Date</span>
                    <span>{new Date(selectedImagePost.created_at).toLocaleDateString()}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500">Size</span>
                    <span>{selectedImagePost.image_width}x{selectedImagePost.image_height} {selectedImagePost.file_size ? `(${(selectedImagePost.file_size / 1024 / 1024).toFixed(2)} MB)` : ''}</span>
                  </div>
                  {selectedImagePost.source && (
                    <div className="flex justify-between items-center gap-4">
                      <span className="text-slate-500 shrink-0">Source</span>
                      <a href={selectedImagePost.source} target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline truncate text-right">
                        {selectedImagePost.source}
                      </a>
                    </div>
                  )}
                </div>

                <div className="mt-4 pt-4 border-t border-white/10">
                  <a href={`https://danbooru.donmai.us/posts/${selectedImagePost.id}`} target="_blank" rel="noopener noreferrer" className="w-full flex items-center justify-center gap-2 py-3 bg-white/5 hover:bg-white/10 text-white rounded-xl transition-colors font-medium border border-white/5">
                    <ExternalLink className="w-4 h-4" />
                    View Original on Danbooru
                  </a>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
