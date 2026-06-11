import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Search, Loader2, ExternalLink, Copy, AlertCircle, RefreshCw, Layers, Check, History, Upload, Download, X, Hash, User, Copyright, Tag as TagIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useDebounce } from 'use-debounce';
import { searchTags } from '../lib/danbooruApi';
import { Tag as DanbooruTag } from '../types';

interface PixivTag {
  tag: string;
  translation?: { en: string };
  danbooruTranslation?: string; // resolved via our logic
}

interface PixivPost {
  id: string;
  title: string;
  url: string; // thumbnail
  tags?: PixivTag[];
  loadingDetails?: boolean;
}

const danbooruTagCache = new Map<string, string>();
const pendingTagRequests = new Map<string, Promise<string>>();

const pLimit = (limit: number) => {
  let active = 0;
  const queue: Array<() => void> = [];

  return async <T,>(fn: () => Promise<T>): Promise<T> => {
    if (active >= limit) {
      await new Promise<void>(resolve => queue.push(resolve));
    }
    active++;
    try {
      return await fn();
    } finally {
      active--;
      if (queue.length > 0) {
        queue.shift()!();
      }
    }
  };
};

const limitTagFetch = pLimit(5);

async function getDanbooruTag(jaTag: string, pixivTrans: string, pixivRomaji?: string): Promise<string> {
  // If it's already an alphabet string, just return it directly
  if (/^[\x20-\x7E]+$/.test(jaTag)) {
    return jaTag;
  }

  if (danbooruTagCache.has(jaTag)) {
    return danbooruTagCache.get(jaTag)!;
  }

  if (pendingTagRequests.has(jaTag)) {
    return pendingTagRequests.get(jaTag)!;
  }

  const promise = limitTagFetch(async () => {
    const encodedTag = encodeURIComponent(jaTag);
    try {
      // 1. Check Danbooru Aliases
      const aliasRes = await fetch(`https://danbooru.donmai.us/tag_aliases.json?search[antecedent_name]=${encodedTag}`);
      if (aliasRes.ok) {
        const aliases = await aliasRes.json();
        if (aliases && aliases.length > 0) {
          for (const alias of aliases) {
            if (alias.status === 'active') {
              return alias.consequent_name.replace(/_/g, ' ');
            }
          }
          return aliases[0].consequent_name.replace(/_/g, ' ');
        }
      }
      
      // 2. Check exact tag matches
      const tagRes = await fetch(`https://danbooru.donmai.us/tags.json?search[name]=${encodedTag}`);
      if (tagRes.ok) {
        const tags = await tagRes.json();
        if (tags && tags.length > 0) {
          return tags[0].name.replace(/_/g, ' ');
        }
      }

      // 3. Check danbooru wiki pages for the tag
      const wikiRes = await fetch(`https://danbooru.donmai.us/wiki_pages.json?search[other_names_match]=${encodedTag}`);
      if (wikiRes.ok) {
        const wikis = await wikiRes.json();
        if (wikis && wikis.length > 0) {
           return wikis[0].title.replace(/_/g, ' ');
        }
      }
    } catch (err) {
      console.error("Danbooru tag fetch error:", err);
    }
    
    // 4. Fallback
    if (pixivTrans) {
      return pixivTrans.replace(/_/g, ' ');
    } else if (pixivRomaji) {
      return pixivRomaji.replace(/_/g, ' ');
    }
    return jaTag;
  });

  pendingTagRequests.set(jaTag, promise);
  const fallback = await promise;
  danbooruTagCache.set(jaTag, fallback);
  pendingTagRequests.delete(jaTag);
  return fallback;
}

const CATEGORY_COLORS: Record<number, { bg: string, text: string, icon: React.ReactNode }> = {
  0: { bg: 'bg-blue-500/20', text: 'text-blue-300', icon: <Hash className="w-4 h-4" /> }, // General
  1: { bg: 'bg-red-500/20', text: 'text-red-300', icon: <User className="w-4 h-4" /> }, // Artist
  3: { bg: 'bg-purple-500/20', text: 'text-purple-300', icon: <Copyright className="w-4 h-4" /> }, // Copyright
  4: { bg: 'bg-green-500/20', text: 'text-green-300', icon: <User className="w-4 h-4" /> }, // Character
  5: { bg: 'bg-orange-500/20', text: 'text-orange-300', icon: <TagIcon className="w-4 h-4" /> }, // Meta
};

