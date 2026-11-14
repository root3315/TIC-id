import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import {
  Brain, Sparkles, AlertCircle, Loader2, RefreshCw, Copy, Send, CheckCircle2,
  MessageCircle, Zap, User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { getAiStatus, analyzePlanet, aiChat } from "@/lib/api";
import { useT } from "@/lib/i18n";

/** Лёгкий markdown-рендер: заголовки, жирный, списки — без внешних зависимостей */
const renderMarkdown = (text) => {
  const lines = (text || "").split("\n");
  const out = [];
  let list = null;
  const flushList = () => {
    if (list) {
      out.push(
        <ul key={`ul-${out.length}`} className="list-disc pl-6 space-y-1 my-2">
          {list}
        </ul>
      );
      list = null;
    }
  };
  const inline = (s) =>
    s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith("**") && part.endsWith("**") ? (
        <strong key={i} className="text-white font-semibold">{part.slice(2, -2)}</strong>
      ) : (
        part
      )
    );
  lines.forEach((raw, idx) => {
    const line = raw.trimEnd();
    const h = line.match(/^(#{1,4})\s+(.*)/);
    const li = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)/);
    if (h) {
      flushList();
      out.push(
        <h3 key={idx} className="text-lg font-semibold text-cyan-200 mt-5 mb-2">
          {inline(h[2])}
        </h3>
      );
    } else if (li) {
      list = list || [];
      list.push(<li key={idx} className="text-slate-300">{inline(li[1])}</li>);
    } else if (line.trim() === "") {
      flushList();
    } else {
      flushList();
      out.push(
        <p key={idx} className="text-slate-300 leading-relaxed my-2">{inline(line)}</p>
      );
    }
  });
  flushList();
  return out;
};

const SUGGESTED = [
  { ru: "Может ли здесь существовать жизнь?", en: "Could life exist here?" },
  { ru: "Что я увидел бы, стоя на её поверхности?", en: "What would I see standing on its surface?" },
  { ru: "Чем она принципиально отличается от Земли?", en: "How is it fundamentally different from Earth?" },
  { ru: "Насколько надёжны данные об этой планете?", en: "How reliable is the data about this planet?" },
];

