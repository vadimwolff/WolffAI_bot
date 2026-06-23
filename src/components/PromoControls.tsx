import React, { useState, useEffect } from "react";
import { Ticket, Plus, Trash2, Copy, Check, Infinity, Clock } from "lucide-react";

interface PromoCode {
  code: string;
  type: "one_time" | "multi_time";
  durationMonths: number;
  createdAt: string;
  usedBy: any[];
}

export default function PromoControls() {
  const [promoList, setPromoList] = useState<PromoCode[]>([]);
  const [promoType, setPromoType] = useState<"one_time" | "multi_time">("one_time");
  const [durationMonths, setDurationMonths] = useState<number>(2);
  const [loading, setLoading] = useState<boolean>(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [lastGenerated, setLastGenerated] = useState<string | null>(null);

  const fetchPromos = async () => {
    try {
      const res = await fetch("/api/admin/promocodes");
      if (res.ok) {
        const data = await res.json();
        setPromoList(data);
      }
    } catch (e) {
      console.error("Failed to load promo codes", e);
    }
  };

  useEffect(() => {
    fetchPromos();
  }, []);

  const handleGenerate = async () => {
    setLoading(true);
    setLastGenerated(null);
    try {
      const res = await fetch("/api/admin/promocodes/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: promoType, durationMonths }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.promocode) {
          setLastGenerated(data.promocode.code);
          fetchPromos();
        }
      }
    } catch (e) {
      console.error("Error generating promo code", e);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (code: string) => {
    if (!confirm(`Вы действительно хотите удалить промокод ${code}? Он сразу перестанет действовать.`)) {
      return;
    }
    try {
      const res = await fetch("/api/admin/promocodes/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (res.ok) {
        fetchPromos();
      }
    } catch (e) {
      console.error("Error deleting promo code", e);
    }
  };

  const handleCopy = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const getDurationLabel = (months: number) => {
    if (months === -1) return "Навсегда (Lifetime)";
    if (months === 1) return "1 месяц";
    if (months === 2) return "2 месяца";
    if (months === 6) return "6 месяцев";
    if (months === 12) return "1 год";
    return `${months} мес.`;
  };

  return (
    <div id="promo-management-panel" className="bg-[#0f0f14] border border-white/5 p-6 rounded-3xl mb-8 text-left">
      <div className="flex items-center gap-3 border-b border-white/5 pb-4 mb-5">
        <div className="w-9 h-9 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
          <Ticket className="w-5 h-5" />
        </div>
        <div>
          <h3 className="text-sm font-black text-white uppercase tracking-wider">
            🎟️ Управление беспрецедентными промокодами
          </h3>
          <p className="text-[11px] text-gray-400 mt-0.5">
            Создание, контроль использования и удаление одноразовых/многоразовых промокодов на PRO-лицензию
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* LHS: GENERATOR FORM */}
        <div className="lg:col-span-5 bg-black/35 border border-white/5 p-5 rounded-2xl space-y-4">
          <span className="text-amber-400 font-bold uppercase tracking-wider text-[10px] block">
            🪄 Генератор кодов
          </span>

          <div className="space-y-1.5 text-left">
            <label className="text-[11px] text-gray-400 font-medium">Тип промокода:</label>
            <div className="grid grid-cols-2 gap-2 bg-black/60 p-1 rounded-lg border border-white/5">
              <button
                type="button"
                onClick={() => setPromoType("one_time")}
                className={`px-3 py-1.5 rounded-md text-[10.5px] font-bold transition-all cursor-pointer ${
                  promoType === "one_time"
                    ? "bg-amber-500/15 text-amber-300 border border-amber-500/25"
                    : "text-gray-400 hover:text-white"
                }`}
              >
                Одноразовый
              </button>
              <button
                type="button"
                onClick={() => setPromoType("multi_time")}
                className={`px-3 py-1.5 rounded-md text-[10.5px] font-bold transition-all cursor-pointer ${
                  promoType === "multi_time"
                    ? "bg-indigo-500/15 text-indigo-300 border border-indigo-500/25"
                    : "text-gray-400 hover:text-white"
                }`}
              >
                Многоразовый
              </button>
            </div>
          </div>

          <div className="space-y-1.5 text-left">
            <label className="text-[11px] text-gray-400 font-medium">Срок действия подписки:</label>
            <select
              value={durationMonths}
              onChange={(e) => setDurationMonths(Number(e.target.value))}
              className="w-full bg-black/60 border border-white/5 rounded-lg px-3 py-2 text-xs text-gray-200 focus:border-amber-500 outline-none transition-all cursor-pointer"
            >
              <option value={1}>1 месяц (30 дней)</option>
              <option value={2}>2 месяца (60 дней)</option>
              <option value={6}>6 месяцев (180 дней)</option>
              <option value={12}>1 год (365 дней)</option>
              <option value={-1}>Бессрочно (Навсегда / Lifetime)</option>
            </select>
          </div>

          <button
            type="button"
            onClick={handleGenerate}
            disabled={loading}
            className="w-full bg-amber-500 hover:bg-amber-400 text-black py-2.5 rounded-xl text-xs font-extrabold flex items-center justify-center gap-1.5 transition-all shadow-lg shadow-amber-500/10 cursor-pointer disabled:opacity-50"
          >
            <Plus className="w-4 h-4 text-black font-black" />
            {loading ? "Генерация..." : "Создать Промокод"}
          </button>

          {lastGenerated && (
            <div className="bg-amber-500/10 border border-amber-500/30 p-3 rounded-xl mt-4 flex items-center justify-between gap-2.5">
              <div className="truncate">
                <span className="text-[9px] text-amber-450 block font-bold tracking-tight uppercase">Сгенерирован код:</span>
                <span className="font-mono text-sm font-black text-amber-300 select-all block mt-0.5 tracking-wide">
                  {lastGenerated}
                </span>
              </div>
              <button
                type="button"
                onClick={() => handleCopy(lastGenerated)}
                className="bg-amber-500/20 hover:bg-amber-300 hover:text-black hover:border-transparent text-amber-300 border border-amber-500/30 p-2 rounded-lg transition-all cursor-pointer flex items-center justify-center shrink-0"
              >
                {copiedCode === lastGenerated ? (
                  <Check className="w-4 h-4 text-green-400" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
            </div>
          )}
        </div>

        {/* RHS: ACTIVE CODES LIST */}
        <div className="lg:col-span-7 space-y-3.5">
          <div className="flex items-center justify-between">
            <span className="text-zinc-400 font-bold uppercase tracking-wider text-[10px] block">
              📋 Список активных промокодов ({promoList.length})
            </span>
            <button 
              onClick={fetchPromos} 
              className="text-[10px] text-amber-400 hover:underline font-mono cursor-pointer"
            >
              Обновить список
            </button>
          </div>

          <div className="bg-black/20 border border-white/5 rounded-2xl overflow-hidden max-h-[340px] overflow-y-auto">
            {promoList.length === 0 ? (
              <div className="p-8 text-center text-gray-500 text-xs">
                Нет активных промокодов. Создайте первый в форме слева!
              </div>
            ) : (
              <div className="divide-y divide-white/5">
                {promoList.map((promo) => {
                  const isOneTime = promo.type === "one_time";
                  const usedCount = promo.usedBy ? promo.usedBy.length : 0;
                  const isUsed = isOneTime && usedCount > 0;

                  return (
                    <div key={promo.code} className="p-3.5 flex items-center justify-between gap-4 hover:bg-white/[0.02] transition-colors">
                      <div className="flex items-center gap-3 truncate min-w-0">
                        {/* Type Indicator */}
                        <div className={`w-2 h-10 rounded-full shrink-0 ${
                          isOneTime ? "bg-amber-500" : "bg-indigo-500"
                        }`} />
                        
                        <div className="truncate min-w-0 text-left">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-black text-white select-all">
                              {promo.code}
                            </span>
                            <button
                              onClick={() => handleCopy(promo.code)}
                              className="text-gray-500 hover:text-white transition-colors cursor-pointer"
                              title="Копировать"
                            >
                              {copiedCode === promo.code ? (
                                <Check className="w-3 h-3 text-green-400" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                            </button>
                          </div>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-gray-400 mt-1">
                            <span className={`px-1.5 py-0.5 rounded-md font-bold text-[9px] ${
                              isOneTime 
                                ? "bg-amber-500/10 text-amber-400 border border-amber-500/20" 
                                : "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20"
                            }`}>
                              {isOneTime ? "Одноразовый" : "Многоразовый"}
                            </span>
                            <span className="flex items-center gap-0.5 text-zinc-300 font-semibold font-mono bg-white/5 px-1.5 py-0.5 rounded border border-white/5">
                              {promo.durationMonths === -1 ? (
                                <Infinity className="w-3 h-3 text-amber-400 inline" />
                              ) : (
                                <Clock className="w-3 h-3 text-zinc-400 inline" />
                              )}
                              <span>{getDurationLabel(promo.durationMonths)}</span>
                            </span>
                            <span className="text-zinc-500">
                              Создан: {new Date(promo.createdAt).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Status / Actions */}
                      <div className="flex items-center gap-3 shrink-0">
                        <div className="text-right text-[10px] font-mono">
                          {isOneTime ? (
                            isUsed ? (
                              <span className="text-red-400 font-bold block bg-red-500/10 px-1.5 py-0.5 rounded border border-red-500/15">Использован</span>
                            ) : (
                              <span className="text-emerald-400 font-bold block bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/15">Активен</span>
                            )
                          ) : (
                            <span className="text-indigo-300 font-mono block">
                              Активаций: <strong className="text-white">{usedCount}</strong>
                            </span>
                          )}
                        </div>

                        <button
                          onClick={() => handleDelete(promo.code)}
                          className="p-1.5 rounded-lg border border-neutral-800 text-gray-500 hover:bg-red-950/20 hover:text-red-400 hover:border-red-505 transition-all cursor-pointer flex items-center justify-center shrink-0"
                          title="Удалить промокод"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
