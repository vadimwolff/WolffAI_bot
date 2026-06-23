import React, { useEffect, useState, useRef } from 'react';
import { 
  Bot, Zap, Users, Shield, ArrowRight, Flame, Trash2, 
  Sparkles, Cpu, Globe, Lock, Search, Filter, RefreshCw, 
  MessageSquare, ChevronRight, X, Copy, Mail, Calendar, 
  CheckCircle, ShieldAlert, Award, Star, ExternalLink, HelpCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import PromoControls from './components/PromoControls.tsx';

interface ChatMessage {
  role: 'user' | 'model' | 'assistant';
  parts?: Array<{ text?: string }>;
  text?: string;
  content?: any;
}

interface UserChat {
  bot: 'WolffAi' | 'AngryAI' | 'PlatformBot';
  name: string;
  messagesCount: number;
  history: ChatMessage[];
}

interface AdminUser {
  id: string;
  rawId: string;
  origin: 'wolff' | 'platform';
  username: string | null;
  firstName: string;
  joinedAt: string;
  isSubscribed: boolean;
  messagesToday: number;
  totalMessagesCount: number;
  lastActive: string;
  activeModelOrMode: string;
  chatsCount: number;
  chats: UserChat[];
  promoUsed?: string | null;
  proRevoked?: boolean;
}

interface AdminStats {
  totalUsersCombined: number;
  wolffUsersCount: number;
  platformUsersCount: number;
  totalMessagesCount: number;
  wolffMessagesCount: number;
  platformMessagesCount: number;
  wolffSubscribed: number;
  platformSubscribed: number;
  totalSubscribed: number;
  wolffPromoCount?: number;
  platformPromoCount?: number;
  totalPromoCount?: number;
}

export default function App() {
  const [stats, setStats] = useState<AdminStats>({
    totalUsersCombined: 0,
    wolffUsersCount: 0,
    platformUsersCount: 0,
    totalMessagesCount: 0,
    wolffMessagesCount: 0,
    platformMessagesCount: 0,
    wolffSubscribed: 0,
    platformSubscribed: 0,
    totalSubscribed: 0,
    wolffPromoCount: 0,
    platformPromoCount: 0,
    totalPromoCount: 0
  });

  const [usersList, setUsersList] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorChat, setErrorChat] = useState<string | null>(null);
  
  // Realtime search & filter states
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [originFilter, setOriginFilter] = useState<'all' | 'wolff' | 'platform'>('all');
  const [subscriptionFilter, setSubscriptionFilter] = useState<'all' | 'free' | 'premium' | 'promo'>('all');
  const [sortBy, setSortBy] = useState<'joined' | 'messages' | 'today'>('joined');

  // Drawer / Inspector states
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [activeInspectChat, setActiveInspectChat] = useState<UserChat | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [toggleLoading, setToggleLoading] = useState<string | null>(null);
  const [noteEditVal, setNoteEditVal] = useState<string>('');
  const [noteSaving, setNoteSaving] = useState<boolean>(false);

  // Keep-awake mode telemetry state
  const [keepAwakeInfo, setKeepAwakeInfo] = useState<{
    lastKnownPublicUrl: string;
    lastPingTime: string | null;
    pingCount: number;
    isProd: boolean;
  } | null>(null);

  const fetchKeepAwake = async () => {
    try {
      const res = await fetch('/api/admin/keep-awake-status');
      if (res.ok) {
        const data = await res.json();
        setKeepAwakeInfo(data);
      }
    } catch (e) {
      console.warn("Failed to retrieve keep-awake telemetry:", e);
    }
  };

  useEffect(() => {
    if (selectedUser) {
      setNoteEditVal(selectedUser.adminNote || '');
    } else {
      setNoteEditVal('');
    }
  }, [selectedUser?.id]);

  // Stats status indicators
  const [connections, setConnections] = useState({
    web: true,
    database: true,
    wolffBot: true,
    platformBot: true
  });

  // Fetch users & stats from backend
  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/users');
      if (res.ok) {
        const data = await res.json();
        setStats(data.stats);
        setUsersList(data.users);
        setErrorChat(null);

        // Keep active inspect user selected if matching items exist
        if (selectedUser) {
          const freshUser = data.users.find((u: AdminUser) => u.id === selectedUser.id);
          if (freshUser) {
            setSelectedUser(freshUser);
            // also find inspect chat
            if (activeInspectChat) {
              const freshChat = freshUser.chats.find((c: UserChat) => c.name === activeInspectChat.name && c.bot === activeInspectChat.bot);
              if (freshChat) {
                setActiveInspectChat(freshChat);
              }
            }
          }
        }
      } else {
        setErrorChat('Не удалось загрузить данные пользователей с сервера.');
      }
      
      // Pull keep-awake status of server
      fetchKeepAwake();
    } catch (e) {
      console.error(e);
      setErrorChat('Сетевая ошибка при загрузке аналитики.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // Auto refresh periodically in real-time
    const interval = setInterval(fetchData, 45000);
    return () => clearInterval(interval);
  }, []);

  const handleToggleSubscription = async (usr: AdminUser, revokeRules?: boolean) => {
    setToggleLoading(usr.id);
    try {
      const res = await fetch('/api/admin/user/toggle-subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: usr.rawId, origin: usr.origin, revokeRules })
      });
      if (res.ok) {
        const data = await res.json();
        // Optimistically update
        setUsersList(prev => prev.map(u => {
          if (u.id === usr.id) {
            return { ...u, isSubscribed: data.isSubscribed, proRevoked: data.proRevoked };
          }
          return u;
        }));
        
        // Fetch fresh stats and data to keep everything 100% in sync
        fetchData();

        // Update selected inspect user
        if (selectedUser && selectedUser.id === usr.id) {
          setSelectedUser(prev => prev ? { ...prev, isSubscribed: data.isSubscribed, proRevoked: data.proRevoked } : null);
        }
      } else {
        alert('Не удалось изменить статус подписки.');
      }
    } catch (e) {
      console.error(e);
      alert('Ошибка соединения с базой данных.');
    } finally {
      setToggleLoading(null);
    }
  };

  const handleSaveNote = async (usr: AdminUser, noteText: string) => {
    setNoteSaving(true);
    try {
      const res = await fetch('/api/admin/user/save-note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: usr.rawId, origin: usr.origin, note: noteText })
      });
      if (res.ok) {
        const data = await res.json();
        setUsersList(prev => prev.map(u => {
          if (u.id === usr.id) {
            return { ...u, adminNote: data.adminNote };
          }
          return u;
        }));
        if (selectedUser && selectedUser.id === usr.id) {
          setSelectedUser(prev => prev ? { ...prev, adminNote: data.adminNote } : null);
        }
      } else {
        alert('Не удалось обновить псевдоним/заметку.');
      }
    } catch (e) {
      console.error(e);
      alert('Ошибка соединения при сохранении псевдонима.');
    } finally {
      setNoteSaving(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(text);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Filter and sort computation
  const filteredUsers = usersList.filter(u => {
    const term = searchQuery.toLowerCase().trim();
    const matchesSearch = !term || 
      u.rawId.includes(term) ||
      (u.username && u.username.toLowerCase().includes(term)) ||
      u.firstName.toLowerCase().includes(term) ||
      (u.adminNote && u.adminNote.toLowerCase().includes(term)) ||
      (u.promoUsed && u.promoUsed.toLowerCase().includes(term));

    const matchesOrigin = originFilter === 'all' || u.origin === originFilter;
    
    const matchesSubscription = subscriptionFilter === 'all' || 
      (subscriptionFilter === 'premium' && u.isSubscribed) ||
      (subscriptionFilter === 'free' && !u.isSubscribed) ||
      (subscriptionFilter === 'promo' && !!u.promoUsed);

    return matchesSearch && matchesOrigin && matchesSubscription;
  });

  const sortedUsers = [...filteredUsers].sort((a, b) => {
    if (sortBy === 'joined') {
      return new Date(b.joinedAt).getTime() - new Date(a.joinedAt).getTime();
    } else if (sortBy === 'messages') {
      return b.totalMessagesCount - a.totalMessagesCount;
    } else {
      return b.messagesToday - a.messagesToday;
    }
  });

  const triggerInspectUser = (usr: AdminUser) => {
    setSelectedUser(usr);
    if (usr.chats && usr.chats.length > 0) {
      setActiveInspectChat(usr.chats[0]);
    } else {
      setActiveInspectChat(null);
    }
    // Scroll to inspect panel if on mobile/small screen
    setTimeout(() => {
      document.getElementById('dialog-inspector')?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  function renderMessageContent(msg: ChatMessage) {
    let rawText = '';
    
    // Normalize text across different API formats
    if (msg.text) {
      rawText = msg.text;
    } else if (msg.content) {
      if (typeof msg.content === 'string') {
        rawText = msg.content;
      } else if (Array.isArray(msg.content)) {
        const textPart = msg.content.find((p: any) => p.type === 'text');
        rawText = textPart ? textPart.text : '';
      }
    } else if (msg.parts && Array.isArray(msg.parts)) {
      const textPart = msg.parts.find((p: any) => p.text);
      rawText = textPart ? textPart.text : '';
    }

    if (!rawText) return <span className="text-gray-500 italic">Пустое сообщение или медиа вложение</span>;

    let escaped = rawText
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    escaped = escaped.replace(/```([\s\S]*?)```/g, '<pre class="bg-[#0b0c10] text-[#4af626] font-mono text-xs md:text-sm p-3.5 rounded-xl my-2.5 overflow-x-auto border border-white/5 whitespace-pre-wrap">$1</pre>');
    escaped = escaped.replace(/`([^`]+)`/g, '<code class="bg-[#212128] text-gray-200 px-1.5 py-0.5 rounded font-mono text-xs border border-white/5">$1</code>');
    escaped = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    escaped = escaped.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    escaped = escaped.replace(/\n/g, '<br/>');

    return <span dangerouslySetInnerHTML={{ __html: escaped }} />;
  }

  // Visual metrics calculation helpers
  const wolffRatio = stats.totalUsersCombined > 0 ? (stats.wolffUsersCount / stats.totalUsersCombined) * 100 : 0;
  const platformRatio = stats.totalUsersCombined > 0 ? (stats.platformUsersCount / stats.totalUsersCombined) * 100 : 0;

  return (
    <div className="min-h-screen bg-[#070709] text-gray-100 font-sans selection:bg-indigo-600 selection:text-white pb-20 overflow-x-hidden relative">
      {/* SHIMMERING BACKGROUND GRID & GLOWS */}
      <div className="absolute top-0 left-1/4 w-[600px] h-[550px] bg-indigo-900/10 rounded-full blur-[140px] pointer-events-none"></div>
      <div className="absolute top-[30%] right-10 w-[500px] h-[500px] bg-violet-950/10 rounded-full blur-[160px] pointer-events-none"></div>
      <div className="absolute bottom-[20%] left-5 w-[450px] h-[450px] bg-indigo-950/5 rounded-full blur-[130px] pointer-events-none"></div>

      {/* HEADER NAVBAR */}
      <nav className="relative z-10 flex flex-col md:flex-row items-center justify-between px-6 py-5 max-w-7xl mx-auto gap-4 border-b border-white/5 bg-[#0a0a0e]/40 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-tr from-indigo-600 to-violet-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-600/30">
            <Cpu className="w-6.5 h-6.5 text-white animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-black tracking-widest text-white uppercase">WOLFF SYSTEM</span>
              <span className="bg-indigo-500/15 border border-indigo-500/30 text-indigo-400 font-mono font-bold text-[9px] px-1.5 py-0.5 rounded uppercase tracking-wider">
                ADMIN CONSOLE
              </span>
            </div>
            <span className="text-[10px] text-gray-400 font-mono tracking-widest block uppercase">Real-Time Core Metrics Base</span>
          </div>
        </div>

        {/* Real-Time Live Pulse Indicators */}
        <div className="flex flex-wrap items-center justify-center gap-4 text-xs font-mono">
          <div className="flex items-center gap-1.5 bg-white/5 border border-white/5 px-2.5 py-1.5 rounded-lg text-[10px]">
            <span className={`w-2 h-2 rounded-full ${connections.web ? 'bg-emerald-500 shadow-md shadow-emerald-500/20' : 'bg-red-500'} animate-pulse`}></span>
            <span className="text-gray-300">WEB PORT: 3000</span>
          </div>
          <div className="flex items-center gap-1.5 bg-white/5 border border-white/5 px-2.5 py-1.5 rounded-lg text-[10px]">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="text-gray-300">USERS FILE: ACTIVE</span>
          </div>
          <div className="flex items-center gap-1.5 bg-indigo-500/5 border border-indigo-500/10 px-2.5 py-1.5 rounded-lg text-[10px] text-indigo-300">
            <Globe className="w-3.5 h-3.5 animate-spin" style={{ animationDuration: '8s' }} />
            <span>REAL-TIME FEED</span>
          </div>
          
          <button 
            onClick={fetchData}
            disabled={loading}
            className="bg-white/5 hover:bg-white/10 dark:border-white/10 px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5 transition-all text-white font-semibold flex-shrink-0 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Обновить</span>
          </button>
        </div>
      </nav>

      {/* DASHBOARD HERO OVERLAY */}
      <main className="max-w-7xl mx-auto px-6 mt-8 relative z-10">
        
        {/* LANDING INTRO */}
        <div className="mb-8">
          <span className="px-3.5 py-1 rounded-full bg-indigo-500/10 text-indigo-400 text-xs font-bold tracking-wide border border-indigo-500/20 uppercase inline-block">
            📊 Системная аналитика экосистемы ботов
          </span>
          <h1 className="text-2xl md:text-3xl font-extrabold text-white mt-2 tracking-tight">
            База Данных & Статистика Активности
          </h1>
          <p className="text-gray-400 text-xs md:text-sm mt-1 leading-relaxed max-w-xl">
            Управляйте премиум подписками, отслеживайте посещаемость ботов в реальном времени, просматривайте диалоги пользователей и синхронизируйте лог событий.
          </p>
        </div>

        {/* CUMULATIVE METRICS CARDS */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
          
          {/* CARD 1: CUMULATIVE BOARD */}
          <div className="bg-[#0e0e12] border border-white/5 p-5 rounded-2xl flex flex-col justify-between hover:border-indigo-500/20 transition-all group">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400 font-semibold uppercase font-mono">Всего пользователей</span>
              <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                <Users className="w-5 h-5" />
              </div>
            </div>
            <div className="mt-4">
              <span className="text-3xl font-extrabold text-white block tracking-tight font-mono">
                {stats.totalUsersCombined}
              </span>
              <div className="flex items-center gap-1.5 mt-2">
                <span className="text-[10px] bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 font-mono font-semibold px-2 py-0.5 rounded">
                  {stats.wolffUsersCount} WolffAi
                </span>
                <span className="text-[10px] bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 font-mono font-semibold px-2 py-0.5 rounded">
                  {stats.platformUsersCount} Platform
                </span>
              </div>
            </div>
          </div>

          {/* CARD 2: CUMULATIVE MESSAGES */}
          <div className="bg-[#0e0e12] border border-white/5 p-5 rounded-2xl flex flex-col justify-between hover:border-violet-500/20 transition-all group">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400 font-semibold uppercase font-mono">Всего сообщений</span>
              <div className="p-2 rounded-xl bg-violet-500/10 text-violet-400 border border-violet-500/20">
                <MessageSquare className="w-5 h-5" />
              </div>
            </div>
            <div className="mt-4">
              <span className="text-3xl font-extrabold text-white block tracking-tight font-mono">
                {stats.totalMessagesCount}
              </span>
              <div className="flex items-center gap-1.5 mt-2">
                <span className="text-[10px] bg-violet-500/10 border border-violet-500/20 text-violet-300 font-mono font-semibold px-2 py-0.5 rounded">
                  {stats.wolffMessagesCount} Wolff
                </span>
                <span className="text-[10px] bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 font-mono font-semibold px-2 py-0.5 rounded">
                  {stats.platformMessagesCount} Plat
                </span>
              </div>
            </div>
          </div>

          {/* CARD 3: PREMIUM BASE */}
          <div className="bg-[#0e0e12] border border-white/5 p-5 rounded-2xl flex flex-col justify-between hover:border-amber-500/20 transition-all group">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400 font-semibold uppercase font-mono">Премиум-подписчики</span>
              <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
                <Star className="w-5 h-5" />
              </div>
            </div>
            <div className="mt-4">
              <span className="text-2xl font-extrabold text-amber-400 block tracking-tight font-mono">
                💎 {stats.totalSubscribed}
              </span>
              <span className="text-[10px] text-gray-400 mt-2 block">
                Конверсия в премиум: {stats.totalUsersCombined > 0 ? Math.round((stats.totalSubscribed / stats.totalUsersCombined) * 100) : 0}% от всей базы
              </span>
            </div>
          </div>

          {/* CARD 4: BOT TELEMETRY STATUS */}
          <div className="bg-[#0e0e12] border border-white/5 p-5 rounded-2xl flex flex-col justify-between hover:border-emerald-500/20 transition-all group">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400 font-semibold uppercase font-mono">Статус ботов в ТГ</span>
              <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <Shield className="w-5 h-5" />
              </div>
            </div>
            <div className="mt-4 flex flex-col gap-1.5 font-mono text-[10px]">
              <div className="flex justify-between items-center bg-black/40 p-1 px-2 rounded border border-white/5">
                <span className="text-gray-400">Wolff & Angry Bot</span>
                <span className="text-emerald-400 font-bold">● ONLINE</span>
              </div>
              <div className="flex justify-between items-center bg-black/40 p-1 px-2 rounded border border-white/5">
                <span className="text-gray-400">PlatformBot</span>
                <span className="text-emerald-400 font-bold">● ONLINE</span>
              </div>
            </div>
          </div>

        </div>

        {/* THE BOT LOAD RATIO - ANSWERING USER QUESTION */}
        <div className="bg-[#0f0f14] border border-white/5 p-6 rounded-3xl mb-8">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 gap-2">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                <Zap className="w-4 h-4 text-indigo-400" />
                Распределение пользователей по ботам
              </h3>
              <p className="text-[11px] text-gray-400">Каким ботом Wolff System пользуются больше всего в реальном времени</p>
            </div>
            <div className="flex items-center gap-3 text-[10px] font-mono">
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-sm bg-indigo-500"></div>
                <span className="text-gray-300">WolffAi / Angry ({wolffRatio.toFixed(1)}%)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-sm bg-emerald-500"></div>
                <span className="text-gray-300">PlatformBot ({platformRatio.toFixed(1)}%)</span>
              </div>
            </div>
          </div>

          <div className="w-full h-3.5 bg-[#171720] rounded-full overflow-hidden flex border border-white/5 shadow-inner">
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: `${wolffRatio}%` }}
              transition={{ duration: 0.8 }}
              className="h-full bg-gradient-to-r from-indigo-600 to-indigo-400"
              title={`WolffAi: ${stats.wolffUsersCount} пользователей`}
            />
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: `${platformRatio}%` }}
              transition={{ duration: 0.8 }}
              className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400"
              title={`PlatformBot: ${stats.platformUsersCount} пользователей`}
            />
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-5 text-center">
            <div className="bg-black/30 border border-white/5 p-3 rounded-xl">
              <span className="text-gray-400 text-[10px] uppercase font-mono block">Wolff & Angry Юзеры</span>
              <span className="text-lg font-extrabold text-indigo-400 block tracking-tight font-mono">{stats.wolffUsersCount}</span>
            </div>
            <div className="bg-black/30 border border-white/5 p-3 rounded-xl">
              <span className="text-gray-400 text-[10px] uppercase font-mono block">Platform bot Юзеры</span>
              <span className="text-lg font-extrabold text-emerald-400 block tracking-tight font-mono">{stats.platformUsersCount}</span>
            </div>
            <div className="bg-black/30 border border-white/5 p-3 rounded-xl">
              <span className="text-gray-400 text-[10px] uppercase font-mono block">Премиум Wolff</span>
              <span className="text-lg font-extrabold text-indigo-300 block tracking-tight font-mono">💎 {stats.wolffSubscribed}</span>
            </div>
            <div className="bg-black/30 border border-white/5 p-3 rounded-xl">
              <span className="text-gray-400 text-[10px] uppercase font-mono block">Премиум Platform</span>
              <span className="text-lg font-extrabold text-emerald-300 block tracking-tight font-mono">💎 {stats.platformSubscribed}</span>
            </div>
          </div>

          <div className="bg-gradient-to-r from-amber-600/10 to-amber-500/5 border border-amber-500/20 p-4 rounded-xl mt-4 flex flex-col sm:flex-row items-start sm:items-center justify-between text-left gap-4">
            <div>
              <span className="text-amber-400 text-[10px] uppercase font-semibold tracking-wider block">🔑 ИСПОЛЬЗОВАНИЕ ПРОМОКОДОВ PRO</span>
              <span className="text-2xl font-black text-amber-300 block mt-1 tracking-tight font-mono">{stats.totalPromoCount || 0} <span className="text-xs font-normal text-gray-400 uppercase">чел. активировали PRO статус</span></span>
            </div>
            <div className="text-[11px] text-gray-300 font-mono space-y-1 bg-black/40 p-2 px-3.5 rounded-lg border border-white/5">
              <div>Wolff ИИ: <span className="text-indigo-400 font-bold font-mono">{stats.wolffPromoCount || 0}</span></div>
              <div>Platform ИИ: <span className="text-emerald-400 font-bold font-mono">{stats.platformPromoCount || 0}</span></div>
            </div>
          </div>
        </div>

        {/* КАРТА АВТОПИНГА / СПАСЕНИЯ ОТ СОНЛИВОСТИ CLOUD RUN */}
        <div className="bg-[#0f0f14] border border-white/5 p-6 rounded-3xl mb-8">
          <div className="flex flex-col lg:flex-row items-stretch justify-between gap-6">
            
            {/* Левая часть: Статус и Телеметрия */}
            <div className="space-y-4 max-w-2xl text-left flex-1 flex flex-col justify-between">
              <div>
                <span className="px-2.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 text-[10px] font-bold tracking-wide border border-emerald-500/20 uppercase inline-block font-mono">
                  🟢 РАСШИРЕННЫЙ РЕЖИМ НЕУСЫПНОЙ РАБОТЫ (KEEP-AWAKE ENGINE)
                </span>
                <h3 className="text-sm font-black text-white mt-1.5 flex items-center gap-2">
                  <Zap className="w-4 h-4 text-emerald-400 animate-pulse" />
                  Автономия ботов & Защита от засыпания серверов Cloud Run
                </h3>
                <p className="text-gray-400 text-xs mt-1.5 leading-relaxed">
                  По умолчанию виртуальные серверы Google Cloud Run переводятся в спящий режим (Cpu Throttling / Scale to Zero) через 15 минут бездействия. Когда сервер засыпает, соединение с Telegram-ботом прерывается. Мы настроили систему <b>активного самообеспечения</b>, удерживающую процессы в горячем состоянии.
                </p>
              </div>

              {keepAwakeInfo && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
                  <div className="bg-black/40 border border-white/5 p-3 rounded-xl font-mono text-[11px] space-y-1">
                    <span className="text-gray-500 block text-[9px] uppercase tracking-wide">🔗 ТЕКУЩИЙ АДРЕС СЕРВЕРА</span>
                    <span className="text-gray-300 font-bold block truncate" title={keepAwakeInfo.lastKnownPublicUrl}>
                      {keepAwakeInfo.lastKnownPublicUrl || "Обнаружение..."}
                    </span>
                    <span className="text-[9px] text-zinc-500 block leading-tight">
                      *Авто-определяется при визите в админу.
                    </span>
                  </div>

                  <div className="bg-black/40 border border-white/5 p-3 rounded-xl font-mono text-[11px] space-y-1">
                    <span className="text-gray-500 block text-[9px] uppercase tracking-wide">⏱️ ПОСЛЕДНИЙ ВНУТРЕННИЙ САМО-ПИНГ</span>
                    <span className="text-emerald-400 font-bold block">
                      {keepAwakeInfo.lastPingTime ? `✅ Исполнен: ${keepAwakeInfo.lastPingTime}` : "⏳ Ожидание первого цикла..."}
                    </span>
                    <span className="text-[9px] text-zinc-500 block leading-tight">
                      Успешных само-вызовов: <span className="text-zinc-300 font-bold">{keepAwakeInfo.pingCount}</span> (каждые 90 сек)
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Правая часть: Чеклист для 100% гарантии */}
            <div className="lg:w-96 w-full text-left bg-black/35 border border-white/5 p-5 rounded-2xl flex flex-col justify-center space-y-3 shrink-0">
              <span className="text-amber-400 font-black font-sans uppercase tracking-wider text-[10.5px] block">
                🛡️ Чеклист 100% стабильности:
              </span>
              <ul className="space-y-2 text.xs text-gray-300 text-[11px] leading-relaxed">
                <li className="flex gap-2">
                  <span className="text-emerald-400 font-bold">1.</span>
                  <span>Внутренний <b>Keep-Awake агент</b> уже запущен на сервере и совершает обратные HTTPS-вызовы к себе для сброса таймера сна.</span>
                </li>
                <li className="flex gap-2 border-t border-white/5 pt-2">
                  <span className="text-indigo-400 font-bold">2.</span>
                  <span>Для гарантированной работы без сна 24/7 подключите бесплатный пингер на <b><a href="https://cron-job.org" target="_blank" rel="noopener noreferrer" className="text-indigo-400 underline hover:text-indigo-300 font-bold">cron-job.org</a></b> или <b><a href="https://uptimerobot.com" target="_blank" rel="noopener noreferrer" className="text-indigo-400 underline hover:text-indigo-300 font-bold">UptimeRobot</a></b> на этот URL: <br />
                  <code className="text-[10px] bg-black/60 px-1.5 py-1 rounded mt-1.5 inline-block text-indigo-300 select-all font-mono border border-indigo-500/10">
                    {keepAwakeInfo?.lastKnownPublicUrl || "https://ais-pre-crxcvc7jvjmvqgisciea2c-529864647051.europe-west1.run.app"}/api/health
                  </code><br />
                  установите интервал в 5 минут.</span>
                </li>
              </ul>
            </div>

          </div>
        </div>

        {/* ERRORS PANEL */}
        {errorChat && (
          <div className="mb-6 p-4 rounded-xl bg-red-950/20 border border-red-500/20 flex items-center justify-between gap-3 text-red-300 text-xs">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 shrink-0" />
              <span>{errorChat}</span>
            </div>
            <button onClick={fetchData} className="underline text-red-400 hover:text-red-300 font-semibold cursor-pointer">
              Повторить попытку
            </button>
          </div>
        )}

        {/* PROMO CODES ENGINE PANEL */}
        <PromoControls />

        {/* WORKSPACE COMBINED GRID OUTLINE */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          
          {/* USER DATABASE TABLE RAIL (LHS) */}
          <div className="lg:col-span-7 bg-[#0c0c0e] border border-white/10 rounded-2xl overflow-hidden shadow-xl">
            
            {/* Filter and Search Panel */}
            <div className="p-5 border-b border-white/10 bg-[#0e0e11] flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold text-white flex items-center gap-2">
                    <Users className="w-4.5 h-4.5 text-indigo-400" />
                    База данных всех пользователей
                  </h2>
                  <p className="text-[10px] text-gray-400 mt-0.5">Показано {sortedUsers.length} из {usersList.length} найденных записей</p>
                </div>
              </div>

              {/* Dynamic search bar */}
              <div className="relative">
                <Search className="w-4 h-4 text-gray-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input 
                  type="text"
                  placeholder="Поиск по Telegram Нику, Имени пользователя, или ID..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-black border border-white/5 focus:border-indigo-500 rounded-xl pl-10 pr-4 py-2.5 text-xs text-gray-200 outline-none transition-all placeholder:text-gray-500"
                />
              </div>

              {/* Filter pills block */}
              <div className="flex flex-wrap items-center gap-3 justify-between">
                
                {/* Bot platform source */}
                <div className="flex items-center gap-1.5 bg-black/40 p-1 rounded-lg border border-white/5">
                  <button 
                    onClick={() => setOriginFilter('all')}
                    className={`px-2.5 py-1 rounded text-[10px] font-bold transition-all cursor-pointer ${originFilter === 'all' ? 'bg-indigo-600/30 text-indigo-400 border border-indigo-500/10' : 'text-gray-400 hover:text-gray-200'}`}
                  >
                    Все боты
                  </button>
                  <button 
                    onClick={() => setOriginFilter('wolff')}
                    className={`px-2.5 py-1 rounded text-[10px] font-bold transition-all cursor-pointer ${originFilter === 'wolff' ? 'bg-indigo-600/30 text-indigo-400 border border-indigo-500/10' : 'text-gray-400 hover:text-gray-200'}`}
                  >
                    WolffAi/Angry
                  </button>
                  <button 
                    onClick={() => setOriginFilter('platform')}
                    className={`px-2.5 py-1 rounded text-[10px] font-bold transition-all cursor-pointer ${originFilter === 'platform' ? 'bg-emerald-600/30 text-emerald-400 border border-emerald-500/10' : 'text-gray-400 hover:text-gray-200'}`}
                  >
                    PlatformBot
                  </button>
                </div>

                {/* Sub status */}
                <div className="flex items-center gap-1.5 bg-black/40 p-1 rounded-lg border border-white/5">
                  <button 
                    onClick={() => setSubscriptionFilter('all')}
                    className={`px-2.5 py-1 rounded text-[10px] font-bold transition-all cursor-pointer ${subscriptionFilter === 'all' ? 'bg-white/15 text-white' : 'text-gray-400 hover:text-gray-200'}`}
                  >
                    Все тарифы
                  </button>
                  <button 
                    onClick={() => setSubscriptionFilter('premium')}
                    className={`px-2.5 py-1 rounded text-[10px] font-bold transition-all cursor-pointer ${subscriptionFilter === 'premium' ? 'bg-amber-600/30 text-amber-400 font-bold border border-amber-500/10' : 'text-gray-400 hover:text-white'}`}
                  >
                    💎 Премиум
                  </button>
                  <button 
                    onClick={() => setSubscriptionFilter('promo')}
                    className={`px-2.5 py-1 rounded text-[10px] font-bold transition-all cursor-pointer ${subscriptionFilter === 'promo' ? 'bg-amber-500/10 text-amber-550 border border-amber-500/20' : 'text-gray-400 hover:text-white'}`}
                  >
                    🏷️ Промокод
                  </button>
                  <button 
                    onClick={() => setSubscriptionFilter('free')}
                    className={`px-2.5 py-1 rounded text-[10px] font-bold transition-all cursor-pointer ${subscriptionFilter === 'free' ? 'bg-neutral-800 text-gray-300' : 'text-gray-400 hover:text-white'}`}
                  >
                    Бесплатные
                  </button>
                </div>

              </div>

              {/* Sorting tab bar */}
              <div className="flex items-center gap-2 text-[10px] text-gray-400 font-mono">
                <span className="uppercase tracking-wider">Сортировать по:</span>
                <button 
                  onClick={() => setSortBy('joined')}
                  className={`underline font-bold transition-all cursor-pointer ${sortBy === 'joined' ? 'text-indigo-400' : 'hover:text-white'}`}
                >
                  Дате подкл.
                </button>
                <span>|</span>
                <button 
                  onClick={() => setSortBy('messages')}
                  className={`underline font-bold transition-all cursor-pointer ${sortBy === 'messages' ? 'text-indigo-400' : 'hover:text-white'}`}
                >
                  Кол-ву сообщ.
                </button>
                <span>|</span>
                <button 
                  onClick={() => setSortBy('today')}
                  className={`underline font-bold transition-all cursor-pointer ${sortBy === 'today' ? 'text-indigo-400' : 'hover:text-white'}`}
                >
                  Нагрузке сегодня
                </button>
              </div>

            </div>

            {/* TABULAR DATALIST CONTAINER */}
            <div className="divide-y divide-white/5 overflow-y-auto max-h-[600px] bg-[#0c0c0e]">
              {loading && usersList.length === 0 ? (
                <div className="p-12 text-center text-gray-500 text-xs">
                  <RefreshCw className="w-8 h-8 mx-auto animate-spin mb-3 text-indigo-500" />
                  <span>Инициализация базы данных... Загрузка пользователей</span>
                </div>
              ) : sortedUsers.length === 0 ? (
                <div className="p-12 text-center text-gray-500 text-xs font-mono">
                  <span>Пользователи с такими параметрами не найдены.</span>
                </div>
              ) : (
                sortedUsers.map((u) => {
                  const isSelected = selectedUser?.id === u.id;
                  
                  return (
                    <div 
                      key={u.id}
                      onClick={() => triggerInspectUser(u)}
                      className={`p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 cursor-pointer transition-all ${
                        isSelected 
                          ? 'bg-indigo-600/5 border-l-4 border-indigo-500' 
                          : 'hover:bg-white/5 border-l-4 border-transparent'
                      }`}
                    >
                      {/* Left Block: Nickname + Avatar details */}
                      <div className="flex items-center gap-3 overflow-hidden">
                        {/* Colored identicon placeholder */}
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-mono font-bold text-xs shrink-0 select-none ${
                          u.isSubscribed 
                            ? 'bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-md' 
                            : u.origin === 'wolff'
                            ? 'bg-gradient-to-br from-indigo-900 to-indigo-950 text-indigo-300'
                            : 'bg-gradient-to-br from-emerald-950 to-emerald-900 text-emerald-300'
                        }`}>
                          {u.username ? u.username.slice(0, 2).toUpperCase() : u.firstName.slice(0, 2).toUpperCase()}
                        </div>

                        <div className="overflow-hidden">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-xs font-bold text-white truncate max-w-[140px]" title={u.firstName}>
                              {u.firstName}
                            </span>
                            {u.isSubscribed && (
                              <span className="bg-amber-400 text-black font-semibold text-[8px] px-1 rounded uppercase tracking-wider font-mono">
                                PRO 💎
                              </span>
                            )}
                            {u.promoUsed && (
                              <span className="bg-amber-500/10 text-amber-400 border border-amber-500/20 font-bold text-[8.5px] px-1 rounded font-mono" title={`Активировано кодом: ${u.promoUsed}`}>
                                🏷️ {u.promoUsed}
                              </span>
                            )}
                            {u.proRevoked && (
                              <span className="bg-red-500/10 text-red-400 border border-red-500/20 font-bold text-[8px] px-1.5 py-0.5 rounded uppercase font-mono" title="PRO-режим отключен за несоблюдение правил">
                                Ограничен ⚠️
                              </span>
                            )}
                            {u.adminNote && (
                              <span className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 font-bold text-[8.5px] px-1.5 py-0.5 rounded uppercase font-mono" title={`Псевдоним / Заметка: ${u.adminNote}`}>
                                📝 {u.adminNote}
                              </span>
                            )}
                          </div>
                          
                          {/* Username link to direct telegram conversation */}
                          <div className="flex items-center gap-1.5 mt-0.5">
                            {u.username ? (
                              <a 
                                href={`https://t.me/${u.username}`} 
                                target="_blank" 
                                rel="noopener noreferrer" 
                                onClick={(e) => e.stopPropagation()} 
                                className="text-[10.5px] text-indigo-400 hover:underline flex items-center gap-0.5 font-bold bg-indigo-500/5 px-1.5 py-0.5 rounded border border-indigo-500/10"
                                title="Перейти к профилю в Telegram"
                              >
                                @{u.username}
                                <ExternalLink className="w-2.5 h-2.5" />
                              </a>
                            ) : (
                              <a 
                                href={`tg://user?id=${u.rawId}`} 
                                target="_blank" 
                                rel="noopener noreferrer" 
                                onClick={(e) => e.stopPropagation()} 
                                className="text-[10.5px] text-zinc-400 hover:text-indigo-300 hover:underline flex items-center gap-0.5 font-mono bg-white/5 px-1.5 py-0.5 rounded border border-white/5"
                                title={`Открыть профиль Telegram напрямую по ID: ${u.rawId}`}
                              >
                                Скрытый ID 👤
                                <ExternalLink className="w-2.5 h-2.5" />
                              </a>
                            )}
                            <span className="text-gray-600 text-[10px] font-mono">|</span>
                            <span className="text-[9.5px] text-gray-400 font-mono" title="Нажмите, чтобы скопировать ID">
                              ID: {u.rawId}
                            </span>
                            <button 
                              onClick={(e) => { e.stopPropagation(); copyToClipboard(u.rawId); }}
                              className="text-gray-500 hover:text-white p-0.5"
                              title="Копировать ID"
                            >
                              <Copy className="w-2.5 h-2.5" />
                            </button>
                            {copiedId === u.rawId && (
                              <span className="text-[8px] bg-emerald-500/25 text-emerald-400 font-mono px-1 rounded">Ok</span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Middle: Bot and Model badge info */}
                      <div className="flex md:flex-col items-start gap-1 pb-1 md:pb-0 shrink-0 font-mono">
                        <div className="flex items-center gap-1">
                          <div className={`w-1.5 h-1.5 rounded-full ${u.origin === 'wolff' ? 'bg-indigo-500' : 'bg-emerald-500'}`}></div>
                          <span className="text-[10px] text-gray-300 font-bold">
                            {u.origin === 'wolff' ? 'Wolff/Angry' : 'PlatformBot'}
                          </span>
                        </div>
                        <span className="text-[9px] text-gray-400 max-w-[130px] truncate" title={u.activeModelOrMode}>
                          Mode: {u.activeModelOrMode.replace(':free', '')}
                        </span>
                      </div>

                      {/* Right side controls: Toggle Premium & Metrics count */}
                      <div className="flex items-center gap-4 ml-auto md:ml-0">
                        {/* Messages Counter count */}
                        <div className="text-right shrink-0">
                          <span className="text-[11px] font-bold text-gray-200 block font-mono">
                            {u.totalMessagesCount} сообщ.
                          </span>
                          <span className="text-[9px] text-indigo-400 font-semibold block font-mono">
                            +{u.messagesToday} сегодня
                          </span>
                        </div>

                        {/* Interactive toggle block */}
                        <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => handleToggleSubscription(u)}
                            disabled={toggleLoading === u.id}
                            className={`p-1.5 px-2.5 rounded-lg text-[10px] font-mono font-bold uppercase transition-all cursor-pointer flex items-center gap-1 ${
                              u.isSubscribed
                                ? 'bg-amber-400 text-black hover:bg-amber-300'
                                : 'bg-[#1e1e24] hover:bg-neutral-800 text-gray-400 hover:text-white'
                            }`}
                            title={u.isSubscribed ? "Удалить премиум лицензию" : "Выдать бесконечную лицензию"}
                          >
                            {toggleLoading === u.id ? (
                              <RefreshCw className="w-3 h-3 animate-spin" />
                            ) : u.isSubscribed ? (
                              <>
                                <span>Premium</span>
                              </>
                            ) : (
                              <>
                                <span>Free</span>
                              </>
                            )}
                          </button>

                          <button
                            onClick={() => {
                              if (confirm(`Вы уверены, что хотите принудительно отключить PRO-режим за нарушение правил для пользователя ${u.firstName} (@${u.username || u.rawId})? В чате ИИ бота отобразится сообщение о нарушении.`)) {
                                handleToggleSubscription(u, true);
                              }
                            }}
                            disabled={toggleLoading === u.id}
                            className={`p-1.5 rounded-lg border text-[10px] uppercase font-mono font-bold transition-all cursor-pointer flex items-center justify-center shrink-0 ${
                              u.proRevoked
                                ? 'bg-red-500/10 border-red-500/30 text-red-400'
                                : 'border-neutral-800 text-gray-500 hover:bg-red-950/20 hover:text-red-400'
                            }`}
                            title={u.proRevoked ? "Доступ уже ограничен за нарушение правил" : "Отключить PRO статус за нарушение правил"}
                          >
                            <ShieldAlert className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <ChevronRight className={`w-4 h-4 text-gray-600 transition-transform hidden md:block ${isSelected ? 'translate-x-1 text-white' : ''}`} />
                      </div>

                    </div>
                  );
                })
              )}
            </div>

          </div>

          {/* CHAT LOGS AND DEEP DIALOG INSPECTOR RAIL (RHS) */}
          <div id="dialog-inspector" className="lg:col-span-5 bg-[#0c0c0e] border border-white/10 rounded-2xl overflow-hidden shadow-2xl flex flex-col h-[770px]">
            
            {/* Header inspect details */}
            <div className="p-5 border-b border-white/10 bg-[#0e0e11] flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-indigo-400 font-mono font-bold tracking-widest uppercase block">
                  🔍 ИНСПЕКТОР СЕССИЙ & ДИАЛОГОВ
                </span>
                {selectedUser && (
                  <button 
                    onClick={() => setSelectedUser(null)}
                    className="p-1 text-gray-500 hover:text-white hover:bg-white/5 rounded-lg transition-colors cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {selectedUser ? (
                <div className="space-y-4">
                  {/* Basic information */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                    <div>
                      <h3 className="text-sm font-black text-white flex items-center gap-2">
                        {selectedUser.firstName}
                        <span className="text-[10px] font-mono bg-indigo-500/10 text-indigo-300 font-normal border border-indigo-500/20 rounded px-1.5 py-0.5">
                          {selectedUser.chatsCount} сессий
                        </span>
                      </h3>
                      <div className="text-[11px] text-gray-400 flex items-center gap-1.5 mt-0.5">
                        <span>Рег: {new Date(selectedUser.joinedAt).toLocaleDateString()}</span>
                        <span>•</span>
                        <span>Актив: {selectedUser.lastActive}</span>
                      </div>
                    </div>

                    {/* Telegram deep link resolution */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      {selectedUser.username ? (
                        <a 
                          href={`https://t.me/${selectedUser.username}`} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-[10px] font-extrabold uppercase font-mono tracking-wider flex items-center gap-1 transition-all"
                        >
                          <ExternalLink className="w-3 h-3" />
                          @{selectedUser.username}
                        </a>
                      ) : (
                        <a 
                          href={`tg://user?id=${selectedUser.rawId}`} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="px-2.5 py-1.5 bg-zinc-800 hover:bg-neutral-700 text-gray-200 rounded-lg text-[10px] font-extrabold uppercase font-mono tracking-wider flex items-center gap-1 transition-all"
                          title="Открыть диалог в Telegram напрямую по ID"
                        >
                          <ExternalLink className="w-3 h-3" />
                          Чат Telegram 👤
                        </a>
                      )}
                    </div>
                  </div>

                  {/* PRO Status and Promo badges */}
                  <div className="bg-black/50 p-3 rounded-xl border border-white/5 space-y-2">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-gray-400">Статус Premium:</span>
                      {selectedUser.isSubscribed ? (
                        <span className="bg-amber-400/10 text-amber-300 border border-amber-500/20 px-2 py-0.5 rounded font-black font-mono">
                          💎 PRO АКТИВЕН
                        </span>
                      ) : (
                        <span className="bg-neutral-800 text-gray-500 px-2 py-0.5 rounded font-bold font-mono">
                          👤 БАЗОВЫЙ (FREE)
                        </span>
                      )}
                    </div>

                    {selectedUser.promoUsed && (
                      <div className="flex items-center justify-between text-[11px] border-t border-white/5 pt-2">
                        <span className="text-gray-400">Способ активации PRO:</span>
                        <span className="text-amber-400 font-mono font-bold bg-amber-500/5 px-2 py-0.5 rounded border border-amber-500/10">
                          🏷️ ПРОМОКОД: {selectedUser.promoUsed}
                        </span>
                      </div>
                    )}

                    {selectedUser.proRevoked && (
                      <div className="flex items-center justify-between text-[11px] border-t border-white/5 pt-2">
                        <span className="text-red-400 font-bold uppercase text-[10px]">Ограничен:</span>
                        <span className="bg-red-500/10 text-red-400 border border-red-500/20 px-2 py-0.5 rounded font-bold font-mono text-[9px] uppercase">
                          ⚠️ Блокировка за нарушение
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Manual Administrative Controls */}
                  <div className="grid grid-cols-2 gap-2 text-left bg-black/35 p-3 rounded-xl border border-white/5">
                    <div className="col-span-2 text-[9px] text-zinc-500 uppercase tracking-widest font-bold mb-1">
                      ⚙️ ПАНЕЛЬ УПРАВЛЕНИЯ ЛИЦЕНЗИЕЙ
                    </div>

                    {/* Manual PRO Toggle Button */}
                    <button
                      onClick={() => handleToggleSubscription(selectedUser)}
                      disabled={toggleLoading === selectedUser.id}
                      className={`px-3 py-2 rounded-lg border text-[10px] uppercase font-mono font-black tracking-wider transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                        selectedUser.isSubscribed
                          ? 'bg-amber-500/10 border-amber-500/30 text-amber-400 hover:bg-amber-200 hover:text-black hover:border-transparent'
                          : 'bg-indigo-600 hover:bg-indigo-500 border-indigo-500 text-white'
                      }`}
                    >
                      {toggleLoading === selectedUser.id ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : selectedUser.isSubscribed ? (
                        <>📴 Отключить PRO</>
                      ) : (
                        <>💎 Включить PRO</>
                      )}
                    </button>

                    {/* Rule break block / Restorer */}
                    <button
                      onClick={() => {
                        if (selectedUser.proRevoked) {
                          handleToggleSubscription(selectedUser); // clears proRevoked
                        } else {
                          if (confirm(`Вы уверены, что хотите заблокировать PRO-режим за нарушение правил для ${selectedUser.firstName}?`)) {
                            handleToggleSubscription(selectedUser, true);
                          }
                        }
                      }}
                      disabled={toggleLoading === selectedUser.id}
                      className={`px-3 py-2 rounded-lg border text-[10px] uppercase font-mono font-black tracking-wider transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                        selectedUser.proRevoked
                          ? 'bg-green-600/10 border-green-500/30 text-green-400 hover:bg-green-600/20'
                          : 'bg-red-500/10 border-red-500/25 text-red-400 hover:bg-red-500/20'
                      }`}
                    >
                      {toggleLoading === selectedUser.id ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : selectedUser.proRevoked ? (
                        <>✅ Разблокировать</>
                      ) : (
                        <>🚨 Ограничить</>
                      )}
                    </button>
                  </div>

                  {/* Custom Nickname Note Editor */}
                  <div className="bg-black/35 p-3 rounded-xl border border-white/5 space-y-1.5">
                    <span className="text-[9.5px] text-zinc-500 uppercase tracking-widest font-bold block">
                      🖋️ ЗАМЕТКА / СВОЙ ПСЕВДОНИМ АДМИНА
                    </span>
                    <div className="flex gap-1.5">
                      <input 
                        type="text"
                        placeholder="Напр. Вадим (Владелец), Спамер..."
                        value={noteEditVal}
                        onChange={(e) => setNoteEditVal(e.target.value)}
                        className="flex-1 bg-black/60 border border-white/5 focus:border-indigo-500 rounded-lg px-2.5 py-1.5 text-xs text-gray-200 outline-none placeholder:text-gray-600 font-mono"
                      />
                      <button
                        onClick={() => handleSaveNote(selectedUser, noteEditVal)}
                        disabled={noteSaving}
                        className="bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs px-3 py-1.5 rounded-lg font-mono transition-all flex items-center gap-1 cursor-pointer"
                      >
                        {noteSaving ? (
                          <RefreshCw className="w-3 h-3 animate-spin" />
                        ) : (
                          <>ОК</>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div>
                  <h3 className="text-xs text-gray-400 font-mono">
                    Выберите пользователя из списка слева, чтобы начать мониторинг его чат-сессий в реальном времени.
                  </h3>
                </div>
              )}
            </div>

            {/* Split layout: sessions tree & active conversation content */}
            {selectedUser ? (
              <div className="flex-1 flex flex-col overflow-hidden divide-y divide-white/5">
                
                {/* Horizontal / Selection bar of Chat Threads */}
                <div className="bg-black/30 p-2.5 flex gap-1.5 overflow-x-auto min-h-[50px] items-center shrink-0">
                  <span className="text-[9px] text-gray-500 font-mono tracking-wider uppercase shrink-0 mr-1">Темы:</span>
                  {selectedUser.chats && selectedUser.chats.length > 0 ? (
                    selectedUser.chats.map((c, i) => {
                      const isActive = activeInspectChat?.name === c.name && activeInspectChat?.bot === c.bot;
                      return (
                        <button
                          key={i}
                          onClick={() => setActiveInspectChat(c)}
                          className={`px-3 py-1.5 rounded-lg text-[10.5px] font-mono font-semibold transition-all flex items-center gap-1 cursor-pointer shrink-0 ${
                            isActive
                              ? 'bg-indigo-600 border border-indigo-500 text-white'
                              : 'bg-white/5 text-gray-400 hover:text-white border border-transparent'
                          }`}
                        >
                          <MessageSquare className="w-3 h-3" />
                          <span>{c.name}</span>
                          <span className="bg-black/40 text-[9px] px-1 rounded text-gray-300">{c.messagesCount}</span>
                        </button>
                      );
                    })
                  ) : (
                    <span className="text-[10px] text-gray-500 italic font-mono">Активных диалогов нет</span>
                  )}
                </div>

                {/* Main conversation message history box */}
                <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3.5 bg-black/10">
                  {activeInspectChat && activeInspectChat.history && activeInspectChat.history.length > 0 ? (
                    activeInspectChat.history.map((msg, idx) => {
                      // Detect sender code
                      const isModel = msg.role === 'model' || msg.role === 'assistant';
                      const senderLabel = isModel 
                        ? activeInspectChat.bot 
                        : (selectedUser.username ? `@${selectedUser.username}` : selectedUser.firstName);

                      return (
                        <div 
                          key={idx} 
                          className={`flex flex-col max-w-[90%] ${!isModel ? 'self-end items-end' : 'self-start items-start'}`}
                        >
                          <span className="text-[9px] text-gray-500 font-mono mb-1 mx-1.5 tracking-wider uppercase">
                            {senderLabel}
                          </span>

                          <div className={`p-3.5 rounded-2xl text-xs leading-relaxed ${
                            !isModel
                              ? 'bg-indigo-950/80 border border-indigo-500/20 text-indigo-100 rounded-tr-none'
                              : activeInspectChat.bot === 'AngryAI'
                              ? 'bg-red-950/10 border border-red-900/10 text-red-200 rounded-tl-none'
                              : 'bg-[#15151b] border border-white/5 text-gray-200 rounded-tl-none'
                          }`}>
                            {renderMessageContent(msg)}
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="m-auto text-center p-8 text-gray-500 text-xs font-mono">
                      <HelpCircle className="w-8 h-8 mx-auto mb-2 text-gray-600" />
                      <span>Выберите один из запущенных диалогов пользователя выше, чтобы увидеть лог сообщений.</span>
                    </div>
                  )}
                </div>

                {/* Ticker footer info */}
                <div className="p-3.5 bg-[#0e0e11] text-[10px] text-gray-500 font-mono border-t border-white/10 flex justify-between items-center shrink-0">
                  <span>Облачный статус: СБЕКАПЛЕНО</span>
                  <span className="text-indigo-400">ID сессии: {selectedUser.id}</span>
                </div>

              </div>
            ) : (
              <div className="flex-1 flex flex-col justify-center items-center p-8 text-center bg-black/10">
                <div className="w-16 h-16 rounded-full bg-indigo-500/5 flex items-center justify-center border border-indigo-500/10 mb-4 animate-bounce">
                  <Shield className="w-8 h-8 text-indigo-400" />
                </div>
                <h4 className="text-sm font-bold text-white mb-1">Ожидание выбора пользователя</h4>
                <p className="text-xs text-gray-500 max-w-[280px] leading-relaxed">
                  Нажмите на любого пользователя в левом реестре баз данных, чтобы получить выписку его сессий, аналитику нагрузки и полный лог телеграм переписки.
                </p>
              </div>
            )}

          </div>

        </div>

      </main>
    </div>
  );
}
