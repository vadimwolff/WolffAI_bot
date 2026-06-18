/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Bot, Zap, Users, Shield, ArrowRight } from 'lucide-react';
import { motion } from 'motion/react';

export default function App() {
  const [stats, setStats] = useState({ totalUsers: 0, botActive: false });

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
          <span className="text-xl font-bold tracking-tight">WolffAi</span>
        </div>
        <div className="flex items-center gap-4 text-sm font-medium">
          <a href="#features" className="text-gray-400 hover:text-white transition-colors">Возможности</a>
          <a href="#earn" className="text-gray-400 hover:text-white transition-colors">Заработок</a>
          <a href="#" className="bg-white text-black px-4 py-2 rounded-full hover:bg-gray-200 transition-colors">
            Запустить бота
          </a>
        </div>
      </nav>

      {/* Hero Section */}
      <main className="max-w-7xl mx-auto px-6 pt-24 pb-32">
        <div className="flex flex-col items-center text-center max-w-3xl mx-auto">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 text-indigo-400 text-sm font-medium mb-8 border border-indigo-500/20"
          >
            <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></span>
            Бот запущен и работает
          </motion.div>
          
          <motion.h1 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-5xl md:text-7xl font-semibold tracking-tight leading-tight mb-8"
          >
            Твой персональный <br/>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-cyan-400">
              AI-Ассистент
            </span> в Telegram.
          </motion.h1>
          
          <motion.p 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-lg md:text-xl text-gray-400 mb-10 max-w-2xl"
          >
            Умный, быстрый и полезный. Генерируй контент, задавай вопросы и монетизируй свой трафик прямо в мессенджере.
          </motion.p>

          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="flex flex-col sm:flex-row items-center gap-4"
          >
            <a href="https://t.me" target="_blank" rel="noreferrer" className="flex items-center gap-2 bg-indigo-600 text-white px-8 py-4 rounded-full font-medium hover:bg-indigo-700 transition-colors w-full sm:w-auto justify-center">
              Открыть в Telegram
              <ArrowRight className="w-5 h-5" />
            </a>
            <a href="#features" className="flex items-center gap-2 bg-white/5 text-white px-8 py-4 rounded-full font-medium hover:bg-white/10 transition-colors border border-white/10 w-full sm:w-auto justify-center">
              Узнать больше
            </a>
          </motion.div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-32">
          <div className="bg-[#111] border border-white/5 p-8 rounded-3xl relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-8 opacity-20 group-hover:opacity-40 transition-opacity">
              <Zap className="w-24 h-24 text-indigo-500" />
            </div>
            <div className="relative z-10">
              <h3 className="text-4xl font-bold mb-2">Мгновенно</h3>
              <p className="text-gray-400">Моментальные ответы на базе Gemini Flash</p>
            </div>
          </div>
          
          <div className="bg-[#111] border border-white/5 p-8 rounded-3xl relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-8 opacity-20 group-hover:opacity-40 transition-opacity">
              <Users className="w-24 h-24 text-cyan-500" />
            </div>
            <div className="relative z-10">
              <h3 className="text-4xl font-bold mb-2">{stats.totalUsers > 0 ? stats.totalUsers : '∞'}</h3>
              <p className="text-gray-400">Активных пользователей в боте прямо сейчас</p>
            </div>
          </div>

          <div className="bg-[#111] border border-white/5 p-8 rounded-3xl relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-8 opacity-20 group-hover:opacity-40 transition-opacity">
              <Shield className="w-24 h-24 text-purple-500" />
            </div>
            <div className="relative z-10">
              <h3 className="text-4xl font-bold mb-2">Надежно</h3>
              <p className="text-gray-400">Ваши данные защищены и зашифрованы</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
