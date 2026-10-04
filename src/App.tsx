import React, { useState, useEffect, useRef } from "react";
import {
  Send,
  Copy,
  Check,
  FileCode,
  MessageSquare,
  Paperclip,
  Calendar,
  Database,
  UserPlus,
  LogIn,
  LogOut,
  Plus,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

type ProcStatus = "waiting" | "skipped" | "performed";

interface DbUser {
  id: number;
  phone: string;
  login: string;
  password_hash?: string;
  registered_at: string;
  last_login_at: string | null;
}

interface RuleItem {
  title: string;
  description: string;
  times: string[];
  start_offset_days: number;
  duration_days: number;
  interval_days: number;
}

interface DbProtocol {
  id: number;
  user_id: number;
  raw_text: string;
  protocol: {
    start_date: string;
    model: string;
    rules: RuleItem[];
    total_reminders: number;
  };
  uploaded_at: string;
}

interface DbScheduleItem {
  id: number;
  user_id: number;
  protocol_id: number | null;
  procedure: string;
  description: string;
  time_to_do: string;
  date: string;
  time: string;
  proc_status: ProcStatus;
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

  const [activeTab, setActiveTab] = useState<"app" | "db" | "files">("app");
  const [selectedModel, setSelectedModel] = useState<string>("GigaChat-Pro");
  const [usedModelName, setUsedModelName] = useState<string>("GigaChat-Pro");

  // Состояние авторизации (таблица `users`)
  const [currentUser, setCurrentUser] = useState<DbUser | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [loginInput, setLoginInput] = useState<string>("ivan_petrov");
  const [phoneInput, setPhoneInput] = useState<string>("+79991234567");
  const [passwordInput, setPasswordInput] = useState<string>("123456");
  const [authError, setAuthError] = useState<string>("");
  const [authLoading, setAuthLoading] = useState<boolean>(false);

  // Данные пользователя из БД (`protocols` и `schedule`)
  const [protocols, setProtocols] = useState<DbProtocol[]>([]);
  const [schedule, setSchedule] = useState<DbScheduleItem[]>([]);
  const [showUploadForm, setShowUploadForm] = useState<boolean>(true);
  const [showProtocolsJson, setShowProtocolsJson] = useState<boolean>(false);

  // Обзор всех таблиц БД для вкладки «Таблицы БД»
  const [dbOverview, setDbOverview] = useState<{
    users: DbUser[];
    protocols: DbProtocol[];
    schedule: DbScheduleItem[];
  }>({ users: [], protocols: [], schedule: [] });

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "Здравствуйте! Я ваш помощник по послеоперационному сопровождению при переломах. Загрузите справа список рекомендаций из вашей выписки, чтобы я сформировал JSON протокола, сохранил его в таблицу protocols и развернул календарное расписание в таблицу schedule.",
    },
  ]);

  const [recommendationsText, setRecommendationsText] = useState<string>(
    DEFAULT_SAMPLE_RECOMMENDATIONS
  );
  const [generatingSchedule, setGeneratingSchedule] = useState<boolean>(false);
  const [scheduleError, setScheduleError] = useState<string>("");
  const [showAllDates, setShowAllDates] = useState<boolean>(false);
  const [selectedDate, setSelectedDate] = useState<string>(todayIso);

  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const [repoFiles, setRepoFiles] = useState<Record<string, string>>({});
  const [selectedFile, setSelectedFile] = useState<string>("schema.sql");
  const [copiedFile, setCopiedFile] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const fetchDbOverview = () => {
    fetch("/api/db/overview")
      .then((res) => res.json())
      .then((data) => {
        if (data && Array.isArray(data.users)) {
          setDbOverview(data);
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    fetch("/api/files")
      .then((res) => res.json())
      .then((data) => {
        if (data.files) {
          setRepoFiles(data.files);
        }
      })
      .catch(() => {});
    fetchDbOverview();
  }, []);

  useEffect(() => {
    if (activeTab === "db") {
      fetchDbOverview();
    }
  }, [activeTab]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");
    setAuthLoading(true);
    try {
      const endpoint =
        authMode === "register" ? "/api/auth/register" : "/api/auth/login";
      const payload =
        authMode === "register"
          ? {
              login: loginInput.trim(),
              phone: phoneInput.trim(),
              password: passwordInput,
            }
          : {
              loginOrPhone: loginInput.trim(),
              password: passwordInput,
            };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setAuthError(data.error || "Ошибка авторизации");
        return;
      }

      setCurrentUser(data.user);
      const loadedProtocols: DbProtocol[] = Array.isArray(data.protocols)
        ? data.protocols
        : [];
      const loadedSchedule: DbScheduleItem[] = Array.isArray(data.schedule)
        ? data.schedule
        : [];
      setProtocols(loadedProtocols);
      setSchedule(loadedSchedule);
      setShowUploadForm(loadedSchedule.length === 0);
      fetchDbOverview();
    } catch {
      setAuthError("Ошибка соединения с сервером");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setProtocols([]);
    setSchedule([]);
    setAuthError("");
  };

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

  // Формирование JSON протокола и сохранение протокола + расписания в БД
  const handleGenerateAndSaveToDb = async () => {
    if (!currentUser || !recommendationsText.trim() || generatingSchedule) {
      return;
    }
    setGeneratingSchedule(true);
    setScheduleError("");
    try {
      const response = await fetch("/api/generate-schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: currentUser.id,
          recommendationsText: recommendationsText.trim(),
          startDate: todayIso,
          model: selectedModel,
        }),
      });
      const data = await response.json();
      if (!response.ok || data.error) {
        setScheduleError(data.error || "Ошибка сохранения в БД");
        return;
      }
      if (Array.isArray(data.protocols)) {
        setProtocols(data.protocols);
      }
      if (Array.isArray(data.schedule)) {
        setSchedule(data.schedule);
        setShowUploadForm(false);
      }
      if (data.usedModel) {
        setUsedModelName(data.usedModel);
      }
      fetchDbOverview();
    } catch {
      setScheduleError("Ошибка сети при сохранении расписания");
    } finally {
      setGeneratingSchedule(false);
    }
  };

  const handleUpdateStatus = async (
    scheduleId: number,
    newStatus: ProcStatus
  ) => {
    if (!currentUser) return;
    // Оптимистичное обновление в UI
    setSchedule((prev) =>
      prev.map((item) =>
        item.id === scheduleId ? { ...item, proc_status: newStatus } : item
      )
    );
    try {
      const res = await fetch(`/api/schedule/${scheduleId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: currentUser.id,
          proc_status: newStatus,
        }),
      });
      const data = await res.json();
      if (Array.isArray(data.schedule)) {
        setSchedule(data.schedule);
      }
      fetchDbOverview();
    } catch {
      // ignore
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

    const latestProtocolText =
      protocols.length > 0 ? protocols[0].raw_text : recommendationsText;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages,
          recommendationsText: latestProtocolText,
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

  const handleCopy = (fileName: string) => {
    const content = repoFiles[fileName] || "";
    navigator.clipboard.writeText(content);
    setCopiedFile(fileName);
    setTimeout(() => setCopiedFile(null), 2000);
  };

  const filteredSchedule = schedule.filter(
    (r) => showAllDates || r.date === selectedDate
  );

  const groupedByDate = filteredSchedule.reduce<
    Record<string, DbScheduleItem[]>
  >((acc, item) => {
    if (!acc[item.date]) {
      acc[item.date] = [];
    }
    acc[item.date].push(item);
    return acc;
  }, {});

  const statusBadgeClass = (st: ProcStatus) => {
    if (st === "performed") {
      return "bg-emerald-50 text-emerald-800 border-emerald-300";
    }
    if (st === "skipped") {
      return "bg-amber-50 text-amber-800 border-amber-300";
    }
    return "bg-slate-50 text-slate-700 border-slate-300";
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Верхняя панель */}
      <header className="border-b border-slate-200 bg-white px-4 py-3">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-base font-semibold text-slate-900">
              Послеоперационное сопровождение при переломах ({selectedModel} + БД)
            </h1>
            <p className="text-xs text-slate-500">
              Таблицы БД: <code>users</code> (регистрация/вход) ·{" "}
              <code>protocols</code> (JSON выписки) · <code>schedule</code>{" "}
              (расписание и статус)
            </p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {currentUser && (
              <div className="flex items-center gap-2 bg-slate-100 px-2.5 py-1 rounded-md text-xs">
                <span className="text-slate-700">
                  Пациент: <strong>{currentUser.login}</strong> ({currentUser.phone})
                </span>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="inline-flex items-center gap-1 text-slate-600 hover:text-red-600 font-medium ml-1 cursor-pointer"
                  title="Выйти из аккаунта"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Выйти</span>
                </button>
              </div>
            )}

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
                onClick={() => setActiveTab("db")}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                  activeTab === "db"
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <Database className="w-3.5 h-3.5" />
                <span>Таблицы БД</span>
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
                <span>Код для GitHub (Python + SQL)</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* ВКЛАДКА 1: ОСНОВНОЕ ПРИЛОЖЕНИЕ */}
      {activeTab === "app" && (
        <>
          {!currentUser ? (
            /* ФОРМА ВХОДА ИЛИ РЕГИСТРАЦИИ В БАЗЕ ДАННЫХ */
            <main className="flex-1 max-w-md w-full mx-auto p-4 flex flex-col justify-center">
              <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-4">
                <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900">
                      {authMode === "login"
                        ? "Вход в личный кабинет пациента"
                        : "Регистрация нового пациента в БД"}
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Запись в таблицу <code>users</code> (phone, login, password_hash)
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg">
                  <button
                    type="button"
                    onClick={() => {
                      setAuthMode("login");
                      setAuthError("");
                    }}
                    className={`flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                      authMode === "login"
                        ? "bg-white text-slate-900 shadow-xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    <LogIn className="w-3.5 h-3.5" />
                    <span>Вход</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAuthMode("register");
                      setAuthError("");
                      setLoginInput("");
                      setPhoneInput("");
                      setPasswordInput("");
                    }}
                    className={`flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                      authMode === "register"
                        ? "bg-white text-slate-900 shadow-xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    <span>Регистрация</span>
                  </button>
                </div>

                {authError && (
                  <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                    {authError}
                  </div>
                )}

                <form onSubmit={handleAuthSubmit} className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      {authMode === "login"
                        ? "Логин или номер телефона:"
                        : "Логин (уникальный, до 50 символов):"}
                    </label>
                    <input
                      type="text"
                      value={loginInput}
                      onChange={(e) => setLoginInput(e.target.value)}
                      placeholder="например, ivan_petrov"
                      required
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-slate-600"
                    />
                  </div>

                  {authMode === "register" && (
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Номер телефона (уникальный, до 20 символов):
                      </label>
                      <input
                        type="tel"
                        value={phoneInput}
                        onChange={(e) => setPhoneInput(e.target.value)}
                        placeholder="+79991234567"
                        required
                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-slate-600"
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Пароль:
                    </label>
                    <input
                      type="password"
                      value={passwordInput}
                      onChange={(e) => setPasswordInput(e.target.value)}
                      placeholder="Введите пароль"
                      required
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-slate-600"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={authLoading}
                    className="w-full bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white py-2.5 px-4 rounded-lg text-sm font-medium transition-colors cursor-pointer"
                  >
                    {authLoading
                      ? "Проверка..."
                      : authMode === "login"
                      ? "Войти в систему"
                      : "Зарегистрироваться в БД"}
                  </button>
                </form>

                {authMode === "login" && (
                  <div className="pt-2 border-t border-slate-100 text-[11px] text-slate-500">
                    Тестовый аккаунт в БД: логин <code>ivan_petrov</code> (или{" "}
                    <code>+79991234567</code>), пароль <code>123456</code>. Или
                    переключитесь на вкладку «Регистрация», чтобы создать нового
                    пользователя.
                  </div>
                )}
              </div>
            </main>
          ) : (
            /* ОСНОВНОЙ ИНТЕРФЕЙС АВТОРИЗОВАННОГО ПАЦИЕНТА */
            <main className="flex-1 max-w-6xl w-full mx-auto p-4 grid grid-cols-1 lg:grid-cols-12 gap-4">
              {/* ЛЕВАЯ КОЛОНКА: ДИАЛОГ */}
              <section className="lg:col-span-6 bg-white border border-slate-200 rounded-lg p-4 flex flex-col">
                <h2 className="text-sm font-semibold text-slate-900 mb-3">
                  1. Диалог с пациентом ({currentUser.login})
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
                          {msg.role === "user"
                            ? currentUser.login
                            : "GigaChat Companion"}
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
                    placeholder="Введите вопрос по вашей выписке..."
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

              {/* ПРАВАЯ КОЛОНКА: ЗАГРУЗКА ПРОТОКОЛА В БД И КАЛЕНДАРНОЕ РАСПИСАНИЕ */}
              <section className="lg:col-span-6 bg-white border border-slate-200 rounded-lg p-4 flex flex-col gap-4">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <h2 className="text-sm font-semibold text-slate-900">
                    2. Протоколы (JSON) и расписание в БД
                  </h2>
                  {schedule.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowUploadForm((prev) => !prev)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 px-2.5 py-1 rounded-md cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>
                        {showUploadForm
                          ? "Скрыть форму загрузки"
                          : "Загрузить ещё протокол"}
                      </span>
                    </button>
                  )}
                </div>

                {scheduleError && (
                  <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                    {scheduleError}
                  </div>
                )}

                {showUploadForm && (
                  <div className="space-y-3 p-3.5 rounded-lg border border-slate-200 bg-slate-50/60">
                    <div className="text-xs text-slate-700">
                      Прикрепите файл с рекомендациями врача (<code>.txt</code>)
                      или отредактируйте текст ниже. После валидации JSON
                      сохраняется в таблицу <code>protocols</code>, а
                      развёрнутое расписание — в таблицу <code>schedule</code>.
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
                        rows={6}
                        className="w-full border border-slate-300 bg-white rounded-lg p-2.5 text-xs font-mono text-slate-800 focus:outline-none focus:border-slate-600"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={handleGenerateAndSaveToDb}
                      disabled={
                        generatingSchedule || !recommendationsText.trim()
                      }
                      className="w-full bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white py-2.5 px-4 rounded-lg text-sm font-medium transition-colors cursor-pointer"
                    >
                      {generatingSchedule
                        ? "Формирование JSON и запись в таблицы protocols и schedule..."
                        : "Сформировать JSON протокола и сохранить расписание в БД"}
                    </button>
                  </div>
                )}

                {/* Блок просмотра сохранённых JSON-протоколов в БД */}
                {protocols.length > 0 && (
                  <div className="border border-slate-200 rounded-lg overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setShowProtocolsJson((prev) => !prev)}
                      className="w-full flex items-center justify-between px-3 py-2 bg-slate-100 hover:bg-slate-200/70 text-xs font-medium text-slate-800 cursor-pointer"
                    >
                      <span>
                        Сохранённые протоколы в таблице <code>protocols</code> (
                        {protocols.length})
                      </span>
                      {showProtocolsJson ? (
                        <ChevronUp className="w-4 h-4" />
                      ) : (
                        <ChevronDown className="w-4 h-4" />
                      )}
                    </button>
                    {showProtocolsJson && (
                      <div className="p-3 bg-slate-900 text-slate-100 max-h-52 overflow-y-auto space-y-2">
                        {protocols.map((p) => (
                          <div key={p.id} className="text-[11px] font-mono">
                            <div className="text-emerald-400 mb-1">
                              // protocol_id: {p.id} | user_id: {p.user_id} |
                              uploaded_at: {p.uploaded_at}
                            </div>
                            <pre className="whitespace-pre-wrap">
                              {JSON.stringify(p.protocol, null, 2)}
                            </pre>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Отображение расписания из таблицы `schedule` */}
                {schedule.length > 0 && (
                  <div className="flex flex-col gap-3 flex-1">
                    <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-900">
                      Протокол (JSON) и расписание сохранены в БД (
                      {usedModelName}, записей в таблице <code>schedule</code>:{" "}
                      <strong>{schedule.length}</strong>).
                    </div>

                    <div className="flex items-center justify-between gap-3 flex-wrap border-b border-slate-200 pb-2.5">
                      <div className="flex items-center gap-2 text-xs">
                        <Calendar className="w-3.5 h-3.5 text-slate-600" />
                        <span className="font-medium text-slate-700">
                          Дата календаря:
                        </span>
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
                        <span>Показать все даты ({schedule.length})</span>
                      </label>
                    </div>

                    <div className="space-y-4 overflow-y-auto max-h-[50vh] pr-1">
                      {Object.keys(groupedByDate).length === 0 ? (
                        <div className="text-xs text-slate-500 py-4">
                          На выбранную дату ({selectedDate}) записей в таблице{" "}
                          <code>schedule</code> нет.
                        </div>
                      ) : (
                        Object.entries(groupedByDate).map(
                          ([dateKey, items]) => (
                            <div key={dateKey} className="space-y-1.5">
                              <div className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                                <Calendar className="w-3.5 h-3.5 text-slate-500" />
                                <span>{dateKey}</span>
                              </div>
                              {items.map((item) => (
                                <div
                                  key={item.id}
                                  className="flex items-start justify-between gap-3 p-2.5 rounded-md border border-slate-200 hover:bg-slate-50"
                                >
                                  <div className="text-xs leading-relaxed">
                                    <div
                                      className={
                                        item.proc_status === "performed"
                                          ? "line-through text-slate-400"
                                          : "text-slate-900"
                                      }
                                    >
                                      <span className="font-mono font-semibold">
                                        {item.time}
                                      </span>{" "}
                                      —{" "}
                                      <span className="font-semibold">
                                        {item.procedure}
                                      </span>
                                    </div>
                                    <div className="text-slate-500 mt-0.5">
                                      {item.description}
                                    </div>
                                  </div>

                                  <select
                                    value={item.proc_status}
                                    onChange={(e) =>
                                      handleUpdateStatus(
                                        item.id,
                                        e.target.value as ProcStatus
                                      )
                                    }
                                    className={`border rounded px-2 py-1 text-[11px] font-medium shrink-0 cursor-pointer ${statusBadgeClass(
                                      item.proc_status
                                    )}`}
                                  >
                                    <option value="waiting">
                                      ⏳ waiting (Ожидает)
                                    </option>
                                    <option value="performed">
                                      ✅ performed (Выполнено)
                                    </option>
                                    <option value="skipped">
                                      ⏭️ skipped (Пропущено)
                                    </option>
                                  </select>
                                </div>
                              ))}
                            </div>
                          )
                        )
                      )}
                    </div>
                  </div>
                )}
              </section>
            </main>
          )}
        </>
      )}

      {/* ВКЛАДКА 2: ОБЗОР ТАБЛИЦ БАЗЫ ДАННЫХ */}
      {activeTab === "db" && (
        <main className="flex-1 max-w-6xl w-full mx-auto p-4 space-y-6">
          <div className="bg-white border border-slate-200 rounded-lg p-4">
            <h2 className="text-sm font-semibold text-slate-900 mb-2">
              1. Таблица <code>users</code> (Зарегистрированные пользователи:{" "}
              {dbOverview.users.length})
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                    <th className="py-2 px-3 font-mono">id</th>
                    <th className="py-2 px-3 font-mono">login</th>
                    <th className="py-2 px-3 font-mono">phone</th>
                    <th className="py-2 px-3 font-mono">password_hash</th>
                    <th className="py-2 px-3 font-mono">registered_at</th>
                    <th className="py-2 px-3 font-mono">last_login_at</th>
                  </tr>
                </thead>
                <tbody>
                  {dbOverview.users.map((u) => (
                    <tr key={u.id} className="border-b border-slate-100">
                      <td className="py-2 px-3 font-mono font-semibold">
                        {u.id}
                      </td>
                      <td className="py-2 px-3 font-medium">{u.login}</td>
                      <td className="py-2 px-3 font-mono">{u.phone}</td>
                      <td className="py-2 px-3 font-mono text-slate-400 max-w-[180px] truncate">
                        {u.password_hash}
                      </td>
                      <td className="py-2 px-3 font-mono text-slate-500">
                        {u.registered_at}
                      </td>
                      <td className="py-2 px-3 font-mono text-slate-500">
                        {u.last_login_at || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-4">
            <h2 className="text-sm font-semibold text-slate-900 mb-2">
              2. Таблица <code>protocols</code> (Загруженные протоколы в JSON:{" "}
              {dbOverview.protocols.length})
            </h2>
            {dbOverview.protocols.length === 0 ? (
              <p className="text-xs text-slate-500">
                Записей пока нет. Загрузите выписку во вкладке «Чат + Расписание».
              </p>
            ) : (
              <div className="space-y-3">
                {dbOverview.protocols.map((p) => (
                  <div
                    key={p.id}
                    className="border border-slate-200 rounded-lg p-3 bg-slate-50 text-xs space-y-1.5"
                  >
                    <div className="flex items-center justify-between flex-wrap gap-2 font-mono text-slate-700">
                      <span>
                        <strong>id:</strong> {p.id} | <strong>user_id:</strong>{" "}
                        {p.user_id}
                      </span>
                      <span>
                        <strong>uploaded_at:</strong> {p.uploaded_at}
                      </span>
                    </div>
                    <pre className="bg-slate-900 text-slate-100 p-2.5 rounded text-[11px] font-mono overflow-x-auto">
                      {JSON.stringify(p.protocol, null, 2)}
                    </pre>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-4">
            <h2 className="text-sm font-semibold text-slate-900 mb-2">
              3. Таблица <code>schedule</code> (Календарное расписание:{" "}
              {dbOverview.schedule.length} записей, показаны первые 50)
            </h2>
            {dbOverview.schedule.length === 0 ? (
              <p className="text-xs text-slate-500">
                Записей пока нет. Сформируйте расписание из протокола.
              </p>
            ) : (
              <div className="overflow-x-auto max-h-96">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                      <th className="py-2 px-3 font-mono">id</th>
                      <th className="py-2 px-3 font-mono">user_id</th>
                      <th className="py-2 px-3 font-mono">protocol_id</th>
                      <th className="py-2 px-3 font-mono">procedure</th>
                      <th className="py-2 px-3 font-mono">time_to_do</th>
                      <th className="py-2 px-3 font-mono">proc_status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dbOverview.schedule.slice(0, 50).map((s) => (
                      <tr key={s.id} className="border-b border-slate-100">
                        <td className="py-2 px-3 font-mono">{s.id}</td>
                        <td className="py-2 px-3 font-mono">{s.user_id}</td>
                        <td className="py-2 px-3 font-mono">
                          {s.protocol_id ?? "—"}
                        </td>
                        <td className="py-2 px-3 font-medium">{s.procedure}</td>
                        <td className="py-2 px-3 font-mono text-slate-600">
                          {s.time_to_do}
                        </td>
                        <td className="py-2 px-3 font-mono">
                          <span
                            className={`px-2 py-0.5 rounded border text-[11px] ${statusBadgeClass(
                              s.proc_status
                            )}`}
                          >
                            {s.proc_status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </main>
      )}

      {/* ВКЛАДКА 3: ФАЙЛЫ ДЛЯ GITHUB (PYTHON + SQL) */}
      {activeTab === "files" && (
        <main className="flex-1 max-w-6xl w-full mx-auto p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg flex-wrap">
              {[
                "schema.sql",
                "db.py",
                "app.py",
                "requirements.txt",
                ".env.example",
                "README.md",
              ].map((fileName) => (
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
              ))}
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
