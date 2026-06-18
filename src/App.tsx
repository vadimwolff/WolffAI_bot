/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Bot, Zap, Users, Shield, ArrowRight, Flame } from 'lucide-react';
import { motion } from 'motion/react';

export default function App() {
  const [stats, setStats] = useState({ totalUsers: 0, botActive: false, angryBotActive: false });

  useEffect(() => {
    fetch('/api/stats')
      .then(res => res.json())
      .then(data => setStats(data))
      .catch(console.error);
  }, []);

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white font-sans selection:bg-indigo-500 selection:text-white">
      {/* Navbar */}
      <nav className="flex items-center justify-between px-6 py-6 max-w-7xl mx-auto">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center">
            <Bot className="w-6 h-6 text-white" />
          </div>
          <span className="text-xl font-bold tracking-tight">WolffAi & AngryAI</span>
        </div>
        <div className="flex items-center gap-4 text-sm font-medium">
          <span className="text-gray-400">Бот-Хаб</span>
        </div>
      </nav>

      {/* Hero Section */}
      <main className="max-w-7xl mx-auto px-6 pt-16 pb-32">
        <div className="flex flex-col items-center text-center max-w-3xl mx-auto mb-16">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 text-sm font-medium mb-8 border border-emerald-500/20"
          >
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            Бот-серверы активны
          </motion.div>
          
          <motion.h1 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-5xl md:text-7xl font-semibold tracking-tight leading-tight mb-8"
          >
            Два ИИ-помощника <br/>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 via-purple-400 to-red-400">
              на твой выбор
            </span>
          </motion.h1>
          
          <motion.p 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-lg md:text-xl text-gray-400 mb-10 max-w-2xl"
          >
            Используй вежливого WolffAi для продуктивности или загляни к AngryAI за порцией отборного non-profane сарказма и интеллектуального троллинга.
          </motion.p>
        </div>

        {/* Both Bots Display */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-5xl mx-auto mb-20">
          {/* WolffAi Card */}
          <div className="bg-[#111] border border-indigo-500/20 p-8 rounded-3xl relative overflow-hidden group flex flex-col justify-between">
            <div className="absolute -top-10 -right-10 w-40 h-40 bg-indigo-500/10 rounded-full blur-2xl group-hover:bg-indigo-500/20 transition-all"></div>
            <div>
              <div className="w-12 h-12 bg-indigo-600/20 rounded-2xl flex items-center justify-center mb-6">
                <Bot className="w-6 h-6 text-indigo-400" />
              </div>
              <h3 className="text-2xl font-bold mb-3 flex items-center gap-2">
                WolffAi
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${stats.botActive ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                  {stats.botActive ? 'Активен' : 'Ожидание токена'}
                </span>
              </h3>
              <p className="text-gray-400 mb-8">
                Вежливый, уважительный и высокоэффективный ассистент. Отлично пишет тексты, исправляет код, ищет свежую информацию в интернете и бережет ваши нервы.
              </p>
            </div>
            <div className="text-sm font-mono text-gray-400">
              Команды: /start, /mode, /newchat, /chats, /clear
            </div>
          </div>

          {/* AngryAI Card */}
          <div className="bg-[#111] border border-red-500/20 p-8 rounded-3xl relative overflow-hidden group flex flex-col justify-between">
            <div className="absolute -top-10 -right-10 w-40 h-40 bg-red-500/10 rounded-full blur-2xl group-hover:bg-red-500/20 transition-all"></div>
            <div>
              <div className="w-12 h-12 bg-red-600/20 rounded-2xl flex items-center justify-center mb-6">
                <Flame className="w-6 h-6 text-red-500" />
              </div>
              <h3 className="text-2xl font-bold mb-3 flex items-center gap-2">
                AngryAI
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${stats.angryBotActive ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                  {stats.angryBotActive ? 'Активен' : 'Ожидание токена'}
                </span>
              </h3>
              <p className="text-gray-400 mb-8">
                Сверхтоксичный, злой и ехидный бот. Никогда не использует нецензурную брань (мат под запретом!), но уничтожит тебя высококлассной иронией и интеллектуальным сарказмом.
              </p>
            </div>
            <div className="text-sm font-mono text-gray-400">
              Команды: /start, /clear
            </div>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          <div className="bg-[#111] border border-white/5 p-8 rounded-3xl relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-8 opacity-20 group-hover:opacity-40 transition-opacity">
              <Zap className="w-24 h-24 text-indigo-500" />
            </div>
            <div className="relative z-10">
              <h3 className="text-4xl font-bold mb-2">Мгновенно</h3>
              <p className="text-gray-400">Моментальные ответы на базе Gemini Flash в обоих ботах</p>
            </div>
          </div>
          
          <div className="bg-[#111] border border-white/5 p-8 rounded-3xl relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-8 opacity-20 group-hover:opacity-40 transition-opacity">
              <Users className="w-24 h-24 text-cyan-500" />
            </div>
            <div className="relative z-10">
              <h3 className="text-4xl font-bold mb-2">{stats.totalUsers > 0 ? stats.totalUsers : '0'}</h3>
              <p className="text-gray-400">Активных пользователей в экосистеме</p>
            </div>
          </div>

          <div className="bg-[#111] border border-white/5 p-8 rounded-3xl relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-8 opacity-20 group-hover:opacity-40 transition-opacity">
              <Shield className="w-24 h-24 text-purple-500" />
            </div>
            <div className="relative z-10">
              <h3 className="text-4xl font-bold mb-2">Надежно</h3>
              <p className="text-gray-400">Каждый бот имеет изолированную, надежную историю ваших переписок</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
