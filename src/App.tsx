import React, { useState, useEffect, useRef } from "react";
import {
  Send,
  Copy,
  Check,
  FileCode,
  MessageSquare,
  Paperclip,
  Calendar,
} from "lucide-react";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

// Единая структура любого напоминания без типов: (дата, время, название, описание)
interface ReminderItem {
  date: string; // Конкретная дата в календаре "YYYY-MM-DD"
  time: string; // Время "HH:MM"
  title: string; // Название
  description: string; // Описание
}

const DEFAULT_SAMPLE_RECOMMENDATIONS = `Выписка: Операция остеосинтеза лодыжки.
Рекомендации:
1. Кальций Д3 Никомед — по 1 таблетке утром (09:00) и вечером (20:00) ежедневно в течение 2 месяцев (60 дней).
2. Кеторол — 1 таблетка в 13:00 при болях первые 3 дня.
3. Перевязка и обработка шва антисептиком — каждые 2 дня в течение 10 дней.
4. Снятие повязки и швов — через 10 дней.
5. Плановый приём травматолога и контрольный рентген — через 14 дней.`;

export default function App() {
  const todayIso = new Date().toISOString().slice(0, 10);

  const [activeTab, setActiveTab] = useState<"app" | "files">("app");
  const [selectedModel, setSelectedModel] = useState<string>("GigaChat-Pro");
  const [usedModelName, setUsedModelName] = useState<string>("GigaChat-Pro");

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "Здравствуйте! Я ваш помощник по послеоперационному сопровождению при переломах. Прикрепите справа список рекомендаций из вашей выписки, чтобы я один раз сформировал точное календарное расписание, и задавайте любые вопросы в чате.",
    },
  ]);

  const [recommendationsText, setRecommendationsText] = useState<string>(
    DEFAULT_SAMPLE_RECOMMENDATIONS
  );
  const [scheduleGenerated, setScheduleGenerated] = useState<boolean>(false);
  const [generatingSchedule, setGeneratingSchedule] = useState<boolean>(false);
  const [reminders, setReminders] = useState<ReminderItem[]>([]);
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});
  const [showAllDates, setShowAllDates] = useState<boolean>(false);
  const [selectedDate, setSelectedDate] = useState<string>(todayIso);

  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const [repoFiles, setRepoFiles] = useState<Record<string, string>>({});
  const [selectedFile, setSelectedFile] = useState<string>("app.py");
  const [copiedFile, setCopiedFile] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/files")
      .then((res) => res.json())
      .then((data) => {
        if (data.files) {
          setRepoFiles(data.files);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = String(ev.target?.result || "");
      if (content.trim()) {
        setRecommendationsText(content);
      }
    };
    reader.readAsText(file);
  };

  // Формирование расписания ТОЛЬКО ОДИН РАЗ при прикреплении списка рекомендаций
  const handleGenerateScheduleOnce = async () => {
    if (!recommendationsText.trim() || generatingSchedule || scheduleGenerated) {
      return;
    }
    setGeneratingSchedule(true);
    try {
      const response = await fetch("/api/generate-schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recommendationsText: recommendationsText.trim(),
          startDate: todayIso,
          model: selectedModel,
        }),
      });
      const data = await response.json();
      if (Array.isArray(data.reminders)) {
        setReminders(data.reminders);
        if (data.usedModel) setUsedModelName(data.usedModel);
        setScheduleGenerated(true);
      }
    } finally {
      setGeneratingSchedule(false);
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || loading) return;

    const nextMessages: ChatMessage[] = [
      ...messages,
      { role: "user", content: trimmed },
    ];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages,
          recommendationsText: scheduleGenerated ? recommendationsText : "",
          model: selectedModel,
        }),
      });
      const data = await response.json();
      const replyText = data.error || data.reply || "Нет ответа от сервера.";
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: replyText },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Ошибка соединения с сервером.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const toggleCheck = (key: string) => {
    setCheckedItems((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleCopy = (fileName: string) => {
    const content = repoFiles[fileName] || "";
    navigator.clipboard.writeText(content);
    setCopiedFile(fileName);
    setTimeout(() => setCopiedFile(null), 2000);
  };

  const filteredReminders = reminders.filter(
    (r) => showAllDates || r.date === selectedDate
  );

  const groupedByDate = filteredReminders.reduce<Record<string, ReminderItem[]>>(
    (acc, item) => {
      if (!acc[item.date]) {
        acc[item.date] = [];
      }
      acc[item.date].push(item);
      return acc;
    },
    {}
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Простая верхняя панель */}
      <header className="border-b border-slate-200 bg-white px-4 py-3">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-base font-semibold text-slate-900">
              Послеоперационное сопровождение при переломах ({selectedModel})
            </h1>
            <p className="text-xs text-slate-500">
              Валидация JSON (Pydantic) · Повторение курсов на 1–2 месяца по конкретным датам календаря
            </p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-slate-500">Модель:</span>
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="border border-slate-300 rounded-md px-2 py-1 text-xs bg-white text-slate-800"
              >
                <option value="GigaChat-Pro">GigaChat-Pro</option>
                <option value="GigaChat-Max">GigaChat-Max</option>
                <option value="GigaChat">GigaChat</option>
              </select>
            </div>

            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              <button
                type="button"
                onClick={() => setActiveTab("app")}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                  activeTab === "app"
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span>Чат + Расписание</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("files")}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                  activeTab === "files"
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <FileCode className="w-3.5 h-3.5" />
                <span>Код для GitHub (Python)</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {activeTab === "app" ? (
        <main className="flex-1 max-w-6xl w-full mx-auto p-4 grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* ЛЕВАЯ КОЛОНКА: ДИАЛОГ */}
          <section className="lg:col-span-6 bg-white border border-slate-200 rounded-lg p-4 flex flex-col">
            <h2 className="text-sm font-semibold text-slate-900 mb-3">
              1. Диалог с пациентом
            </h2>

            <div className="flex-1 overflow-y-auto space-y-3 min-h-[380px] max-h-[62vh] pr-1">
              {messages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`flex ${
                    msg.role === "user" ? "justify-end" : "justify-start"
                  }`}
                >
                  <div
                    className={`max-w-[85%] rounded-lg px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                      msg.role === "user"
                        ? "bg-slate-900 text-white"
                        : "bg-slate-100 text-slate-800"
                    }`}
                  >
                    <div className="text-[11px] opacity-65 mb-0.5 font-medium">
                      {msg.role === "user" ? "Пациент" : "GigaChat Companion"}
                    </div>
                    {msg.content}
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex justify-start">
                  <div className="bg-slate-100 text-slate-600 rounded-lg px-3.5 py-2.5 text-sm">
                    Печатает ответ...
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <form onSubmit={handleSend} className="mt-3 flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Введите вопрос..."
                className="flex-1 bg-white border border-slate-300 rounded-lg px-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-slate-600"
              />
              <button
                type="submit"
                disabled={loading || !input.trim()}
                className="bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Send className="w-4 h-4" />
                <span>Отправить</span>
              </button>
            </form>
          </section>

          {/* ПРАВАЯ КОЛОНКА: ПРИКРЕПЛЕНИЕ РЕКОМЕНДАЦИЙ И КАЛЕНДАРНОЕ РАСПИСАНИЕ */}
          <section className="lg:col-span-6 bg-white border border-slate-200 rounded-lg p-4 flex flex-col gap-4">
            <h2 className="text-sm font-semibold text-slate-900">
              2. Календарное расписание (Daily Check-in)
            </h2>

            {!scheduleGenerated ? (
              <div className="space-y-3">
                <div className="p-3 rounded-lg bg-slate-100 text-xs text-slate-700">
                  Прикрепите файл с рекомендациями врача (<code>.txt</code>) или проверьте текст выписки ниже. ИИ (<strong>{selectedModel}</strong>) один раз извлечёт правила, проверит JSON через валидатор и развернёт повторяющиеся курсы (например, на 2 месяца = 60 дней) по конкретным датам календаря.
                </div>

                <div>
                  <label className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium border border-slate-300 rounded-lg bg-white hover:bg-slate-50 cursor-pointer">
                    <Paperclip className="w-3.5 h-3.5" />
                    <span>Прикрепить файл рекомендаций (.txt)</span>
                    <input
                      type="file"
                      accept=".txt"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                  </label>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Текст рекомендаций из выписки:
                  </label>
                  <textarea
                    value={recommendationsText}
                    onChange={(e) => setRecommendationsText(e.target.value)}
                    rows={7}
                    className="w-full border border-slate-300 rounded-lg p-2.5 text-xs font-mono text-slate-800 focus:outline-none focus:border-slate-600"
                  />
                </div>

                <button
                  type="button"
                  onClick={handleGenerateScheduleOnce}
                  disabled={generatingSchedule || !recommendationsText.trim()}
                  className="w-full bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white py-2.5 px-4 rounded-lg text-sm font-medium transition-colors cursor-pointer"
                >
                  {generatingSchedule
                    ? "ИИ валидирует JSON и строит календарь на 2 месяца..."
                    : "Прикрепить рекомендации и сформировать расписание"}
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-3 flex-1">
                <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-900">
                  Расписание сформировано и проверено валидатором ({usedModelName}, всего записей в календаре: <strong>{reminders.length}</strong>).
                </div>

                {/* Выбор конкретной даты в календаре */}
                <div className="flex items-center justify-between gap-3 flex-wrap border-b border-slate-200 pb-2.5">
                  <div className="flex items-center gap-2 text-xs">
                    <Calendar className="w-3.5 h-3.5 text-slate-600" />
                    <span className="font-medium text-slate-700">Дата календаря:</span>
                    <input
                      type="date"
                      value={selectedDate}
                      onChange={(e) => setSelectedDate(e.target.value)}
                      className="border border-slate-300 rounded px-2 py-1 text-xs font-mono"
                    />
                  </div>

                  <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showAllDates}
                      onChange={(e) => setShowAllDates(e.target.checked)}
                      className="rounded border-slate-300"
                    />
                    <span>Показать все даты ({reminders.length})</span>
                  </label>
                </div>

                {/* Список напоминаний */}
                <div className="space-y-4 overflow-y-auto max-h-[55vh] pr-1">
                  {Object.keys(groupedByDate).length === 0 ? (
                    <div className="text-xs text-slate-500 py-4">
                      На выбранную дату ({selectedDate}) напоминаний нет.
                    </div>
                  ) : (
                    Object.entries(groupedByDate).map(([dateKey, items]) => (
                      <div key={dateKey} className="space-y-1.5">
                        <div className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5 text-slate-500" />
                          <span>{dateKey}</span>
                        </div>
                        {items.map((item, idx) => {
                          const checkKey = `${item.date}_${item.time}_${item.title}_${idx}`;
                          const isChecked = Boolean(checkedItems[checkKey]);
                          return (
                            <label
                              key={checkKey}
                              className="flex items-start gap-2.5 p-2.5 rounded-md border border-slate-200 hover:bg-slate-50 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => toggleCheck(checkKey)}
                                className="mt-0.5 rounded border-slate-300"
                              />
                              <div className="text-xs leading-relaxed">
                                <div
                                  className={
                                    isChecked
                                      ? "line-through text-slate-400"
                                      : "text-slate-900"
                                  }
                                >
                                  <span className="font-mono font-semibold">
                                    {item.time}
                                  </span>{" "}
                                  —{" "}
                                  <span className="font-semibold">
                                    {item.title}
                                  </span>
                                </div>
                                <div className="text-slate-500 mt-0.5">
                                  {item.description}
                                </div>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </section>
        </main>
      ) : (
        <main className="flex-1 max-w-6xl w-full mx-auto p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
              {["app.py", "README.md", "requirements.txt", ".env.example"].map(
                (fileName) => (
                  <button
                    key={fileName}
                    type="button"
                    onClick={() => setSelectedFile(fileName)}
                    className={`px-3 py-1.5 text-xs font-mono rounded-md transition-colors cursor-pointer ${
                      selectedFile === fileName
                        ? "bg-white text-slate-900 shadow-xs font-semibold"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    {fileName}
                  </button>
                )
              )}
            </div>

            <button
              type="button"
              onClick={() => handleCopy(selectedFile)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-slate-300 rounded-lg hover:bg-slate-50 text-slate-700 cursor-pointer"
            >
              {copiedFile === selectedFile ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Скопировано</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Скопировать {selectedFile}</span>
                </>
              )}
            </button>
          </div>

          <div className="bg-slate-900 text-slate-100 rounded-lg p-4 overflow-x-auto border border-slate-800 flex-1">
            <pre className="text-xs font-mono leading-relaxed whitespace-pre-wrap">
              {repoFiles[selectedFile] || "Загрузка..."}
            </pre>
          </div>
        </main>
      )}
    </div>
  );
}
