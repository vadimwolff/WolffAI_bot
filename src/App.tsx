import React, { useEffect, useState, useRef } from 'react';
import { 
  Bot, Zap, Users, Shield, ArrowRight, Flame, Send, Trash2, 
  Sparkles, Cpu, Globe, Lock, ExternalLink, Paperclip, X, 
  LogIn, LogOut, Plus, MessageSquare, Image, Loader2, KeyRound, Mail, UserCheck
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  auth, googleAuthProvider, signInWithPopup, 
  signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut 
} from './lib/firebase.ts';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';

interface Message {
  sender: 'user' | 'bot';
  text: string;
  timestamp: string;
  isError?: boolean;
}

interface CloudChat {
  id: string;
  name: string;
  mode: string;
  model: string;
  history: any[];
  updatedAt?: string;
}

export default function App() {
  const [stats, setStats] = useState({ totalUsers: 0, botActive: false, angryBotActive: false, platformBotActive: false });
  const [activeBot, setActiveBot] = useState<'wolff' | 'angry' | 'platform'>('wolff');
  const [sessionId, setSessionId] = useState('');
  
  // Chat History
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  
  // File Upload states
  const [selectedFiles, setSelectedFiles] = useState<Array<{ name: string; mimeType: string; base64: string }>>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);
  const [isDragging, setIsDragging] = useState(false);

  // Authentication states
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  // Bot Options States
  const [wolffMode, setWolffMode] = useState<'fast' | 'thinking' | 'search'>('fast');
  const [platformModel, setPlatformModel] = useState('gemini-3.1-flash-lite');
  const [platformModelName, setPlatformModelName] = useState('Gemini 3.1 Flash-Lite');
  const [modelsList, setModelsList] = useState<Array<{ id: string; name: string; desc: string; multimodal: boolean }>>([]);
  const [limitStatus, setLimitStatus] = useState<string>('');

  // Sessional and Cloud-sync states
  const [chats, setChats] = useState<Record<string, CloudChat>>({});
  const [currentChatId, setCurrentChatId] = useState<string>('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Ensure scroll position is immediately at the top of the viewport on loading
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // Initialize Session Id
  useEffect(() => {
    let sid = localStorage.getItem('wolffai_session_id');
    if (!sid) {
      sid = 'web_' + Math.random().toString(36).substring(2, 11);
      localStorage.setItem('wolffai_session_id', sid);
    }
    setSessionId(sid);
  }, []);

  // Track Firebase Authentication changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (usr) => {
      if (usr) {
        setCurrentUser(usr);
        const token = await usr.getIdToken();
        setAuthToken(token);
        
        // Sync user registry on the backend
        try {
          await fetch('/api/auth/sync-user', {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            }
          });
        } catch (err) {
          console.error("Failed to sync authenticated user: ", err);
        }
      } else {
        setCurrentUser(null);
        setAuthToken(null);
        setChats({});
        setCurrentChatId('');
      }
    });
    return () => unsubscribe();
  }, []);

  // Fetch initial stats
  useEffect(() => {
    fetch('/api/stats')
      .then(res => res.json())
      .then(data => setStats(data))
      .catch(console.error);
    
    // Fetch Platform models list
    fetch('/api/chat/platform/models')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) setModelsList(data);
      })
      .catch(console.error);
  }, []);

  // Fetch chats list (Cloud-synced or Local) in response to authentication & active bot changes
  useEffect(() => {
    if (authToken && currentUser) {
      fetchCloudChats();
    } else {
      loadLocalChats();
    }
  }, [activeBot, authToken]);

  // Handle messages automatic auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const loadLocalChats = () => {
    const localSessKey = `local_chats_${activeBot}`;
    const saved = localStorage.getItem(localSessKey);
    let parsedChats: Record<string, CloudChat> = {};
    if (saved) {
      try { parsedChats = JSON.parse(saved); } catch (e) {}
    }

    if (Object.keys(parsedChats).length === 0) {
      const defaultId = 'chat_' + Date.now().toString(36);
      parsedChats[defaultId] = {
        id: defaultId,
        name: "Главный диалог",
        mode: activeBot === 'wolff' ? 'fast' : 'default',
        model: activeBot === 'platform' ? 'gemini-3.1-flash-lite' : 'default',
        history: []
      };
    }
    setChats(parsedChats);
    
    const lastActiveId = localStorage.getItem(`active_chat_${activeBot}`) || Object.keys(parsedChats)[0];
    const targetId = parsedChats[lastActiveId] ? lastActiveId : Object.keys(parsedChats)[0];
    setCurrentChatId(targetId);
    
    renderHistoryForChat(parsedChats[targetId]);
  };

  const fetchCloudChats = async () => {
    if (!authToken) return;
    try {
      const res = await fetch(`/api/chats?botType=${activeBot}`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (res.ok) {
        const chatsList: any[] = await res.json();
        const parsedChats: Record<string, CloudChat> = {};
        
        chatsList.forEach((c: any) => {
          parsedChats[c.id] = {
            id: c.id,
            name: c.name,
            mode: c.mode,
            model: c.model,
            history: c.history || []
          };
        });

        if (Object.keys(parsedChats).length === 0) {
          const defaultId = 'chat_' + Date.now().toString(36);
          parsedChats[defaultId] = {
            id: defaultId,
            name: "Облачный диалог 1",
            mode: activeBot === 'wolff' ? 'fast' : 'default',
            model: activeBot === 'platform' ? 'gemini-3.1-flash-lite' : 'default',
            history: []
          };
          // Save default cloud session immediately
          await syncChatToCloud(parsedChats[defaultId]);
        }
        
        setChats(parsedChats);
        const lastActiveId = localStorage.getItem(`active_chat_${activeBot}_cloud`) || Object.keys(parsedChats)[0];
        const targetId = parsedChats[lastActiveId] ? lastActiveId : Object.keys(parsedChats)[0];
        setCurrentChatId(targetId);
        
        renderHistoryForChat(parsedChats[targetId]);
      }
    } catch (err) {
      console.error("Failed fetching saved cloud sessions: ", err);
      loadLocalChats();
    }
  };

  const syncChatToCloud = async (c: CloudChat) => {
    if (!authToken) return;
    try {
      await fetch('/api/chats/sync', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}` 
        },
        body: JSON.stringify({
          chatId: c.id,
          botType: activeBot,
          name: c.name,
          mode: c.mode,
          model: c.model,
          history: c.history
        })
      });
    } catch (err) {
      console.error("Cloud SQL sync failed: ", err);
    }
  };

  const renderHistoryForChat = (selectedChat?: CloudChat) => {
    if (!selectedChat) {
      setMessages([]);
      return;
    }
    
    // Set bot preference modes
    if (activeBot === 'wolff') {
      setWolffMode((selectedChat.mode as any) || 'fast');
    } else if (activeBot === 'platform') {
      setPlatformModel(selectedChat.model || 'gemini-3.1-flash-lite');
      const found = modelsList.find(m => m.id === selectedChat.model);
      if (found) setPlatformModelName(found.name);
    }

    const historyList: Message[] = [];
    if (Array.isArray(selectedChat.history)) {
      selectedChat.history.forEach((h: any) => {
        const sender = h.role === 'user' ? 'user' : 'bot';
        let text = '';
        if (typeof h.content === 'string') {
          text = h.content;
        } else if (Array.isArray(h.content)) {
          const textPart = h.content.find((p: any) => p.type === 'text');
          text = textPart ? textPart.text : '';
        } else if (Array.isArray(h.parts)) {
          const textPart = h.parts.find((p: any) => p.text);
          text = textPart ? textPart.text : '';
        }
        if (text) {
          historyList.push({ 
            sender, 
            text, 
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
          });
        }
      });
    }

    if (historyList.length === 0) {
      // Append matching default welcome greeting 
      if (activeBot === 'wolff') {
        historyList.push({
          sender: 'bot',
          text: '👋 Привет! Я **WolffAi** — ваш вежливый, интеллектуальный ИИ-ассистент на сайте. Выберите режим работы выше и напишите свой запрос! 👇',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
        });
      } else if (activeBot === 'angry') {
        historyList.push({
          sender: 'bot',
          text: '😡 Ну чего тебе? Я **AngryAI**. Не надейся на вежливость — я здесь для жесткого сноса твоего завышенного самомнения. Будет больно, но зато правдиво. Пиши свой глупый вопрос, кожаный мешок! 👇',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
        });
      } else {
        historyList.push({
          sender: 'bot',
          text: '⚡️ Добро пожаловать на **WolffAIPlatform**! Меняйте активные ИИ-модели мира в списке настроек. Я поддерживаю Llama 3.3, Hermes-3, Gemma-2 и многие другие нейросети! 👇',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
        });
      }
    }
    setMessages(historyList);
  };

  const createNewChat = async () => {
    const newId = 'chat_' + Date.now().toString(36);
    const newChat: CloudChat = {
      id: newId,
      name: `Диалог ${Object.keys(chats).length + 1}`,
      mode: activeBot === 'wolff' ? wolffMode : 'default',
      model: activeBot === 'platform' ? platformModel : 'default',
      history: []
    };

    const updatedChats = { ...chats, [newId]: newChat };
    setChats(updatedChats);
    setCurrentChatId(newId);
    setMessages([]);
    renderHistoryForChat(newChat);

    if (authToken && currentUser) {
      localStorage.setItem(`active_chat_${activeBot}_cloud`, newId);
      await syncChatToCloud(newChat);
    } else {
      localStorage.setItem(`local_chats_${activeBot}`, JSON.stringify(updatedChats));
      localStorage.setItem(`active_chat_${activeBot}`, newId);
    }
  };

  const selectChat = (cId: string) => {
    setCurrentChatId(cId);
    if (authToken && currentUser) {
      localStorage.setItem(`active_chat_${activeBot}_cloud`, cId);
    } else {
      localStorage.setItem(`active_chat_${activeBot}`, cId);
    }
    renderHistoryForChat(chats[cId]);
  };

  const deleteChatHandler = async (cId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    if (Object.keys(chats).length <= 1) {
      alert("Нельзя удалить единственный чат.");
      return;
    }
    if (!confirm("Вы уверены, что хотите полностью удалить этот чат?")) return;

    const remainingChats = { ...chats };
    delete remainingChats[cId];

    let nextCId = currentChatId;
    if (currentChatId === cId) {
      nextCId = Object.keys(remainingChats)[0];
    }

    setChats(remainingChats);
    setCurrentChatId(nextCId);
    renderHistoryForChat(remainingChats[nextCId]);

    if (authToken && currentUser) {
      localStorage.setItem(`active_chat_${activeBot}_cloud`, nextCId);
      try {
        await fetch('/api/chats/delete', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}` 
          },
          body: JSON.stringify({ chatId: cId })
        });
      } catch (err) {
        console.error("Cloud SQL delete failed: ", err);
      }
    } else {
      localStorage.setItem(`local_chats_${activeBot}`, JSON.stringify(remainingChats));
      localStorage.setItem(`active_chat_${activeBot}`, nextCId);
    }
  };

  const changeWolffMode = async (mode: 'fast' | 'thinking' | 'search') => {
    setWolffMode(mode);
    const updatedChats = { ...chats };
    if (updatedChats[currentChatId]) {
      updatedChats[currentChatId].mode = mode;
      setChats(updatedChats);
      if (authToken) {
        await syncChatToCloud(updatedChats[currentChatId]);
      } else {
        localStorage.setItem(`local_chats_${activeBot}`, JSON.stringify(updatedChats));
      }
    }
    try {
      await fetch('/api/chat/wolff/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, mode })
      });
    } catch (e) {
      console.error(e);
    }
  };

  const changePlatformModel = async (modelId: string) => {
    setPlatformModel(modelId);
    const item = modelsList.find(m => m.id === modelId);
    if (item) setPlatformModelName(item.name);

    const updatedChats = { ...chats };
    if (updatedChats[currentChatId]) {
      updatedChats[currentChatId].model = modelId;
      setChats(updatedChats);
      if (authToken) {
        await syncChatToCloud(updatedChats[currentChatId]);
      } else {
        localStorage.setItem(`local_chats_${activeBot}`, JSON.stringify(updatedChats));
      }
    }

    try {
      const res = await fetch('/api/chat/platform/set-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, modelId })
      });
      if (res.ok) {
        const statusRes = await fetch(`/api/chat/platform/status?sessionId=${sessionId}`);
        if (statusRes.ok) {
          const sData = await statusRes.json();
          if (sData.limitCheck) {
            setLimitStatus(sData.isSubscribed ? 'Премиум Безлимит' : `${sData.limitCheck.current} / ${sData.limitCheck.limit} запр.`);
          }
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  const clearChat = async () => {
    if (!confirm('Вы действительно хотите очистить контекст этого диалога?')) return;
    try {
      let url = '';
      if (activeBot === 'wolff') url = '/api/chat/wolff/clear';
      else if (activeBot === 'angry') url = '/api/chat/angry/clear';
      else if (activeBot === 'platform') url = '/api/chat/platform/clear';

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId })
      });
      if (res.ok) {
        const updatedChats = { ...chats };
        if (updatedChats[currentChatId]) {
          updatedChats[currentChatId].history = [];
          setChats(updatedChats);
          if (authToken) {
            await syncChatToCloud(updatedChats[currentChatId]);
          } else {
            localStorage.setItem(`local_chats_${activeBot}`, JSON.stringify(updatedChats));
          }
        }
        setMessages([]);
        renderHistoryForChat(updatedChats[currentChatId]);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Drag and drop attachment functions
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounterRef.current = 0;
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files);
    }
  };

  const triggerFileSelect = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(e.target.files);
    }
  };

  const processFiles = (files: FileList) => {
    Array.from(files).forEach((file) => {
      if (file.size > 8 * 1024 * 1024) {
        alert(`Файл "${file.name}" превышает максимальный размер 8MB.`);
        return;
      }
      
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64Data = (reader.result as string).split(',')[1];
        setSelectedFiles(prev => [
          ...prev, 
          { name: file.name, mimeType: file.type || 'image/png', base64: base64Data }
        ]);
      };
      reader.readAsDataURL(file);
    });
  };

  const removeFileAttachment = (idx: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== idx));
  };

  const loadChatStatusAndHistory = async () => {
    // Loaded dynamically via the Auth/Region sync hooks
  };

  const sendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if ((!inputText.trim() && selectedFiles.length === 0) || isLoading) return;

    const userText = inputText;
    const attachmentsToSend = [...selectedFiles];
    
    setInputText('');
    setSelectedFiles([]);
    
    setMessages(prev => [...prev, {
      sender: 'user',
      text: userText + (attachmentsToSend.length > 0 ? ` [Отправлено файлов: ${attachmentsToSend.length}]` : ''),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }]);
    setIsLoading(true);

    try {
      let url = '';
      if (activeBot === 'wolff') url = '/api/chat/wolff';
      else if (activeBot === 'angry') url = '/api/chat/angry';
      else if (activeBot === 'platform') url = '/api/chat/platform/message';

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          sessionId, 
          message: userText || "Посмотри на вложение.",
          attachments: attachmentsToSend
        })
      });

      if (res.ok) {
        const data = await res.json();
        setMessages(prev => [...prev, {
          sender: 'bot',
          text: data.replyText,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }]);

        // Push dialogue changes to Cloud SQL or Local
        const finalHistory = data.history || [];
        const updatedChats = { ...chats };
        if (updatedChats[currentChatId]) {
          updatedChats[currentChatId].history = finalHistory;
          setChats(updatedChats);
          if (authToken) {
            await syncChatToCloud(updatedChats[currentChatId]);
          } else {
            localStorage.setItem(`local_chats_${activeBot}`, JSON.stringify(updatedChats));
          }
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        setMessages(prev => [...prev, {
          sender: 'bot',
          isError: true,
          text: `⚠️ Ошибка взаимодействия с ИИ: ${errData.error || 'Сервер временно недоступен.'}`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }]);
      }
    } catch (e) {
      console.error(e);
      setMessages(prev => [...prev, {
        sender: 'bot',
        isError: true,
        text: '❌ Локальный сетевой сбой при отправлении запроса.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authEmail || !authPassword) {
      setAuthError('Пожалуйста, заполните необходимые поля.');
      return;
    }
    setAuthLoading(true);
    setAuthError('');
    try {
      if (authMode === 'login') {
        await signInWithEmailAndPassword(auth, authEmail, authPassword);
      } else {
        await createUserWithEmailAndPassword(auth, authEmail, authPassword);
      }
      setShowAuthModal(false);
      setAuthEmail('');
      setAuthPassword('');
    } catch (err: any) {
      console.error(err);
      setAuthError(err.message || 'Ошибка аутентификации. Проверьте пароль.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    try {
      setAuthLoading(true);
      await signInWithPopup(auth, googleAuthProvider);
      setShowAuthModal(false);
    } catch (err: any) {
      console.error(err);
      setAuthError(err.message || 'Сбой Google Auth.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    if (confirm("Вы хотите выйти из аккаунта? Облачные чаты перестанут отображаться.")) {
      await signOut(auth);
    }
  };

  const scrollToChat = (botId: 'wolff' | 'angry' | 'platform') => {
    setActiveBot(botId);
    const element = document.getElementById('chat-arena-section');
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  function renderMessageText(text: string) {
    if (!text) return '';
    
    let cleanedText = text
      .replace(/🤫 <i>Устал от моей токсичности?[\s\S]*$/, '')
      .replace(/🤖 <i>Слишком грубо для твоих чувств?[\s\S]*$/, '')
      .replace(/🕊️ <i>Если тебе срочно нужна порция[\s\S]*$/, '')
      .replace(/🤐 <i>Надоел мой тяжелый характер?[\s\S]*$/, '')
      .replace(/🌟 <i>Психологическая травма близка?[\s\S]*$/, '')
      .replace(/\n\n---\n💎 Подключить PRO: \/buy\n🔗 Реферальная программа: \/referral/g, '')
      .replace(/\n\n--- 💎 \/buy \| 🔗 \/referral/g, '');

    let escaped = cleanedText
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    escaped = escaped.replace(/```([\s\S]*?)```/g, '<pre class="bg-black/50 text-emerald-400 font-mono text-xs md:text-sm p-4 rounded-xl my-3 overflow-x-auto border border-white/5 whitespace-pre-wrap">$1</pre>');
    escaped = escaped.replace(/`([^`]+)`/g, '<code class="bg-[#181818] text-[#F3F4F6] px-1.5 py-0.5 rounded font-mono text-xs md:text-sm border border-white/5">$1</code>');
    escaped = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    escaped = escaped.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    escaped = escaped.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-indigo-400 font-semibold underline hover:text-indigo-300">$1 ↗</a>');
    escaped = escaped.replace(/\n/g, '<br/>');

    return <span dangerouslySetInnerHTML={{ __html: escaped }} />;
  }

  return (
    <div 
      className="min-h-screen bg-[#070709] text-gray-100 font-sans selection:bg-indigo-600 selection:text-white pb-20 overflow-x-hidden relative"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* GLOWING BACKGROUND ORBS */}
      <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-indigo-900/10 rounded-full blur-[120px] pointer-events-none"></div>
      <div className="absolute top-[30%] right-10 w-[400px] h-[400px] bg-red-950/10 rounded-full blur-[140px] pointer-events-none"></div>
      <div className="absolute bottom-[20%] left-10 w-[450px] h-[450px] bg-emerald-950/5 rounded-full blur-[110px] pointer-events-none"></div>

      {/* DRAG OVERLAY */}
      <AnimatePresence>
        {isDragging && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-indigo-950/80 backdrop-blur-md z-50 flex flex-col items-center justify-center border-4 border-dashed border-indigo-500 m-4 rounded-3xl"
          >
            <div className="bg-black/40 p-8 rounded-3xl flex flex-col items-center gap-4 border border-white/10 shadow-2xl">
              <div className="w-16 h-16 bg-indigo-600 rounded-full flex items-center justify-center animate-bounce">
                <Paperclip className="w-8 h-8 text-white" />
              </div>
              <h2 className="text-2xl font-bold">Переместите сюда файлы</h2>
              <p className="text-gray-400 text-sm">Поддерживаются картинки и фотографии до 8MB</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* HEADER NAVBAR */}
      <nav className="relative z-10 flex flex-col sm:flex-row items-center justify-between px-6 py-6 max-w-7xl mx-auto gap-4">
        <motion.div 
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="flex items-center gap-3"
        >
          <div className="w-10 h-10 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-600/30">
            <Bot className="w-6 h-6 text-white" />
          </div>
          <div>
            <span className="text-lg font-black tracking-tight text-white block">WOLFF SYSTEM</span>
            <span className="text-[10px] text-gray-400 font-mono tracking-widest block uppercase">Multi-Intelligence Arena</span>
          </div>
        </motion.div>

        <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-6 text-xs md:text-sm font-medium text-gray-400">
          <button onClick={() => scrollToChat('wolff')} className="hover:text-white hover:scale-105 transition-all cursor-pointer">WolffAi</button>
          <button onClick={() => scrollToChat('angry')} className="hover:text-white hover:scale-105 transition-all cursor-pointer">AngryAi (Токсик)</button>
          <button onClick={() => scrollToChat('platform')} className="hover:text-white hover:scale-105 transition-all cursor-pointer">PlatformBot (20+ Моделей)</button>
          
          <div className="h-4 w-px bg-white/10 hidden sm:block"></div>

          {/* USER ACCOUNT CONTROL */}
          {currentUser ? (
            <div className="flex items-center gap-2 bg-white/5 px-3 py-1.5 rounded-xl border border-white/5">
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></div>
              <span className="text-xs text-gray-300 font-mono hidden md:inline max-w-[120px] truncate">{currentUser.email}</span>
              <button 
                onClick={handleSignOut}
                className="text-xs text-red-400 hover:text-red-300 transition-colors flex items-center gap-1 cursor-pointer"
                title="Выйти"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Выйти</span>
              </button>
            </div>
          ) : (
            <button 
              onClick={() => { setAuthMode('login'); setShowAuthModal(true); }}
              className="bg-indigo-600 text-white hover:bg-indigo-700 font-semibold text-xs px-4 py-2 rounded-xl transition-all shadow-md shadow-indigo-600/20 flex items-center gap-1.5 cursor-pointer"
            >
              <LogIn className="w-3.5 h-3.5" />
              Вход / Регистрация
            </button>
          )}
        </div>
      </nav>

      {/* MAIN LAYOUT */}
      <main className="max-w-7xl mx-auto px-6 mt-10 relative z-10">
        
        {/* LANDING INTRO HERO MODULE */}
        <div className="text-center py-10 max-w-3xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <span className="px-4 py-1.5 rounded-full bg-indigo-500/10 text-indigo-400 text-xs font-semibold tracking-wide border border-indigo-500/20 uppercase inline-block">
              🦾 ИИ-Экосистема Без Границ
            </span>
            <h1 className="text-4xl md:text-5xl font-extrabold text-white mt-4 tracking-tight leading-tight">
              Общайтесь с тремя <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 via-purple-400 to-red-400">Умными Ботами</span> прямо на сайте
            </h1>
            <p className="text-gray-400 text-base md:text-lg mt-4 leading-relaxed">
              Облачная синхронизация хранит ваши диалоги в безопасности, а новые функции позволяют отправлять ботам изображения, чертежи и файлы.
            </p>
          </motion.div>
        </div>

        {/* CLOUD DB FEATURES TICKER */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto my-12">
          <div className="bg-[#101014] border border-white/5 p-6 rounded-2xl flex items-center gap-4 transition-all hover:bg-[#131319]">
            <div className="p-3.5 rounded-xl bg-indigo-600/10 text-indigo-400 border border-indigo-500/10">
              <Shield className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-semibold text-white">Облачное хранение</h3>
              <p className="text-xs text-gray-400 mt-1">Войдите в один аккаунт и переписывайтесь с любого устройства</p>
            </div>
          </div>

          <div className="bg-[#101014] border border-white/5 p-6 rounded-2xl flex items-center gap-4 transition-all hover:bg-[#131319]">
            <div className="p-3.5 rounded-xl bg-emerald-600/10 text-emerald-400 border border-emerald-500/10">
              <Image className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-semibold text-white">Мультимодальность</h3>
              <p className="text-xs text-gray-400 mt-1">Отправляйте скриншоты, графики и фото всем ассистентам</p>
            </div>
          </div>

          <div className="bg-[#101014] border border-white/5 p-6 rounded-2xl flex items-center gap-4 transition-all hover:bg-[#131319]">
            <div className="p-3.5 rounded-xl bg-orange-600/10 text-orange-400 border border-orange-500/10">
              <Zap className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-semibold text-white">Анти-Сбой ботов</h3>
              <p className="text-xs text-gray-400 mt-1">Резервные цепи перенаправляют запросы при падениях API</p>
            </div>
          </div>
        </div>

        {/* INTERACTIVE CHAT ARENA SECTION */}
        <section id="chat-arena-section" className="scroll-mt-6 max-w-6xl mx-auto border border-white/10 bg-[#0c0c0e] rounded-3xl overflow-hidden shadow-2xl relative">
          
          {/* HEADER CONTROL BAR */}
          <div className="p-6 border-b border-white/10 bg-[#0e0e11] flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold flex items-center gap-2 text-white">
                <Sparkles className="w-5 h-5 text-indigo-400 animate-pulse" />
                Интеллектуальная Чат-Арена
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">Внутренняя платформа с переключением логических операторов</p>
            </div>

            {/* Main tab switch */}
            <div className="flex bg-black/40 p-1 rounded-xl border border-white/5 self-start lg:self-auto wrap overflow-x-auto">
              <button 
                onClick={() => setActiveBot('wolff')}
                className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${activeBot === 'wolff' ? 'bg-indigo-600 text-white shadow' : 'text-gray-400 hover:text-white'}`}
              >
                <Bot className="w-4 h-4" />
                WolffAi (Помощник)
              </button>
              <button 
                onClick={() => setActiveBot('angry')}
                className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${activeBot === 'angry' ? 'bg-red-600 text-white shadow' : 'text-gray-400 hover:text-white'}`}
              >
                <Flame className="w-4 h-4" />
                AngryAI (Токсик)
              </button>
              <button 
                onClick={() => setActiveBot('platform')}
                className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${activeBot === 'platform' ? 'bg-emerald-600 text-black shadow' : 'text-gray-400 hover:text-white'}`}
              >
                <Zap className="w-4 h-4" />
                PlatformBot (PRO)
              </button>
            </div>
          </div>

          <div className="flex flex-col md:flex-row h-[550px]">
            
            {/* SIDEBAR: ACTIVE BOT HISTORIES & CHAT LISTS */}
            <div className="w-full md:w-64 bg-[#0e0e11] border-r border-white/5 flex flex-col shrink-0">
              
              {/* Sidebar Auth Promo */}
              {!currentUser && (
                <div className="p-3.5 m-3.5 bg-gradient-to-br from-indigo-950/40 to-black/40 border border-indigo-500/10 rounded-xl">
                  <span className="text-[10px] text-indigo-400 font-bold uppercase tracking-wider block">🔒 Облачные бэкапы</span>
                  <p className="text-[11px] text-gray-400 mt-1">Войдите, чтобы чаты не пропали при очистке кэша браузера.</p>
                  <button 
                    onClick={() => { setAuthMode('register'); setShowAuthModal(true); }}
                    className="text-xs text-white underline mt-2 block hover:text-indigo-300 font-semibold cursor-pointer"
                  >
                    Зарегистрироваться ➔
                  </button>
                </div>
              )}

              <div className="px-4 py-2.5 flex items-center justify-between border-b border-white/5">
                <span className="text-[11px] text-gray-400 font-mono tracking-wider font-semibold uppercase">Ваши диалоги</span>
                <button 
                  onClick={createNewChat}
                  className="bg-white/5 hover:bg-white/10 border border-white/10 p-1.5 rounded-lg flex items-center justify-center text-gray-300 transition-colors cursor-pointer"
                  title="Создать новый чат"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Chat Sessions Scroller List */}
              <div className="flex-1 overflow-y-auto p-2.5 flex flex-col gap-1.5">
                {(Object.values(chats) as CloudChat[]).map((c) => (
                  <div
                    key={c.id}
                    onClick={() => selectChat(c.id)}
                    className={`group px-3 py-2 rounded-xl text-xs flex items-center justify-between cursor-pointer transition-all ${
                      currentChatId === c.id 
                        ? 'bg-white/5 border border-white/10 font-semibold text-white' 
                        : 'text-gray-400 hover:text-white hover:bg-white/5 border border-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-2 overflow-hidden mr-2">
                      <MessageSquare className="w-3.5 h-3.5 shrink-0 text-indigo-400 opacity-60" />
                      <span className="truncate">{c.name}</span>
                    </div>
                    
                    {/* Delete chat session */}
                    <button
                      onClick={(e) => deleteChatHandler(c.id, e)}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-white/10 text-gray-400 hover:text-red-400 transition-all cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* CHAT DISPLAY FEED CONTAINER */}
            <div className="flex-1 flex flex-col bg-black/20 overflow-hidden">
              
              {/* CURRENT CHAT META HEADER */}
              <div className={`px-6 py-3 border-b border-white/5 flex flex-wrap items-center justify-between gap-3 ${
                activeBot === 'wolff' ? 'bg-indigo-950/10' : activeBot === 'angry' ? 'bg-red-950/15' : 'bg-emerald-950/10'
              }`}>
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full animate-ping ${
                    activeBot === 'wolff' ? 'bg-indigo-500' : activeBot === 'angry' ? 'bg-red-500' : 'bg-emerald-500'
                  }`}></div>
                  <span className="text-xs font-semibold text-white">
                    {activeBot === 'wolff' ? 'WolffAi ассистент' : activeBot === 'angry' ? 'Свирепый AngryAI' : `Платформа: ${platformModelName}`}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {/* Wolff mode selector */}
                  {activeBot === 'wolff' && (
                    <div className="flex bg-black/60 p-0.5 rounded-lg border border-white/5 text-[11px]">
                      <button 
                        onClick={() => changeWolffMode('fast')}
                        className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${wolffMode === 'fast' ? 'bg-indigo-600/30 text-indigo-400 font-bold' : 'text-gray-400'}`}
                      >
                        🧠 Быстрый
                      </button>
                      <button 
                        onClick={() => changeWolffMode('thinking')}
                        className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${wolffMode === 'thinking' ? 'bg-indigo-600/30 text-indigo-400 font-bold' : 'text-gray-400'}`}
                      >
                        ⚡ Мышление
                      </button>
                      <button 
                        onClick={() => changeWolffMode('search')}
                        className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${wolffMode === 'search' ? 'bg-indigo-600/30 text-indigo-400 font-bold' : 'text-gray-400'}`}
                      >
                        🔍 Поиск
                      </button>
                    </div>
                  )}

                  {/* Platform models list option select */}
                  {activeBot === 'platform' && modelsList.length > 0 && (
                    <div className="flex items-center gap-2 bg-black/40 border border-white/5 rounded-lg px-2 py-1">
                      <Cpu className="w-3 h-3 text-emerald-400" />
                      <select 
                        value={platformModel}
                        onChange={(e) => changePlatformModel(e.target.value)}
                        className="bg-transparent text-[11px] text-emerald-400 outline-none cursor-pointer font-bold border-none"
                      >
                        {modelsList.map(mod => (
                          <option key={mod.id} value={mod.id} className="bg-[#111115] text-gray-200">
                            {mod.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <button 
                    onClick={clearChat}
                    className="p-1 px-2.5 text-[11px] text-gray-400 hover:text-white hover:bg-white/5 rounded-lg border border-white/5 flex items-center gap-1 transition-all cursor-pointer"
                    title="Стереть историю в этом чате"
                  >
                    <Trash2 className="w-3 h-3 text-red-400" />
                    <span>Очистить чат</span>
                  </button>
                </div>
              </div>

              {/* CHAT MESSAGES PANEL */}
              <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
                {messages.map((msg, idx) => (
                  <div 
                    key={idx} 
                    className={`flex flex-col max-w-[85%] ${msg.sender === 'user' ? 'self-end items-end animate-fade-in' : 'self-start items-start'}`}
                  >
                    <span className="text-[9px] text-gray-500 font-mono mb-1 mx-1 tracking-wide uppercase">
                      {msg.sender === 'user' ? 'ВЫ' : activeBot === 'wolff' ? 'WolffAi' : activeBot === 'angry' ? '👿 AngryAI' : `Platform (${platformModelName})`}
                    </span>

                    <div className={`p-4 rounded-2xl text-xs md:text-sm leading-relaxed ${
                      msg.sender === 'user' 
                        ? 'bg-gradient-to-br from-indigo-600 to-indigo-700 text-white rounded-tr-none shadow-md shadow-indigo-600/10' 
                        : msg.isError 
                        ? 'bg-red-500/10 border border-red-500/20 text-red-300 rounded-tl-none'
                        : activeBot === 'wolff'
                        ? 'bg-[#121215] border border-white/5 text-gray-200 rounded-tl-none'
                        : activeBot === 'angry'
                        ? 'bg-red-950/10 border border-red-900/10 text-red-200 rounded-tl-none'
                        : 'bg-[#0f1412] border border-emerald-500/10 text-emerald-100 rounded-tl-none'
                    }`}>
                      {renderMessageText(msg.text)}
                    </div>
                    <span className="text-[8px] text-gray-500 mt-1 mx-1">{msg.timestamp}</span>
                  </div>
                ))}

                {isLoading && (
                  <div className="flex flex-col self-start items-start max-w-[85%]">
                    <span className="text-[9px] text-gray-500 font-mono mb-1">
                      {activeBot === 'wolff' ? 'WolffAi' : activeBot === 'angry' ? '👿 AngryAI' : 'Platform'}
                    </span>
                    <div className={`p-4 rounded-xl text-xs flex items-center gap-2 ${
                      activeBot === 'wolff' ? 'bg-[#121215] border border-white/5 text-indigo-300' :
                      activeBot === 'angry' ? 'bg-red-950/10 border border-red-900/10 text-red-400' :
                      'bg-[#0f1412] border border-emerald-500/10 text-emerald-400'
                    } rounded-tl-none`}>
                      <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce [animation-delay:-0.3s]"></span>
                      <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce [animation-delay:-0.15s]"></span>
                      <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce"></span>
                      <span className="text-[10px] font-mono ml-1">
                        {activeBot === 'wolff' ? 'Ищет в вебе...' : activeBot === 'angry' ? 'Язвит по-умному...' : 'Передача запроса...'}
                      </span>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* PENDING ATTACHMENTS PREVIEW TICKER */}
              <AnimatePresence>
                {selectedFiles.length > 0 && (
                  <motion.div 
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="px-4 py-2.5 bg-black/40 border-t border-white/5 flex flex-wrap gap-2 items-center"
                  >
                    <span className="text-[10px] text-gray-400 font-mono block shrink-0 mr-1 uppercase">Вложения ({selectedFiles.length}):</span>
                    {selectedFiles.map((file, i) => (
                      <div key={i} className="flex items-center gap-1.5 bg-[#17171c] hover:bg-[#1d1d24] border border-white/10 p-1.5 px-2.5 rounded-xl text-xs text-indigo-300">
                        <Paperclip className="w-3 h-3 text-indigo-400 shrink-0" />
                        <span className="max-w-[120px] truncate">{file.name}</span>
                        <button 
                          type="button" 
                          onClick={() => removeFileAttachment(i)}
                          className="hover:text-red-400 p-0.5 rounded transition-all cursor-pointer"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* INPUT BAR */}
              <form onSubmit={sendMessage} className="p-4 border-t border-white/10 bg-[#0e0e11] flex gap-3 items-center">
                
                {/* Paperclip attachment button */}
                <button
                  type="button"
                  onClick={triggerFileSelect}
                  className="p-2.5 text-gray-400 hover:text-indigo-400 hover:bg-white/5 border border-white/5 rounded-xl transition-all cursor-pointer"
                  title="Отправить фото или файл"
                >
                  <Paperclip className="w-4 h-4" />
                </button>
                <input 
                  type="file"
                  multiple
                  accept="image/*"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  className="hidden"
                />

                <input 
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder={
                    activeBot === 'wolff' ? 'Спросите WolffAi о чем угодно или прикрепите файл...' :
                    activeBot === 'angry' ? 'Введите глупый текст для интеллектуального разноса...' :
                    `Задайте вопрос модели ${platformModelName}...`
                  }
                  disabled={isLoading}
                  className="flex-1 bg-black border border-white/5 focus:border-indigo-500 rounded-xl px-4 py-3 text-xs md:text-sm text-gray-200 outline-none transition-colors"
                />

                <button 
                  type="submit"
                  disabled={isLoading || (!inputText.trim() && selectedFiles.length === 0)}
                  className={`p-3 px-5 rounded-xl text-xs md:text-sm font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                    (!inputText.trim() && selectedFiles.length === 0) || isLoading 
                      ? 'bg-white/5 text-gray-500 cursor-not-allowed border border-transparent' 
                      : activeBot === 'wolff' 
                      ? 'bg-indigo-600 hover:bg-indigo-700 text-white font-bold shadow shadow-indigo-600/10' 
                      : activeBot === 'angry' 
                      ? 'bg-red-600 hover:bg-red-700 text-white font-bold shadow shadow-red-600/10' 
                      : 'bg-emerald-600 hover:bg-emerald-700 text-black font-bold'
                  }`}
                >
                  <Send className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Отправить</span>
                </button>
              </form>
            </div>
          </div>
        </section>
      </main>

      {/* CLOUD AUTH REGISTRATION/LOGIN DIALOG MODAL */}
      <AnimatePresence>
        {showAuthModal && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-[#0e0e11] border border-white/10 p-8 rounded-3xl w-full max-w-md shadow-2xl relative"
            >
              <button 
                onClick={() => setShowAuthModal(false)}
                className="absolute top-4 right-4 text-gray-400 hover:text-white p-1 rounded-lg hover:bg-white/5 transition-all cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="text-center mb-6">
                <div className="w-12 h-12 bg-indigo-600/10 border border-indigo-500/20 text-indigo-400 rounded-2xl flex items-center justify-center mx-auto mb-3">
                  <UserCheck className="w-6 h-6" />
                </div>
                <h3 className="text-xl font-bold text-white">
                  {authMode === 'login' ? 'С возвращением!' : 'Создать аккаунт'}
                </h3>
                <p className="text-xs text-gray-400 mt-1">
                  Облачное хранилище позволит вам хранить переписки и продолжать их везде
                </p>
              </div>

              {authError && (
                <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-400">
                  {authError}
                </div>
              )}

              {/* Login/Signup Tabs */}
              <div className="flex bg-black/40 p-1 rounded-xl border border-white/5 mb-6">
                <button 
                  type="button"
                  onClick={() => setAuthMode('login')}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${authMode === 'login' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'}`}
                >
                  Вход
                </button>
                <button 
                  type="button"
                  onClick={() => setAuthMode('register')}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${authMode === 'register' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'}`}
                >
                  Регистрация
                </button>
              </div>

              {/* Google OAuth Provider */}
              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={authLoading}
                className="w-full bg-white/5 border border-white/10 hover:bg-white/10 p-3 rounded-xl text-xs md:text-sm font-semibold flex items-center justify-center gap-2 text-white mb-5 transition-colors cursor-pointer"
              >
                <svg className="w-4 h-4 text-white" viewBox="0 0 24 24">
                  <path fill="currentColor" d="M12.24 10.285V14.4h6.887c-.648 2.41-2.519 4.114-5.136 4.114A5.53 5.53 0 0 1 8.4 13a5.53 5.53 0 0 1 5.59-5.514c2.25 0 4.12 1.34 4.88 3.257l3.818-2.96c-2.483-3.61-6.732-5.4-11.088-5.4C5.105 2.383 0 7.37 0 13c0 5.63 5.105 10.617 11.088 10.617 7.05 0 11.83-4.907 11.83-10.617 0-.741-.074-1.325-.2-1.714H12.24z"/>
                </svg>
                Войти через Google
              </button>

              <div className="flex items-center gap-2 text-gray-500 mb-5">
                <div className="h-px bg-white/5 flex-1 animate-pulse"></div>
                <span className="text-[10px] font-mono uppercase tracking-wider">Или пароль</span>
                <div className="h-px bg-white/5 flex-1 animate-pulse"></div>
              </div>

              {/* Auth Credentials Form */}
              <form onSubmit={handleAuthSubmit} className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] text-gray-400 font-bold uppercase tracking-wider flex items-center gap-1.5">
                    <Mail className="w-3 nav-icon text-indigo-400" /> Почта (Email)
                  </label>
                  <input 
                    type="email" 
                    value={authEmail}
                    onChange={(e) => setAuthEmail(e.target.value)}
                    placeholder="name@email.com"
                    required
                    className="bg-black border border-white/5 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-xs text-gray-200 outline-none"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] text-gray-400 font-bold uppercase tracking-wider flex items-center gap-1.5">
                    <KeyRound className="w-3 nav-icon text-indigo-400" /> Пароль (Password)
                  </label>
                  <input 
                    type="password" 
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    minLength={6}
                    className="bg-black border border-white/5 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-xs text-gray-200 outline-none"
                  />
                </div>

                <button
                  type="submit"
                  disabled={authLoading}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 p-3 rounded-xl text-xs md:text-sm font-bold text-white mt-4 transition-all shadow-lg shadow-indigo-600/10 flex items-center justify-center gap-2 cursor-pointer"
                >
                  {authLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                  {authMode === 'login' ? 'Войти' : 'Зарегистрироваться'}
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
