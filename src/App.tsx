import React, { useState, useEffect, useRef } from "react";
import { Send, Copy, Check, FileCode, MessageSquare } from "lucide-react";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<"chat" | "files">("chat");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "Здравствуйте! Я ваш цифровой помощник по восстановлению после операции. Как вы себя чувствуете сегодня?",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const [repoFiles, setRepoFiles] = useState<Record<string, string>>({});
  const [selectedFile, setSelectedFile] = useState<string>("README.md");
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
        body: JSON.stringify({ messages: nextMessages }),
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

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Простая верхняя панель */}
      <header className="border-b border-slate-200 bg-white px-4 py-3">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-4">
          <div>
            <h1 className="text-base font-semibold text-slate-900">
              Чат сопровождения пациента (GigaChat)
            </h1>
            <p className="text-xs text-slate-500">
              AI Post-Operative Recovery Platform · Initial Commit (Python + Streamlit)
            </p>
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setActiveTab("chat")}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                activeTab === "chat"
                  ? "bg-white text-slate-900 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>Диалог</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("files")}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                activeTab === "files"
                  ? "bg-white text-slate-900 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <FileCode className="w-3.5 h-3.5" />
              <span>Файлы для GitHub (Python)</span>
            </button>
          </div>
        </div>
      </header>

      {/* Основная область */}
      {activeTab === "chat" ? (
        <main className="flex-1 max-w-3xl w-full mx-auto flex flex-col p-4">
          <div className="flex-1 bg-white border border-slate-200 rounded-lg p-4 overflow-y-auto space-y-3 min-h-[420px] max-h-[70vh]">
            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={`flex ${
                  msg.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                <div
                  className={`max-w-[80%] rounded-lg px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
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
              placeholder="Введите сообщение..."
              className="flex-1 bg-white border border-slate-300 rounded-lg px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-slate-600"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg text-sm font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Send className="w-4 h-4" />
              <span>Отправить</span>
            </button>
          </form>
        </main>
      ) : (
        <main className="flex-1 max-w-3xl w-full mx-auto p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
              {["README.md", "app.py", "requirements.txt", ".env.example"].map(
                (fileName) => (
                  <button
                    key={fileName}
                    type="button"
                    onClick={() => setSelectedFile(fileName)}
                    className={`px-3 py-1.5 text-xs font-mono rounded-md transition-colors ${
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