const AIAnalysisTab = ({ data, aiState, setAiState }) => {
  const t = useT();
  const [status, setStatus] = useState(null); // {provider, available, primary}
  const [loading, setLoading] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const chatEndRef = useRef(null);
  const chat = aiState.chat || [];

  useEffect(() => {
    getAiStatus().then(setStatus).catch(() => setStatus({ provider: "none", available: false }));
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [chat.length, chatBusy]);

  const slimData = {
    name: data.name,
    physical_params: data.physical_params,
    orbital_params: data.orbital_params,
    host_star: data.host_star,
    derived: data.derived,
    discovery_info: data.discovery_info,
    habitability_score: data.habitability_score,
  };

  const runAnalysis = async (force = false) => {
    setLoading(true);
    try {
      const res = await analyzePlanet({ exoplanet_data: slimData, force });
      if (res.analysis) {
        setAiState({ ...aiState, analysis: res.analysis, model: res.model, provider: res.provider });
        toast.success(res.cached ? t("Анализ из кэша (мгновенно)", "Analysis from cache (instant)") : t(`Анализ готов · ${res.model}`, `Analysis ready · ${res.model}`));
      } else {
        toast.warning(res.error || t("ИИ недоступен", "AI unavailable"));
      }
    } catch {
      toast.error(t("Ошибка AI-анализа", "AI analysis error"));
    } finally {
      setLoading(false);
    }
  };

  const sendChat = async (text) => {
    const q = (text || "").trim();
    if (!q || chatBusy) return;
    const nextChat = [...chat, { role: "user", content: q }];
    setAiState({ ...aiState, chat: nextChat });
    setChatInput("");
    setChatBusy(true);
    try {
      const res = await aiChat({ exoplanet_data: slimData, messages: nextChat });
      if (res.reply) {
        setAiState({
          ...aiState,
          chat: [...nextChat, { role: "assistant", content: res.reply, model: res.model }],
        });
      } else {
        toast.warning(res.error || t("ИИ не ответил", "AI did not respond"));
        setAiState({ ...aiState, chat });
      }
    } catch {
      toast.error(t("Ошибка чата с ИИ", "AI chat error"));
      setAiState({ ...aiState, chat });
    } finally {
      setChatBusy(false);
    }
  };

  const copyAnalysis = () => {
    navigator.clipboard.writeText(aiState.analysis || "");
    toast.success(t("Анализ скопирован", "Analysis copied"));
  };

  const providerBadge =
    status == null ? t("проверяю…", "checking…")
      : status.provider === "groq" ? `Groq · ${status.primary}`
      : status.provider === "ollama" ? t("локальная Ollama", "local Ollama")
      : t("не настроен", "not configured");

  return (
    <div className="space-y-6">
      {/* Статус провайдера */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        className="panel rounded-xl p-4 flex flex-wrap items-center gap-3"
      >
        <span
          className={`w-2.5 h-2.5 rounded-full ${
            status == null ? "bg-slate-500" : status.available ? "bg-emerald-400" : "bg-red-400"
          }`}
        />
        <span className="text-sm text-slate-300 flex items-center gap-1.5">
          <Zap className="w-3.5 h-3.5" style={{ color: "var(--ink-3)" }} />
          {t("ИИ:", "AI:")} <b className="text-white">{providerBadge}</b>
        </span>
        {status?.provider === "groq" && (
          <span className="text-xs text-slate-500">
            {t("при лимитах автоматически переключается на запасные модели", "automatically switches to backup models when rate-limited")}
          </span>
        )}
        {status?.provider === "none" && (
          <span className="text-xs text-amber-300/90 flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5" />
            {t("добавьте GROQ_API_KEY в backend/.env или запустите Ollama", "add GROQ_API_KEY to backend/.env or start Ollama")}
          </span>
        )}
      </motion.div>

      {/* Полный анализ */}
      {loading ? (
        <div className="card-glow rounded-xl p-14 text-center">
          <div className="relative w-20 h-20 mx-auto mb-5">
            <div className="absolute inset-0 rounded-full" style={{ border: "2px solid var(--rule)" }} />
            <div className="absolute inset-0 rounded-full animate-spin" style={{ borderTop: "2px solid var(--beam)" }} />
            <Brain className="absolute inset-0 m-auto w-9 h-9 pulse-soft" style={{ color: "var(--ink-3)" }} />
          </div>
          <p className="text-xl text-white mb-1.5">{t("Модель размышляет…", "Model is thinking…")}</p>
          <p className="text-sm text-slate-400">
            {status?.provider === "groq"
              ? t("Groq отвечает за несколько секунд.", "Groq responds within a few seconds.")
              : t(`Локальная LLM анализирует параметры ${data.name} — может занять до пары минут.`, `The local LLM is analyzing ${data.name}'s parameters — this may take up to a couple of minutes.`)}
          </p>
        </div>
      ) : !aiState.analysis ? (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="card-glow rounded-xl p-10 sm:p-14 text-center"
        >
          <Brain className="w-16 h-16 mx-auto mb-5" style={{ color: "var(--ink-3)" }} />
          <h2 className="text-2xl font-bold text-white mb-3">{t("AI-анализ экзопланеты", "AI analysis of the exoplanet")}</h2>
          <p className="text-slate-400 mb-7 max-w-2xl mx-auto leading-relaxed">
            {t(`Языковая модель получит все собранные параметры ${data.name} — физику, орбиту, звезду, производные величины и оценку обитаемости — и составит экспертное заключение: классификация, условия на поверхности, сценарий колонизации и научная ценность.`, `The language model will receive all collected parameters of ${data.name} — physics, orbit, star, derived quantities and the habitability score — and produce an expert conclusion: classification, surface conditions, a colonization scenario and scientific value.`)}
          </p>
          <Button
            onClick={() => runAnalysis()}
            disabled={status != null && !status.available}
            className="btn-beam px-7 h-11 text-[15px] rounded-lg"
            data-testid="run-ai-button"
          >
            <Sparkles className="w-5 h-5 mr-2" />
            {t("Запустить полный анализ", "Run full analysis")}
          </Button>
        </motion.div>
      ) : (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
          <div className="card-glow rounded-xl p-6 sm:p-8">
            <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
              <div className="flex items-center gap-3">
                <Brain className="w-6 h-6" style={{ color: "var(--ink-3)" }} />
                <div>
                  <h2 className="text-xl font-bold text-white">{t("Заключение AI", "AI conclusion")}</h2>
                  <p className="text-xs text-slate-500">{t("модель", "model")} {aiState.model}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={copyAnalysis}
                  className="text-slate-400 hover:text-white h-8">
                  <Copy className="w-4 h-4 mr-1.5" /> {t("Копировать", "Copy")}
                </Button>
                <Button size="sm" variant="outline" onClick={() => runAnalysis(true)}
                  className="border-purple-400/40 text-purple-300 hover:bg-purple-500/10 h-8 rounded-lg">
                  <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> {t("Заново", "Regenerate")}
                </Button>
              </div>
            </div>
            <div className="prose-invert max-w-none text-[15px]">{renderMarkdown(aiState.analysis)}</div>
            <div className="flex items-center gap-2 mt-5 pt-4 border-t border-white/5 text-xs text-slate-500">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              {aiState.provider === "groq"
                ? t("Выполнено через Groq API — модель видела только параметры планеты", "Done via the Groq API — the model only saw the planet's parameters")
                : t("Анализ выполнен локально — данные не покидали ваш компьютер", "Analysis performed locally — the data never left your computer")}
            </div>
          </div>
        </motion.div>
      )}

      {/* Чат о планете */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.1 }}
        className="panel rounded-xl p-5"
      >
        <h3 className="text-base font-semibold text-white mb-1 flex items-center gap-2">
          <MessageCircle className="w-4.5 h-4.5" style={{ color: "var(--ink-3)" }} />
          {t("Чат об этой планете", "Chat about this planet")}
        </h3>
        <p className="text-xs text-slate-500 mb-4">
          {t(`Модель видит все данные ${data.name} и помнит контекст разговора.`, `The model sees all of ${data.name}'s data and remembers the conversation context.`)}
        </p>

        {chat.length === 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {SUGGESTED.map((s) => (
              <button
                key={s.ru}
                onClick={() => sendChat(t(s.ru, s.en))}
                disabled={chatBusy || (status != null && !status.available)}
                className="tag tag-link disabled:opacity-50"
              >
                {t(s.ru, s.en)}
              </button>
            ))}
          </div>
        )}

        {chat.length > 0 && (
          <div className="space-y-3 mb-4 max-h-[480px] overflow-y-auto pr-1">
            {chat.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-br-md bg-indigo-600/30 border border-indigo-400/20 px-4 py-2.5 text-sm text-slate-100 flex gap-2">
                    <User className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: "var(--ink-3)" }} />
                    <span>{m.content}</span>
                  </div>
                </div>
              ) : (
                <div key={i} className="flex justify-start">
                  <div className="max-w-[92%] rounded-2xl rounded-bl-md bg-slate-800/60 border border-white/5 px-4 py-2.5 text-sm">
                    <div className="text-slate-200 [&>p]:my-1 [&>h3]:text-sm [&>h3]:mt-2">
                      {renderMarkdown(m.content)}
                    </div>
                    {m.model && (
                      <p className="text-[10px] text-slate-500 mt-1.5">{m.model}</p>
                    )}
                  </div>
                </div>
              )
            )}
            {chatBusy && (
              <div className="flex items-center gap-2 text-sm text-slate-400 pl-2">
                <Loader2 className="w-4 h-4 animate-spin" /> {t("печатает…", "typing…")}
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
        )}

        <div className="flex gap-2">
          <Input
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendChat(chatInput)}
            placeholder={t("Спросите что угодно об этой планете…", "Ask anything about this planet…")}
            className="flex-1 h-11 bg-slate-900/60 border-slate-600/40 text-white placeholder:text-slate-500 rounded-xl"
            data-testid="ai-question-input"
          />
          <Button
            onClick={() => sendChat(chatInput)}
            disabled={chatBusy || !chatInput.trim() || (status != null && !status.available)}
            className="h-11 px-5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl"
            data-testid="ai-question-button"
          >
            {chatBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </Button>
        </div>
      </motion.div>
    </div>
  );
};

export default AIAnalysisTab;
