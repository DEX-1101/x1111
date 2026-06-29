import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Loader2, Copy, Check, Undo2, Redo2, RefreshCw, Database } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export const AdetailerEditor: React.FC = () => {
    const [inputPrompt, setInputPrompt] = useState('');
    const [outputPrompt, setOutputPrompt] = useState('');
    const [faceTags, setFaceTags] = useState<Set<string>>(new Set());
    const [isLoadingTags, setIsLoadingTags] = useState(true);
    const [copied, setCopied] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);

    const inputRef = useRef<HTMLTextAreaElement>(null);

    // Robust History state
    const [history, setHistory] = useState({
        past: [] as string[],
        present: '',
        future: [] as string[]
    });
    
    const saveTimeout = useRef<NodeJS.Timeout | null>(null);

    const fetchFaceTags = async (force = false) => {
        if (force) setIsRefreshing(true);
        else setIsLoadingTags(true);
        
        try {
            if (!force) {
                const cached = localStorage.getItem('adetailer_face_tags');
                if (cached) {
                    const tagsArray = JSON.parse(cached);
                    setFaceTags(new Set(tagsArray));
                    setIsLoadingTags(false);
                    return;
                }
            }
            
            const response = await fetch('https://raw.githubusercontent.com/DEX-1101/x1111/refs/heads/main/face_tags.csv');
            const text = await response.text();
            
            const tags = new Set<string>();
            const lines = text.split('\n');
            for (const line of lines) {
                const trimmed = line.trim().toLowerCase();
                if (trimmed) {
                    const tag = trimmed.replace(/_/g, ' ').replace(/^"|"$/g, '').trim();
                    if (tag && tag !== 'tag') {
                        tags.add(tag);
                    }
                }
            }
            setFaceTags(tags);
            localStorage.setItem('adetailer_face_tags', JSON.stringify(Array.from(tags)));
        } catch (error) {
            console.error("Failed to load face tags:", error);
        } finally {
            setIsLoadingTags(false);
            setIsRefreshing(false);
        }
    };

    // Load initial data
    useEffect(() => {
        fetchFaceTags();
        const saved = localStorage.getItem('adetailer_input_prompt') || '';
        setInputPrompt(saved);
        setHistory({ past: [], present: saved, future: [] });
    }, []);

    const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const val = e.target.value;
        setInputPrompt(val);

        if (saveTimeout.current) clearTimeout(saveTimeout.current);
        saveTimeout.current = setTimeout(() => {
            setHistory(h => {
                if (h.present === val) return h;
                const newPast = [...h.past, h.present].slice(-50);
                localStorage.setItem('adetailer_input_prompt', val);
                return { past: newPast, present: val, future: [] };
            });
        }, 500);
    };

    const handleUndo = useCallback(() => {
        setHistory(h => {
            if (h.past.length === 0) return h;
            const previous = h.past[h.past.length - 1];
            const newPast = h.past.slice(0, h.past.length - 1);
            setInputPrompt(previous);
            return {
                past: newPast,
                present: previous,
                future: [h.present, ...h.future]
            };
        });
    }, []);

    const handleRedo = useCallback(() => {
        setHistory(h => {
            if (h.future.length === 0) return h;
            const next = h.future[0];
            const newFuture = h.future.slice(1);
            setInputPrompt(next);
            return {
                past: [...h.past, h.present],
                present: next,
                future: newFuture
            };
        });
    }, []);

    const handleFilter = useCallback(() => {
        if (!inputPrompt) {
            setOutputPrompt('');
            return;
        }

        const parts = inputPrompt.split(',');

        const parsedSegments = parts.map((part, index) => {
            const match = part.match(/^([\s\n]*)(.*?)([\s\n]*)$/s);
            const leading = match?.[1] || '';
            const tagContent = match?.[2] || '';
            const trailing = match?.[3] || '';
            
            let trimmed = tagContent.toLowerCase();
            let normalized = trimmed
                .replace(/^[\[\(]+/, '')
                .replace(/(:[0-9.]+)?[\)\]]+$/, '')
                .replace(/_/g, ' ')
                .trim();

            const hasLora = /<lora:[^>]+>/i.test(trimmed);
            const isFaceTag = faceTags.has(normalized) || faceTags.has(trimmed);

            return {
                leading,
                tag: tagContent,
                trailing,
                original: part,
                trimmed,
                normalized,
                hasLora,
                isFaceTag,
                index
            };
        });

        const isBeforeLora = parsedSegments.map((seg, i, arr) => {
            if (seg.tag.trim() === '') return false;
            for (let j = i + 1; j < arr.length; j++) {
                if (arr[j].tag.trim() !== '') {
                    return arr[j].hasLora;
                }
            }
            return false;
        });

        const shouldKeep = parsedSegments.map((seg, i) => {
            if (i === 0 || i === 1) return true;
            if (seg.hasLora) return true;
            if (isBeforeLora[i]) return true;
            if (seg.isFaceTag) return true;
            return false;
        });

        const result = parsedSegments
            .filter((seg, i) => shouldKeep[i])
            .map(seg => seg.original)
            .join(',');

        setOutputPrompt(result);
    }, [inputPrompt, faceTags]);

    useEffect(() => {
        handleFilter();
    }, [handleFilter]);

    const adjustInputHeight = useCallback(() => {
        if (inputRef.current && inputRef.current.offsetParent !== null) {
            inputRef.current.style.height = 'auto';
            inputRef.current.style.height = `${Math.max(300, inputRef.current.scrollHeight)}px`;
        }
    }, []);

    useEffect(() => {
        adjustInputHeight();
    }, [inputPrompt, adjustInputHeight]);

    useEffect(() => {
        const current = inputRef.current;
        if (!current) return;
        
        const observer = new ResizeObserver(() => {
            window.requestAnimationFrame(() => {
                if (current) {
                    adjustInputHeight();
                }
            });
        });
        
        observer.observe(current);
        return () => observer.disconnect();
    }, [adjustInputHeight]);

    const handleCopy = () => {
        if (!outputPrompt) return;
        navigator.clipboard.writeText(outputPrompt);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.ctrlKey || e.metaKey) {
            if (e.key.toLowerCase() === 'z') {
                e.preventDefault();
                if (e.shiftKey) {
                    handleRedo();
                } else {
                    handleUndo();
                }
            } else if (e.key.toLowerCase() === 'y') {
                e.preventDefault();
                handleRedo();
            }
        }
    };

    const renderColoredOutput = () => {
        if (!outputPrompt) return <span className="text-zinc-600">Filtered output will appear here...</span>;
        
        const parts = outputPrompt.split(/(<lora:[^>]+>)/i);
        
        return parts.map((part, i) => {
            if (part.toLowerCase().startsWith('<lora:') && part.endsWith('>')) {
                return <span key={i} className="text-purple-400 font-bold bg-purple-400/10 px-1 rounded">{part}</span>;
            }
            return <span key={i}>{part}</span>;
        });
    };

    return (
        <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full bg-white/5 backdrop-blur-xl border border-white/10 shadow-2xl rounded-3xl p-6 h-full flex flex-col gap-6"
        >
            <div className="flex items-center justify-end">
                <div className="flex items-center gap-4">
                    {isLoadingTags ? (
                        <div className="flex items-center gap-2 text-zinc-400 text-sm font-medium bg-black/20 px-4 py-2 rounded-xl border border-white/5">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Loading...
                        </div>
                    ) : (
                        <motion.div 
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            className="flex items-center gap-3 bg-black/20 px-4 py-2 rounded-xl border border-white/5"
                        >
                            <div className="flex items-center gap-2 text-zinc-300 text-sm font-medium">
                                <Database className="w-4 h-4 text-accent" />
                                {faceTags.size} tags
                            </div>
                            <div className="w-px h-4 bg-white/10" />
                            <button
                                onClick={() => fetchFaceTags(true)}
                                className="flex items-center gap-1.5 text-zinc-400 hover:text-white transition-colors text-sm font-medium"
                            >
                                <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-accent' : ''}`} />
                                Refresh
                            </button>
                        </motion.div>
                    )}
                </div>
            </div>

            <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                {/* Input Area */}
                <div className="flex flex-col gap-3 w-full">
                    <div className="flex items-center justify-between">
                        <label className="text-sm font-semibold text-zinc-300">Original Prompt</label>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={handleUndo}
                                disabled={history.past.length === 0}
                                className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent transition-all"
                                title="Undo (Ctrl+Z)"
                            >
                                <Undo2 className="w-4 h-4" />
                            </button>
                            <button
                                onClick={handleRedo}
                                disabled={history.future.length === 0}
                                className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent transition-all"
                                title="Redo (Ctrl+Shift+Z)"
                            >
                                <Redo2 className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                    <textarea
                        ref={inputRef}
                        className="w-full bg-black/40 border border-white/10 rounded-2xl p-4 text-zinc-300 text-sm font-mono focus:outline-none focus:border-white/20 focus:ring-1 focus:ring-white/20 resize-none transition-all shadow-inner overflow-hidden"
                        placeholder="Paste your full prompt here..."
                        value={inputPrompt}
                        onChange={handleInputChange}
                        onKeyDown={handleKeyDown}
                        spellCheck={false}
                    />
                </div>

                {/* Output Area */}
                <div className="flex flex-col gap-3 w-full">
                    <div className="flex items-center justify-between">
                        <label className="text-sm font-semibold text-zinc-300">ADetailer Output</label>
                        <AnimatePresence mode="wait">
                            <motion.button
                                key={copied ? 'copied' : 'copy'}
                                initial={{ opacity: 0, y: 5 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -5 }}
                                onClick={handleCopy}
                                disabled={!outputPrompt}
                                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors disabled:opacity-50 border ${
                                    copied 
                                    ? 'bg-green-500/20 text-green-400 border-green-500/30' 
                                    : 'bg-white/10 hover:bg-white/15 text-white border-white/10'
                                }`}
                            >
                                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                                {copied ? 'COPIED!' : 'COPY'}
                            </motion.button>
                        </AnimatePresence>
                    </div>
                    <div
                        className="w-full bg-black/40 border border-white/10 rounded-2xl p-4 text-zinc-300 text-sm font-mono shadow-inner whitespace-pre-wrap break-words min-h-[300px]"
                    >
                        {renderColoredOutput()}
                    </div>
                </div>
            </div>
        </motion.div>
    );
};