export const PixivSearch: React.FC = () => {
  const [inputValue, setInputValue] = useState('');
  const [debouncedValue] = useDebounce(inputValue, 500);
  const [suggestions, setSuggestions] = useState<DanbooruTag[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [isSearchingTags, setIsSearchingTags] = useState(false);
  const [copiedStates, setCopiedStates] = useState<Record<string, boolean>>({});
  const [collectedTags, setCollectedTags] = useState<{tag: string, translation?: string}[]>([]);
  const [isCopiedAll, setIsCopiedAll] = useState(false);
  const [showLimitWarning, setShowLimitWarning] = useState(false);

  const [allFoundItems, setAllFoundItems] = useState<any[]>([]);
  const [visibleCount, setVisibleCount] = useState(10);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  
  const [historySearchTerm, setHistorySearchTerm] = useState('');
  const [tagHistory, setTagHistory] = useState<{ original: string; translated: string; count: number }[]>(() => {
    try {
      const saved = localStorage.getItem('pixivSearchTagHistory');
      if (saved) {
        let parsed = JSON.parse(saved);
        return parsed.map((p: any) => ({
          original: p.original || p.tag || '',
          translated: p.translated || '',
          count: p.count || 1
        }));
      }
    } catch(e) {}
    return [];
  });
  
  const filteredHistory = useMemo(() => {
     if (!historySearchTerm) return tagHistory;
     const term = historySearchTerm.toLowerCase();
     return tagHistory.filter(t => t.original.toLowerCase().includes(term) || t.translated.toLowerCase().includes(term));
  }, [tagHistory, historySearchTerm]);
  const [showTagHistory, setShowTagHistory] = useState(false);

  const dropdownRef = useRef<HTMLDivElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

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
    const fetchSuggestions = async () => {
      const parts = debouncedValue.split(',');
      const lastPart = parts[parts.length - 1].trim();
      
      if (!lastPart || lastPart === '-') {
        setSuggestions([]);
        setShowDropdown(false);
        return;
      }
      setIsSearchingTags(true);
      const searchTerm = lastPart.startsWith('-') ? lastPart.substring(1) : lastPart;
      const results = await searchTags(searchTerm);
      setSuggestions(results);
      setIsSearchingTags(false);
      setShowDropdown(true);
    };
    fetchSuggestions();
  }, [debouncedValue]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSuggestionClick = (tagName: string) => {
    const parts = inputValue.split(',');
    parts[parts.length - 1] = ' ' + tagName.replace(/_/g, ' ');
    setInputValue(parts.join(',').trim() + ', ');
    setShowDropdown(false);
  };

  const [query, setQuery] = useState('');
  const [posts, setPosts] = useState<PixivPost[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMSG, setErrorMSG] = useState<string | null>(null);

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setShowDropdown(false);
    if (!inputValue.trim()) return;

    const keywords = inputValue.split(',').map(k => k.trim()).filter(Boolean);
    if (keywords.length === 0) return;

    setIsLoading(true);
    setErrorMSG(null);
    setPosts([]);

    const translatedKeywords = await Promise.all(keywords.map(async (k) => {
       if (/[一-龠]+|[ぁ-ゔ]+|[ァ-ヴー]+/.test(k)) return k;
       let searchName = k.replace(/ /g, '_');
       try {
         const tagRes = await fetch(`https://danbooru.donmai.us/tags.json?search[name]=${encodeURIComponent(searchName)}`);
         if(tagRes.ok) {
            const tags = await tagRes.json();
            if(tags && tags.length > 0) searchName = tags[0].name;
         }
         const wikiRes = await fetch(`https://danbooru.donmai.us/wiki_pages.json?search[title]=${encodeURIComponent(searchName)}`);
         if(wikiRes.ok) {
            const wikis = await wikiRes.json();
            if(wikis && wikis.length > 0 && wikis[0].other_names) {
               const jaName = wikis[0].other_names.find((n: string) => /[一-龠]+|[ぁ-ゔ]+|[ァ-ヴー]+/.test(n));
               if(jaName) return jaName;
            }
         }
       } catch (err) {}
       return k;
    }));

    const qString = keywords.join(', ');
    setQuery(qString);
    let combinedQuery = translatedKeywords.join(' ');
    
    try {
      let searchData: any = null;
      
      const fetchPixiv = async (q: string) => {
        const res = await fetch(`/api/pixiv/search?word=${encodeURIComponent(q)}`);
        if (!res.ok) throw new Error('Proxy error');
        return await res.json();
      };

      searchData = await fetchPixiv(combinedQuery);
      
      let items: any[] = searchData?.body?.illustManga?.data || searchData?.body?.illust?.data || [];
      
      if (items.length === 0 && keywords.length > 1) {
        const fallbackQuery = keywords[0];
        setQuery(fallbackQuery);
        searchData = await fetchPixiv(fallbackQuery);
        items = searchData?.body?.illustManga?.data || searchData?.body?.illust?.data || [];
      }

      if (items.length === 0) {
        setIsLoading(false);
        setErrorMSG("No posts found matching these criteria on Pixiv.");
        return;
      }

      setAllFoundItems(items);
      setVisibleCount(10);
      
      const topItems = items.slice(0, 10).map((item: any) => ({
        id: item.id,
        title: item.title || 'Untitled',
        url: item.url,
        loadingDetails: true
      }));

      setPosts(topItems);
      setIsLoading(false);

      fetchDetailsForItems(topItems);

    } catch (err) {
      console.error(err);
      setErrorMSG("An error occurred during search.");
      setIsLoading(false);
    }
  };

  const fetchDetailsForItems = async (itemsToFetch: any[]) => {
      const fetchPromises = itemsToFetch.map(async (item) => {
        if (!item.id) return;
        try {
          const detailRes = await fetch(`/api/pixiv/illust?id=${item.id}`);
          if (detailRes.ok) {
            const detailData = await detailRes.json();
            const tagsArr = detailData?.body?.tags?.tags || [];
            
            const processedTags = await Promise.all(tagsArr.map(async (t: any) => {
              const t_ja = t.tag;
              const t_en = t.translation?.en || '';
              const t_romaji = t.romaji || '';
              const translatedTheme = await getDanbooruTag(t_ja, t_en, t_romaji);
              return { tag: t_ja, translation: t.translation, danbooruTranslation: translatedTheme };
            }));

            setPosts(prev => prev.map(p => p.id === item.id ? { ...p, tags: processedTags, loadingDetails: false } : p));
          } else {
             setPosts(prev => prev.map(p => p.id === item.id ? { ...p, loadingDetails: false } : p));
          }
        } catch (e) {
           setPosts(prev => prev.map(p => p.id === item.id ? { ...p, loadingDetails: false } : p));
        }
      });
      await Promise.all(fetchPromises);
  };

  const handleLoadMore = async () => {
     setIsLoadingMore(true);
     const nextCount = visibleCount + 10;
     const newItems = allFoundItems.slice(visibleCount, nextCount).map(item => ({
        id: item.id,
        title: item.title || 'Untitled',
        url: item.url,
        loadingDetails: true
     }));
     
     setPosts(prev => [...prev, ...newItems]);
     setVisibleCount(nextCount);
     await fetchDetailsForItems(newItems);
     setIsLoadingMore(false);
  };

  const handleCopyTag = (originalText: string, translatedText: string = '') => {
    navigator.clipboard.writeText(originalText);
    setCopiedStates(prev => ({ ...prev, [originalText]: true }));
    setCollectedTags(prev => {
      if (!prev.find(t => t.tag === originalText)) {
        const currentChars = prev.map(t => t.tag).join(' ').length;
        const newChars = currentChars > 0 ? currentChars + 1 + originalText.length : originalText.length;
        
        if (newChars > 30) {
          setShowLimitWarning(true);
          setTimeout(() => setShowLimitWarning(false), 3000);
          return prev;
        }
        return [...prev, { tag: originalText, translation: translatedText }];
      }
      return prev;
    });
    setTimeout(() => {
      setCopiedStates(prev => ({ ...prev, [originalText]: false }));
    }, 2000);

    setTagHistory(prev => {
      const existing = prev.find(t => t.original === originalText);
      let updated;
      if (existing) {
         updated = prev.map(t => t.original === originalText ? { ...t, count: t.count + 1, translated: translatedText || t.translated } : t);
      } else {
         updated = [...prev, { original: originalText, translated: translatedText, count: 1 }];
      }
      updated.sort((a,b) => b.count - a.count);
      localStorage.setItem('pixivSearchTagHistory', JSON.stringify(updated));
      return updated;
    });
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExportCSV = () => {
    const csvContent = "data:text/csv;charset=utf-8,original,translated,count\n" 
                     + tagHistory.map(t => `"${t.original}","${t.translated}",${t.count}`).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "pixiv_tag_history.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleImportCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const lines = text.split('\n');
      const newHistory: Record<string, { original: string, translated: string, count: number }> = {};
      lines.slice(1).forEach(line => {
        const parts = line.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g);
        if (parts && parts.length >= 3) {
           const original = parts[0].replace(/^"|"$/g, '');
           const translated = parts[1].replace(/^"|"$/g, '');
           const count = parseInt(parts[2].replace(/^"|"$/g, ''), 10);
           if (!isNaN(count) && original) {
               if(newHistory[original]) {
                   newHistory[original].count += count;
               } else {
                   newHistory[original] = { original, translated, count };
               }
           }
        }
      });
      setTagHistory(prev => {
         const combined = [...prev];
         Object.keys(newHistory).forEach(t => {
            const existing = combined.find(x => x.original === t);
            if (existing) {
               existing.count += newHistory[t].count;
               if (!existing.translated) existing.translated = newHistory[t].translated;
            } else {
               combined.push(newHistory[t]);
            }
         });
         combined.sort((a,b) => b.count - a.count);
         localStorage.setItem('pixivSearchTagHistory', JSON.stringify(combined));
         return combined;
      });
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className={`w-full flex-1 transition-all duration-300 ${collectedTags.length > 0 ? 'pb-52' : ''}`}>
       <div className="w-full flex items-center gap-2 mb-8 mx-auto sticky top-4 z-50 max-w-4xl" ref={dropdownRef}>
          <div className="flex-1 relative">
             <form 
               className="w-full bg-black/80 backdrop-blur-2xl p-1.5 rounded-2xl border border-white/10 shadow-2xl flex items-center relative z-20"
               onSubmit={handleSearch}
             >
                <input
                   type="text"
                   value={inputValue}
                   onChange={e => setInputValue(e.target.value)}
                   onFocus={() => { if (suggestions.length > 0) setShowDropdown(true); }}
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
                         handleSuggestionClick(suggestions[selectedIndex].name);
                       } else if (e.key === 'Escape') {
                         setShowDropdown(false);
                       }
                     }
                   }}
                   placeholder="Enter search terms (e.g., hiyuki, wuthering waves)"
                   className="flex-1 bg-transparent px-4 py-2 text-white placeholder-zinc-500 focus:outline-none"
                />
                <button type="submit" disabled={isLoading} className="mr-2 px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl transition-colors border border-white/10 text-xs font-semibold tracking-wide flex items-center gap-2">
                   {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                   SEARCH
                </button>
             </form>

             {/* Autocomplete Dropdown */}
             <AnimatePresence>
                {showDropdown && (suggestions.length > 0 || isSearchingTags) && (
                   <motion.div 
                     ref={suggestionsRef}
                     initial={{ opacity: 0, y: -10 }}
                     animate={{ opacity: 1, y: 0 }}
                     exit={{ opacity: 0, scale: 0.95 }}
                     className="absolute top-full left-0 right-0 mt-3 bg-black/80 backdrop-blur-2xl rounded-2xl shadow-2xl border border-white/10 overflow-hidden z-50 max-h-[40vh] overflow-y-auto"
                   >
                      {isSearchingTags && suggestions.length === 0 ? (
                         <div className="p-4 text-sm text-slate-400 flex items-center gap-2 justify-center italic border-t border-white/5 first:border-0">
                           <Loader2 className="w-4 h-4 animate-spin" /> Fetching tags...
                         </div>
                      ) : (
                         suggestions.map((tag, index) => {
                           const color = CATEGORY_COLORS[tag.category] || CATEGORY_COLORS[0];
                           const isSelected = index === selectedIndex;
                           return (
                              <button
                                 key={tag.id}
                                 type="button"
                                 onClick={() => handleSuggestionClick(tag.name)}
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
                         })
                      )}
                   </motion.div>
                )}
             </AnimatePresence>
          </div>
          
          <div className="relative">
             <button 
                type="button"
                onClick={() => setShowTagHistory(!showTagHistory)}
                className={`p-3.5 rounded-2xl border transition-all duration-300 ${showTagHistory ? 'bg-blue-500/20 border-blue-500/50 text-blue-400' : 'bg-black/80 backdrop-blur-2xl border-white/10 text-white hover:bg-white/10'}`}
                title="Tag History"
             >
                <History className="w-5 h-5" />
             </button>

             <AnimatePresence>
                {showTagHistory && (
                   <motion.div 
                      initial={{ opacity: 0, scale: 0.95, y: -10 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95, y: -10 }}
                      className="absolute right-0 top-16 w-[340px] max-h-[500px] bg-[#111827] border border-[#1f2937] rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.5)] z-50 flex flex-col overflow-hidden"
                   >
                      <div className="p-4 flex items-center justify-between border-b border-[#1f2937]">
                         <h3 className="text-white font-semibold flex items-center gap-2 text-sm">
                            <History className="w-4 h-4 text-blue-400" /> Frequently Copied Tags
                         </h3>
                         <div className="flex items-center gap-1">
                             <input type="file" accept=".csv" className="hidden" ref={fileInputRef} onChange={handleImportCSV} />
                             <button onClick={() => fileInputRef.current?.click()} className="p-1.5 text-[#9ca3af] hover:bg-white/10 hover:text-white rounded-md transition-colors" title="Import CSV">
                               <Upload className="w-4 h-4" />
                             </button>
                             <button onClick={handleExportCSV} className="p-1.5 text-[#9ca3af] hover:bg-white/10 hover:text-white rounded-md transition-colors" title="Export CSV">
                               <Download className="w-4 h-4" />
                             </button>
                             <button onClick={() => setShowTagHistory(false)} className="p-1.5 text-[#9ca3af] hover:bg-white/10 hover:text-white rounded-md transition-colors ml-1" title="Close">
                               <X className="w-4 h-4" />
                             </button>
                         </div>
                      </div>
                      
                      <div className="p-4 py-3 border-b border-[#1f2937]">
                          <div className="relative">
                              <Search className="w-4 h-4 text-[#6b7280] absolute left-3 top-1/2 -translate-y-1/2" />
                              <input 
                                 type="text" 
                                 placeholder="Search history..." 
                                 value={historySearchTerm}
                                 onChange={(e) => setHistorySearchTerm(e.target.value)}
                                 className="w-full bg-[#1f2937] text-sm text-gray-200 rounded-lg pl-9 pr-4 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                              />
                          </div>
                      </div>

                      <div className="overflow-y-auto flex-1 custom-scrollbar">
                         {filteredHistory.length === 0 ? (
                            <div className="p-6 text-center text-sm text-[#6b7280] italic">
                               No tags found.
                            </div>
                         ) : (
                            <div className="flex flex-col">
                               {filteredHistory.map((t, idx) => (
                                  <div 
                                     key={idx} 
                                     onClick={() => handleCopyTag(t.original, t.translated)}
                                     className="flex items-center justify-between p-4 px-5 border-b border-[#1f2937]/50 hover:bg-[#1f2937]/50 transition-colors cursor-pointer group"
                                  >
                                     <div className="flex-1 min-w-0 flex flex-col gap-1 mr-4">
                                        <span className="text-[15px] font-medium text-gray-200 line-clamp-1 truncate" title={t.original}>{t.original}</span>
                                        <span className="text-sm text-[#6b7280] line-clamp-1 truncate" title={t.translated}>{t.translated}</span>
                                     </div>
                                     <div className="shrink-0 flex items-center justify-center bg-[#1f2937] group-hover:bg-[#374151] rounded w-[26px] h-[26px] text-xs text-[#9ca3af] font-mono transition-colors">
                                        {copiedStates[t.original] ? <Check className="w-3.5 h-3.5 text-green-400" /> : t.count}
                                     </div>
                                  </div>
                               ))}
                            </div>
                         )}
                      </div>
                   </motion.div>
                )}
             </AnimatePresence>
          </div>
       </div>

       <div className="w-full max-w-[1600px] mx-auto flex flex-col gap-6">
          {errorMSG && (
              <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex gap-3 items-start shadow-lg backdrop-blur-md max-w-4xl mx-auto w-full">
                 <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                 <p className="text-red-200/90 text-sm leading-relaxed font-semibold">
                    {errorMSG}
                 </p>
              </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 w-full">
            <AnimatePresence mode="popLayout">
               {posts.map(post => (
                     <motion.div 
                        key={post.id}
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        transition={{ duration: 0.3 }}
                        className="relative group rounded-2xl overflow-hidden shadow-xl h-[420px] flex flex-col bg-[#0a0e17] border border-[#1e293b] hover:border-blue-500/50 hover:shadow-[0_0_30px_rgba(59,130,246,0.15)] transition-all duration-300"
                     >
                     {/* Background Image */}
                     <div className="absolute inset-0 w-full h-full">
                        {post.url ? (
                           <img 
                              src={`/api/pixiv/image?url=${encodeURIComponent(post.url)}`}
                              alt={post.title}
                              className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                              referrerPolicy="no-referrer"
                           />
                        ) : (
                           <div className="w-full h-full bg-[#111926] flex items-center justify-center">
                              <span className="text-xs text-[#64748b] italic">No image</span>
                           </div>
                        )}
                     </div>

                     {/* Gradient Overlay */}
                     <div className="absolute inset-0 bg-gradient-to-t from-[#0a0e17] via-[#0a0e17]/80 to-transparent z-10" />

                     {/* Content */}
                     <div className="relative z-20 flex-1 flex flex-col justify-end p-5 md:p-6 text-white h-full pointer-events-none">
                       <div className="flex flex-col pointer-events-auto h-full justify-end max-h-full">
                        <h4 className="text-2xl font-bold mb-1 line-clamp-1 drop-shadow-md text-white shrink-0">{post.title}</h4>
                        <a 
                          href={`https://www.pixiv.net/en/artworks/${post.id}`} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-[#94a3b8] hover:text-blue-400 transition-colors text-sm flex items-center gap-1.5 mb-4 inline-flex w-fit drop-shadow-sm font-medium shrink-0"
                        >
                           Pixiv ID: {post.id}
                           <ExternalLink className="w-4 h-4 ml-0.5" />
                        </a>

                        <div className="w-full flex items-start flex-col shrink-0 min-h-[140px] max-h-[140px]">
                           <strong className="text-[#94a3b8] text-xs font-semibold uppercase tracking-widest flex items-center gap-2 mb-3 shrink-0">
                              <Layers className="w-4 h-4" /> TAGS
                           </strong>
                           
                           <div className="flex-1 w-full overflow-y-auto custom-scrollbar pb-2 pr-1">
                              <AnimatePresence mode="wait">
                                 {post.loadingDetails ? (
                                    <motion.div 
                                       key="loading"
                                       initial={{ opacity: 0, y: -5 }}
                                       animate={{ opacity: 1, y: 0 }}
                                       exit={{ opacity: 0, y: 5 }}
                                       className="flex items-center gap-2 text-[#94a3b8] text-sm py-2"
                                    >
                                       <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
                                       Resolving tags...
                                    </motion.div>
                                 ) : (post.tags && post.tags.length > 0 ? (
                                    <motion.div 
                                       key="tags"
                                       initial={{ opacity: 0 }}
                                       animate={{ opacity: 1 }}
                                       className="flex flex-wrap gap-2"
                                    >
                                       {post.tags.map((t, idx) => (
                                          <motion.div 
                                             initial={{ opacity: 0, scale: 0.9 }}
                                             animate={{ opacity: 1, scale: 1 }}
                                             transition={{ delay: idx * 0.015 }}
                                             key={t.tag} 
                                             className="inline-flex items-stretch bg-[#111926]/90 backdrop-blur-md border border-[#1e293b] rounded-lg overflow-hidden shrink-0 group/tag hover:border-blue-500/50 transition-colors"
                                          >
                                             <a 
                                                href={`https://www.pixiv.net/en/tags/${encodeURIComponent(t.tag)}/artworks`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="px-3 py-1.5 text-sm font-sans flex items-center gap-1.5 hover:bg-white/5 transition-colors"
                                                title={`${t.tag} ${t.danbooruTranslation && t.danbooruTranslation !== t.tag ? `(${t.danbooruTranslation})` : ''}`}
                                             >
                                                <span className="text-gray-200">{t.tag}</span>
                                                {t.danbooruTranslation && t.danbooruTranslation !== t.tag && (
                                                   <span className="text-[#64748b] text-xs font-medium">({t.danbooruTranslation})</span>
                                                )}
                                             </a>
                                             <button 
                                                onClick={(e) => { e.preventDefault(); handleCopyTag(t.tag, t.danbooruTranslation || ''); }}
                                                title="Copy Original Tag Only"
                                                className="pr-3 pl-1.5 py-1.5 text-[#64748b] hover:text-white transition-colors shrink-0 flex items-center justify-center bg-transparent"
                                             >
                                                {copiedStates[t.tag] ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                                             </button>
                                          </motion.div>
                                       ))}
                                    </motion.div>
                                 ) : (
                                    <motion.div 
                                       key="empty"
                                       initial={{ opacity: 0 }}
                                       animate={{ opacity: 1 }}
                                       className="text-sm text-[#64748b] py-2 block"
                                    >
                                       No tags found
                                    </motion.div>
                                 ))}
                              </AnimatePresence>
                           </div>
                        </div>
                       </div>
                     </div>
                  </motion.div>
               ))}
            </AnimatePresence>
          </div>

          {allFoundItems.length > visibleCount && (
             <div className="flex justify-center w-full mt-6 mb-12">
                <button 
                   onClick={handleLoadMore}
                   disabled={isLoadingMore}
                   className="px-8 py-3 bg-blue-600/20 hover:bg-blue-600/40 border border-blue-500/30 text-blue-300 font-semibold rounded-xl transition-all duration-300 flex items-center gap-2 shadow-[0_0_15px_rgba(59,130,246,0.1)] hover:shadow-[0_0_25px_rgba(59,130,246,0.2)] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                   {isLoadingMore ? <Loader2 className="w-5 h-5 animate-spin" /> : <RefreshCw className="w-5 h-5" />}
                   {isLoadingMore ? 'LOADING MORE...' : 'LOAD MORE'}
                </button>
             </div>
          )}
       </div>

       <AnimatePresence>
          {collectedTags.length > 0 && (
             <motion.div
                initial={{ opacity: 0, y: 50, scale: 0.9, x: "-50%" }}
                animate={{ opacity: 1, y: 0, scale: 1, x: "-50%" }}
                exit={{ opacity: 0, y: 50, scale: 0.9, x: "-50%" }}
                className="fixed bottom-6 left-1/2 z-50 bg-black/60 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl p-3 w-[calc(100vw-3rem)] md:w-[640px] pointer-events-auto"
             >
                <AnimatePresence>
                   {showLimitWarning && (
                      <motion.div
                         initial={{ opacity: 0, y: 10, scale: 0.9, x: "-50%" }}
                         animate={{ opacity: 1, y: 0, scale: 1, x: "-50%" }}
                         exit={{ opacity: 0, y: 10, scale: 0.9, x: "-50%" }}
                         className="absolute -top-14 left-1/2 bg-red-500/90 text-white px-4 py-2 rounded-xl shadow-lg border border-red-400 backdrop-blur-md text-sm font-medium whitespace-nowrap"
                      >
                         Limit reached! Maximum 30 characters allowed.
                      </motion.div>
                   )}
                </AnimatePresence>
                <div className="flex flex-wrap gap-1.5 mb-3 max-h-40 overflow-y-auto custom-scrollbar pr-1">
                   {collectedTags.map(t => (
                      <span key={t.tag} className="bg-black/50 border border-white/5 text-sm text-gray-200 px-2.5 py-1 rounded-lg flex items-center gap-1.5 group">
                         {t.tag}
                         {t.translation && t.translation !== t.tag && (
                            <span className="text-[#94a3b8] text-xs">({t.translation})</span>
                         )}
                         <button 
                            onClick={() => setCollectedTags(prev => prev.filter(x => x.tag !== t.tag))} 
                            className="text-[#64748b] hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity ml-1"
                         >
                            <X className="w-3.5 h-3.5" />
                         </button>
                      </span>
                   ))}
                </div>
                <div className="flex items-center gap-2">
                   <button
                      onClick={() => {
                         navigator.clipboard.writeText(collectedTags.map(t => t.tag).join(' '));
                         setIsCopiedAll(true);
                         setTimeout(() => setIsCopiedAll(false), 2000);
                      }}
                      className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-sm font-medium transition-colors ${
                         isCopiedAll 
                            ? 'bg-green-600/30 text-green-400 border border-green-500/50 hover:bg-green-600/40' 
                            : 'bg-white/10 hover:bg-white/20 text-white'
                      }`}
                   >
                      {isCopiedAll ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      {isCopiedAll ? 'Copied!' : 'Copy All'}
                   </button>
                   <button 
                      onClick={() => setCollectedTags([])}
                      className="p-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-xl transition-colors shrink-0"
                      title="Clear all"
                   >
                      <X className="w-4 h-4" />
                   </button>
                </div>
             </motion.div>
          )}
       </AnimatePresence>
    </div>
  );
};
