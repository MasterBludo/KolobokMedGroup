import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { api, Patient, PlanSnapshot, PlanPreview, patientToday } from './api';

interface Message {
  id: string;
  sender: 'assistant' | 'user';
  text: string;
  documentReview?: boolean;
}

interface ChatInputProps {
  disabled: boolean;
  resetKey: number;
  draft: { text: string } | null;
  onHasInputChange: (hasInput: boolean) => void;
  onSendMessage: (message: string) => void;
}

interface TaskItem {
  id: string;
  text: string;
  completed: boolean;
}

interface ReminderItem {
  date: string;
  time: string;
  title: string;
}

const DEFAULT_AVATAR_URL = new URL('./assets/images/default_user_avatar_1791136890330.jpg', import.meta.url).href;
const TRAIL_RUNNER_BG_URL = new URL('./assets/images/trail_runner_bg_1791136878819.jpg', import.meta.url).href;

interface ConditionNode { label: string; children?: ConditionNode[] }
const CONDITIONS: ConditionNode[] = [
  { label: 'Травмы, отравления и некоторые другие последствия воздействия внешних причин', children: [
    { label: 'Травмы запястья и кисти', children: [
      { label: 'Перелом на уровне запястья и кисти', children: [
        { label: 'Перелом другого пальца кисти', children: [
          { label: 'Перелом фаланги мизинца' },
        ] },
      ] },
    ] },
  ] },
  { label: 'Болезни органов пищеварения', children: [
    { label: 'Болезни желчного пузыря, желчевыводящих путей и поджелудочной железы', children: [
      { label: 'Холецистит' },
    ] },
  ] },
];

function ConditionSelector({ onClose, onSelect }: { onClose: () => void; onSelect: (label: string) => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [path, setPath] = useState<ConditionNode[]>([]);
  const nodes = path.at(-1)?.children || CONDITIONS;
  useEffect(() => {
    const dialog = dialogRef.current!;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.showModal();
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);
  useEffect(() => { dialogRef.current?.querySelector<HTMLButtonElement>('[data-condition]')?.focus(); }, [path]);
  return (
    <dialog ref={dialogRef} className="condition-dialog" aria-labelledby="condition-title" onCancel={e => { e.preventDefault(); onClose(); }}
      onClick={e => { if (e.target === e.currentTarget) { const r = e.currentTarget.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) onClose(); } }}
      onKeyDown={e => {
        if (e.key === 'Tab') {
          const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button'));
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          e.preventDefault();
          buttons[(index + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
        }
        if (e.key === 'ArrowLeft' && path.length) { e.preventDefault(); setPath(p => p.slice(0, -1)); }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
          const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[data-condition]'));
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
          e.preventDefault(); buttons[next]?.focus();
        }
      }}>
      <div className="condition-heading"><h2 id="condition-title">Выберите операцию</h2><button type="button" aria-label="Закрыть выбор операции" onClick={onClose}>×</button></div>
      {!!path.length && <button type="button" className="condition-back" onClick={() => setPath(p => p.slice(0, -1))}>← Назад</button>}
      {!!path.length && <p className="condition-parent">{path.at(-1)?.label}</p>}
      <div className="condition-options">
        {nodes.map(node => <button type="button" data-condition key={node.label} onClick={() => node.children ? setPath(p => [...p, node]) : onSelect(node.label)}><span>{node.label}</span>{node.children && <span aria-hidden="true">›</span>}</button>)}
      </div>
    </dialog>
  );
}

function ChatInput({
  disabled,
  resetKey,
  draft,
  onHasInputChange,
  onSendMessage,
}: ChatInputProps) {
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setInputValue('');
  }, [resetKey]);

  useEffect(() => {
    if (!draft) return;
    setInputValue(draft.text);
    onHasInputChange(!!draft.text);
    inputRef.current?.focus();
  }, [draft, onHasInputChange]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = inputValue.trim();
    if (!trimmed || disabled) return;

    onSendMessage(trimmed);
    setInputValue('');
    onHasInputChange(false);
    inputRef.current?.focus();
  };

  return (
    <motion.form
      layout
      onSubmit={handleSubmit}
      transition={{ type: 'spring', stiffness: 320, damping: 32 }}
      className="w-full max-w-[584px] h-[68px] bg-white rounded-[22px] border border-[#EFEFEF] shadow-[0_12px_34px_rgba(0,0,0,0.06)] pl-5 pr-3 flex items-center justify-between gap-3 relative z-20"
    >
      <input
        ref={inputRef}
        type="text"
        value={inputValue}
        onChange={(e) => {
          const nextValue = e.target.value;
          if ((inputValue.length === 0) !== (nextValue.length === 0)) {
            onHasInputChange(nextValue.length > 0);
          }
          setInputValue(nextValue);
        }}
        disabled={disabled}
        placeholder="или начните вводить"
        className="flex-1 bg-transparent text-[15px] text-[#1A2E2B] placeholder:text-[#B0B7B5] focus:outline-none"
      />
      <button
        type="submit"
        disabled={!inputValue.trim() || disabled}
        aria-label="Отправить"
        className={`w-[44px] h-[44px] rounded-full flex items-center justify-center shrink-0 transition-all ${
          inputValue.trim().length > 0 && !disabled
            ? 'bg-[#A8C7C7] hover:bg-[#99BABA] active:scale-95 text-[#1A2E2B] opacity-100 cursor-pointer'
            : 'bg-[#A8C7C7]/55 text-[#1A2E2B]/45 opacity-60 cursor-default'
        }`}
      >
        <BowlOfHygieiaIcon className="w-[21px] h-[21px]" />
      </button>
    </motion.form>
  );
}

/**
 * Custom SVG Icons matching the reference screenshots
 */
function BowlOfHygieiaIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* Chalice bowl */}
      <path d="M6.5 10.5C6.5 13 9 14.3 12 14.3C15 14.3 17.5 13 17.5 10.5H6.5Z" />
      {/* Stem & pedestal base */}
      <path d="M12 14.3V19.5" />
      <path d="M8.8 19.5H15.2" />
      {/* Serpent coiling around stem and arching over the bowl */}
      <path d="M10 17.3C10 16.2 14.2 16.1 13.8 14.5" />
      <path d="M12.2 10.5V7.2C12.2 5.4 10.1 4.8 9 6C8.4 6.7 8.8 7.7 9.8 7.9" />
    </svg>
  );
}

function UserCircleOutlineIcon({ className = 'w-[18px] h-[18px]' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="12" cy="12" r="9.5" />
      <circle cx="12" cy="9.5" r="3" />
      <path d="M6.8 19.3C8 16.8 9.8 15.5 12 15.5C14.2 15.5 16 16.8 17.2 19.3" />
    </svg>
  );
}

function CheckCircleOutlineIcon({ className = 'w-[18px] h-[18px]' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="12" cy="12" r="9.5" />
      <path d="M8.8 12.2L11 14.4L15.4 9.8" />
    </svg>
  );
}

function ArrowLeftCircleOutlineIcon({ className = 'w-[18px] h-[18px]' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="12" cy="12" r="9.5" />
      <path d="M13.2 8.8L9.8 12L13.2 15.2" />
    </svg>
  );
}

function StethoscopeOutlineIcon({ className = 'w-[18px] h-[18px]' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M5.5 4.5V9.5C5.5 12.5 7.7 14.8 10.5 14.8C13.3 14.8 15.5 12.5 15.5 9.5V4.5" />
      <path d="M4 4.5H7" />
      <path d="M14 4.5H17" />
      <path d="M10.5 14.8V17.2C10.5 19.3 12.2 21 14.3 21C16.4 21 18.2 19.3 18.2 17.2V13.8" />
      <circle cx="18.2" cy="11.8" r="2" />
    </svg>
  );
}

function DischargeDocOutlineIcon({ className = 'w-[18px] h-[18px]' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M14.5 3.5H7.5C6.4 3.5 5.5 4.4 5.5 5.5V18.5C5.5 19.6 6.4 20.5 7.5 20.5H16.5C17.6 20.5 18.5 19.6 18.5 18.5V7.5L14.5 3.5Z" />
      <path d="M14 3.5V8H18.5" />
      <path d="M8.5 11.5H15.5" />
      <path d="M8.5 14.5H15.5" />
      <path d="M8.5 17.5H12.5" />
    </svg>
  );
}

export default function App() {
  // Core navigation & auth states
  const [isAuthorized, setIsAuthorized] = useState<boolean>(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState<boolean>(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('register');
  const [authEmail, setAuthEmail] = useState<string>('');
  const [authPassword, setAuthPassword] = useState<string>('');
  const [authName, setAuthName] = useState<string>('');
  const [currentScreen, setCurrentScreen] = useState<'main' | 'account'>('main');

  // User Profile states (Name from registration + customizable Avatar)
  const [userName, setUserName] = useState<string>('');
  const [avatarUrl, setAvatarUrl] = useState<string>(DEFAULT_AVATAR_URL);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  // Account sub-modals ("Настройки" & "План реабилитации")
  const [activeAccountModal, setActiveAccountModal] = useState<'settings' | 'plan' | null>(null);
  const [settingsEmailInput, setSettingsEmailInput] = useState('');
  const [settingsPhoneInput, setSettingsPhoneInput] = useState('');
  const [settingsNameInput, setSettingsNameInput] = useState<string>('');

  // Chat & Input states
  const [inputDraft, setInputDraft] = useState<{ text: string } | null>(null);
  const [hasInput, setHasInput] = useState<boolean>(false);
  const [inputResetKey, setInputResetKey] = useState<number>(0);
  const [isSendingMessage, setIsSendingMessage] = useState<boolean>(false);
  const [isUploadingStatement, setIsUploadingStatement] = useState<boolean>(false);
  const [isGeneratingSchedule, setIsGeneratingSchedule] = useState<boolean>(false);
  const [recommendationsText, setRecommendationsText] = useState<string>('');
  const [pendingStatementText, setPendingStatementText] = useState<string | null>(null);
  const [pendingStatementMessageId, setPendingStatementMessageId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      sender: 'assistant',
      text: 'Привет, чем я могу помочь с восстановлением?',
    },
  ]);

  // Operation selection & File attachment states
  const [selectedOperation, setSelectedOperation] = useState<string | null>(null);
  const [isOperationMenuOpen, setIsOperationMenuOpen] = useState<boolean>(false);
  const [attachedFileName, setAttachedFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Tasks hover popover states
  const [isTasksOpen, setIsTasksOpen] = useState<boolean>(false);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const tasksTimeoutRef = useRef<number | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const [patient, setPatient] = useState<Patient | null>(null);
  const [snapshot, setSnapshot] = useState<PlanSnapshot>({ plan:null, prescriptions:[], events:[] });
  const [draftId, setDraftId] = useState<string | null>(null);
  const [startDate, setStartDate] = useState('');
  const [calendarDate, setCalendarDate] = useState('');
  const [calendarMonth, setCalendarMonth] = useState('');
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [planPreview, setPlanPreview] = useState<PlanPreview | null>(null);
  const [conflictDecisions, setConflictDecisions] = useState<Record<string,string>>({});
  const [persistenceError, setPersistenceError] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [restoringSession, setRestoringSession] = useState(true);
  const [savingEvents, setSavingEvents] = useState<string[]>([]);
  const patientRef = useRef<string | null>(null);
  const sessionCheckRef = useRef<AbortController | null>(null);
  const chatRequestRef = useRef<AbortController | null>(null);

  const clearPatientState = () => {
    sessionCheckRef.current?.abort();chatRequestRef.current?.abort();
    setRestoringSession(false);setIsSendingMessage(false);setIsUploadingStatement(false);setIsGeneratingSchedule(false);setIsOperationMenuOpen(false);
    patientRef.current=null;setPatient(null);setIsAuthorized(false);setUserName('');setAvatarUrl(DEFAULT_AVATAR_URL);
    setTasks([]);setSnapshot({plan:null,prescriptions:[],events:[]});
    setStartDate('');setSelectedOperation(null);setCalendarDate('');setSavingEvents([]);
    setDraftId(null);setPlanPreview(null);setCurrentScreen('main');setIsTasksOpen(false);setActiveAccountModal(null);
    setRecommendationsText('');setPendingStatementText(null);setPendingStatementMessageId(null);setAttachedFileName(null);
    setAuthPassword('');setAuthEmail('');setAuthName('');setHasInput(false);setInputResetKey(key=>key+1);
    setMessages([{id:'welcome',sender:'assistant',text:'Привет, чем я могу помочь с восстановлением?'}]);
  };
  useEffect(()=>{
    const expired=()=>{clearPatientState();setPersistenceError('Сессия истекла. Войдите снова.');setIsAuthModalOpen(true);};
    window.addEventListener('recovery-session-expired',expired);
    return ()=>window.removeEventListener('recovery-session-expired',expired);
  },[]);
  const applySnapshot = (value:PlanSnapshot) => {
    setSnapshot(value);
    setRecommendationsText(value.plan?.confirmed_instructions || '');
    setStartDate(value.plan?.recovery_start_date || '');
    setSelectedOperation(value.plan?.procedure_name || null);
  };
  const acceptPatient = async (current:Patient) => {
    patientRef.current=current.id;setPatient(current);setUserName(current.username);setIsAuthorized(true);
    setCalendarDate(patientToday(current.timezone));
    setCalendarMonth(patientToday(current.timezone).slice(0, 7));
    setTasks([]);setSnapshot({plan:null,prescriptions:[],events:[]});
    // Saved data loads separately so a slow plan request cannot block authentication.
    void api<PlanSnapshot>('/plan').then(value => {
      if (patientRef.current===current.id) applySnapshot(value);
    }).catch(error => {if (patientRef.current===current.id) setPersistenceError(error.message);});
  };
  useEffect(() => {
    let live=true;
    const controller = new AbortController();
    sessionCheckRef.current = controller;
    api<{patient:Patient|null}>('/auth/me', {signal:controller.signal}, 8_000).then(async data=>{
      if (live && !controller.signal.aborted && data.patient) await acceptPatient(data.patient);
    }).catch(error=>{
      if(live && !controller.signal.aborted)setPersistenceError(error.message);
    }).finally(()=>{if(live)setRestoringSession(false);});
    return ()=>{live=false;controller.abort();};
  },[]);
  useEffect(() => {
    setTasks(snapshot.events.filter(e=>e.scheduled_date===calendarDate && ['pending','completed'].includes(e.status)).map(e=>({id:e.id,text:`${e.scheduled_time?.slice(0,5) || 'Без времени'} · ${e.title}`,completed:e.status==='completed'})));
  },[snapshot,calendarDate]);
  const [todayDate, setTodayDate] = useState(() => patientToday(Intl.DateTimeFormat().resolvedOptions().timeZone));
  useEffect(() => {
    const refresh = () => setTodayDate(patientToday(patient?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone));
    refresh();
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener('focus', refresh);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [patient?.timezone]);
  const todayTasks = snapshot.events.filter(e => e.scheduled_date === todayDate && ['pending', 'completed'].includes(e.status)).map(e => ({ id: e.id, text: `${e.scheduled_time?.slice(0, 5) || 'Без времени'} · ${e.title}`, completed: e.status === 'completed' }));
  const handleLogout = async () => {
    try {
      if (draftId && !await cancelDraft()) return;
      await api('/auth/logout',{method:'POST'});
      clearPatientState();setPersistenceError('');
    } catch(error) {setPersistenceError((error as Error).message);}
  };
  const handlePersistPlan = async () => {
    if (!planPreview || isGeneratingSchedule) return;
    const savingPatient=patientRef.current;
    setIsGeneratingSchedule(true);setPersistenceError('');
    try {
      const value=await api<PlanSnapshot>('/plans/confirm',{method:'POST',body:JSON.stringify({draftId:planPreview.draftId,version:planPreview.version,decisions:conflictDecisions})});
      if (patientRef.current!==savingPatient) return;
      applySnapshot(value);setPlanPreview(null);setPendingStatementText(null);setPendingStatementMessageId(null);setDraftId(null);
      setMessages(prev=>[...prev,{id:`saved-${Date.now()}`,sender:'assistant',text:'План сохранён. Задачи и отметки выполнения доступны после перезагрузки.'}]);
    } catch(error) {setPersistenceError((error as Error).message);} finally {setIsGeneratingSchedule(false);}
  };
  const cancelDraft = async () => {
    if (draftId) {
      try {await api(`/drafts/${draftId}`,{method:'DELETE'});} catch(error){setPersistenceError((error as Error).message);return false;}
    }
    setDraftId(null);setPlanPreview(null);setPendingStatementText(null);setPendingStatementMessageId(null);setAttachedFileName(null);
    setMessages(prev=>prev.filter(message=>message.id!==pendingStatementMessageId));
    return true;
  };

  // Keep chat mode stable while the input changes; only empty/non-empty boundaries matter.
  const isChatMode =
    hasInput ||
    messages.length > 1 ||
    isSendingMessage ||
    isUploadingStatement ||
    isGeneratingSchedule;

  useEffect(() => {
    if (isChatMode) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length, isChatMode]);

  const handleSendMessage = async (trimmed: string) => {
    if (
      !trimmed ||
      isSendingMessage ||
      isUploadingStatement ||
      isGeneratingSchedule ||
      pendingStatementText
    ) {
      return;
    }

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      sender: 'user',
      text: trimmed,
    };

    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setIsSendingMessage(true);
    const chatPatient=patientRef.current;
    const controller = new AbortController();
    chatRequestRef.current = controller;

    try {
      const data = await api<{reply?:string}>('/chat', {
        signal: controller.signal,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: nextMessages.map((message) => ({
            role: message.sender,
            content: message.text,
          })),
        }),
      }, 90_000);
      if (!data.reply) {
        throw new Error('Сервер вернул пустой ответ.');
      }
      if (controller.signal.aborted || patientRef.current!==chatPatient) return;
      const reply = data.reply;
      setMessages((prev) => [
        ...prev,
        { id: `assistant-${Date.now()}`, sender: 'assistant', text: reply },
      ]);
    } catch (error) {
      const errorMessage =
        error instanceof TypeError
          ? 'Сервер приложения недоступен. Запустите его командой npm run dev:backend и повторите попытку.'
          : error instanceof Error
            ? error.message
            : 'Ошибка соединения с сервером.';
      if (controller.signal.aborted || patientRef.current!==chatPatient) return;
      setMessages((prev) => [
        ...prev,
        {
          id: `assistant-${Date.now()}`,
          sender: 'assistant',
          text: `Не удалось получить ответ: ${errorMessage}`,
        },
      ]);
    } finally {
      if (chatRequestRef.current === controller) {chatRequestRef.current=null;setIsSendingMessage(false);}
    }
  };

  const handleResetToStart = () => {
    chatRequestRef.current?.abort();chatRequestRef.current=null;setIsSendingMessage(false);
    if (draftId) void cancelDraft();
    setCurrentScreen('main');
    setHasInput(false);
    setInputResetKey((key) => key + 1);
    setMessages([
      {
        id: 'welcome',
        sender: 'assistant',
        text: 'Привет, чем я могу помочь с восстановлением?',
      },
    ]);
    setRecommendationsText('');
    setPendingStatementText(null);
    setPendingStatementMessageId(null);
    setIsOperationMenuOpen(false);
  };

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();if(authBusy)return;setAuthBusy(true);setPersistenceError('');
    try {
      const contact=authEmail.trim();
      const body=authMode==='register' ? {username:authName,email:contact.includes('@') ? contact:undefined,phone:contact.includes('@') ? undefined:contact,password:authPassword,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone} : {contact,password:authPassword};
      const data=await api<{patient:Patient}>(`/auth/${authMode}`,{method:'POST',body:JSON.stringify(body)});
      sessionCheckRef.current?.abort();setRestoringSession(false);
      handleResetToStart();
      await acceptPatient(data.patient);setIsAuthModalOpen(false);setAuthEmail('');setAuthPassword('');setAuthName('');
    } catch(error) {setPersistenceError((error as Error).message);} finally {setAuthBusy(false);}
  };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          setAvatarUrl(reader.result);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleTasksMouseEnter = () => {
    if (tasksTimeoutRef.current) {
      window.clearTimeout(tasksTimeoutRef.current);
      tasksTimeoutRef.current = null;
    }
    setIsTasksOpen(true);
  };

  const handleTasksMouseLeave = () => {
    tasksTimeoutRef.current = window.setTimeout(() => {
      setIsTasksOpen(false);
    }, 180);
  };

  const toggleTask = async (id:string, completed?:boolean) => {
    if (savingEvents.includes(id)) return;
    const event=snapshot.events.find(e=>e.id===id);if(!event || !['pending','completed'].includes(event.status))return;
    setSavingEvents(prev=>[...prev,id]);setPersistenceError('');
    try {
      const data=await api<{event:PlanSnapshot['events'][number]}>(`/events/${id}`,{method:'PATCH',body:JSON.stringify({completed:completed ?? event.status!=='completed'})});
      setSnapshot(prev=>({...prev,events:prev.events.map(e=>e.id===id ? {...e,...data.event}:e)}));
    } catch(error) {setPersistenceError((error as Error).message);} finally {setSavingEvents(prev=>prev.filter(value=>value!==id));}
  };
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || isUploadingStatement || isGeneratingSchedule) return;
    if (!isAuthorized) {setIsAuthModalOpen(true);return;}
    if (draftId && !await cancelDraft()) return;
    const uploadingPatient=patientRef.current;

    setAttachedFileName(file.name);
    setIsUploadingStatement(true);

    try {
      const extension = file.name.split('.').pop()?.toLowerCase() || '';
      const ocrResponse = await fetch(
        `/api/ocr?extension=${encodeURIComponent(extension)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: file,
          signal: AbortSignal.timeout(180_000),
        }
      );
      const responseBody = await ocrResponse.text();
      if (!responseBody.trim()) {
        throw new Error(
          ocrResponse.ok
            ? 'Сервис распознавания вернул пустой ответ.'
            : `Сервис распознавания недоступен (HTTP ${ocrResponse.status}). Запустите backend командой npm run dev:backend.`
        );
      }

      let ocrData: { text?: string; error?: string; draftId?:string; existing?:boolean } & Partial<PlanSnapshot>;
      try {
        const parsedData: unknown = JSON.parse(responseBody);
        if (!parsedData || typeof parsedData !== 'object' || Array.isArray(parsedData)) {
          throw new Error('Сервис распознавания вернул некорректный ответ.');
        }
        const responseData = parsedData as Record<string, unknown>;
        if (
          (responseData.text !== undefined && typeof responseData.text !== 'string') ||
          (responseData.error !== undefined && typeof responseData.error !== 'string')
        ) {
          throw new Error('Сервис распознавания вернул некорректный ответ.');
        }
        ocrData = {
          ...responseData as Partial<PlanSnapshot>,
          draftId:typeof responseData.draftId==='string' ? responseData.draftId:undefined,
          existing:responseData.existing===true,
          text: typeof responseData.text === 'string' ? responseData.text : undefined,
          error: typeof responseData.error === 'string' ? responseData.error : undefined,
        };
      } catch (error) {
        if (error instanceof SyntaxError) {
          throw new Error(
            `Сервис распознавания вернул некорректный ответ (HTTP ${ocrResponse.status}).`
          );
        }
        throw error;
      }
      if (ocrResponse.status===401) window.dispatchEvent(new Event('recovery-session-expired'));
      if (!ocrResponse.ok) {
        throw new Error(ocrData.error || 'Не удалось распознать выписку.');
      }
      if (patientRef.current!==uploadingPatient) return;
      if (ocrData.existing && Array.isArray(ocrData.events) && Array.isArray(ocrData.prescriptions)) {
        applySnapshot(ocrData as PlanSnapshot);
        setMessages(prev=>[...prev,{id:`existing-${Date.now()}`,sender:'assistant',text:'Этот документ уже сохранён. Загружен существующий план с отметками выполнения.'}]);return;
      }
      setDraftId(ocrData.draftId || null);
      if (!ocrData.text?.trim()) {
        throw new Error('В выписке не найден текст.');
      }

      const extractedText = ocrData.text.trim();
      const messageId = `statement-${Date.now()}`;
      setPendingStatementText(extractedText);
      setPendingStatementMessageId(messageId);
      setMessages((prev) => [
        ...prev,
        {
          id: messageId,
          documentReview: true,
          sender: 'assistant',
          text: `Вот распознанный текст выписки. Проверьте его и подтвердите перед использованием:\n\n${extractedText}`,
        },
      ]);
    } catch (error) {
      setAttachedFileName(null);
      const errorMessage =
        error instanceof TypeError
          ? 'Сервер приложения недоступен. Запустите его командой npm run dev:backend и повторите попытку.'
          : error instanceof Error
            ? error.message
            : 'Не удалось распознать выписку.';
      setMessages((prev) => [
        ...prev,
        {
          id: `statement-error-${Date.now()}`,
          sender: 'assistant',
          text: `Не удалось обработать выписку: ${errorMessage}`,
        },
      ]);
    } finally {
      setIsUploadingStatement(false);
    }
  };

  const handleConfirmStatement = async () => {
    if (!pendingStatementText || !draftId || isGeneratingSchedule) return;
    if (!startDate) {setPersistenceError('Подтвердите дату начала курса.');return;}
    setIsGeneratingSchedule(true);setPersistenceError('');
    try {
      const generationPatient=patientRef.current;
      const data=await api<PlanPreview>('/generate-schedule',{method:'POST',body:JSON.stringify({draftId,confirmedText:pendingStatementText,startDate})}, 180_000);
      if (patientRef.current!==generationPatient) return;
      setPlanPreview(data);setConflictDecisions({});
    } catch(error) {setPersistenceError((error as Error).message);} finally {setIsGeneratingSchedule(false);}
  };
  const markAllTasksCompleted = async () => {
    for (const task of todayTasks.filter(t=>!t.completed)) await toggleTask(task.id,true);
  };

  const openSettingsModal = () => {
    setSettingsNameInput(userName);
    setSettingsEmailInput(patient?.email || '');
    setSettingsPhoneInput(patient?.phone || '');
    setActiveAccountModal('settings');
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (settingsSaving) return;
    setSettingsSaving(true);setPersistenceError('');
    try {
      const data=await api<{patient:Patient}>('/patient',{method:'PATCH',body:JSON.stringify({username:settingsNameInput,email:settingsEmailInput,phone:settingsPhoneInput})});
      setPatient(data.patient);setUserName(data.patient.username);setActiveAccountModal(null);
    } catch(error) {setPersistenceError((error as Error).message);} finally {setSettingsSaving(false);}
  };
  const statusNotice = (persistenceError || restoringSession) && (
    <div className="fixed top-2 left-1/2 -translate-x-1/2 z-[70] max-w-[90vw] pointer-events-none">
      <div role="status" className="rounded-[18px] border border-[#EBEBEB] bg-white px-4 py-2 text-[13px] text-[#1A2E2B] shadow-sm flex items-center gap-3">
        <span>{persistenceError || 'Проверяю сессию…'}</span>
        {persistenceError && <button type="button" aria-label="Закрыть уведомление" className="pointer-events-auto cursor-pointer px-1" onClick={()=>setPersistenceError('')}>×</button>}
      </div>
    </div>
  );

  if (currentScreen === 'account') {
    const month = new Date(`${calendarMonth || calendarDate.slice(0, 7)}-01T12:00:00`);
    const monthLabel = month.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
    const firstWeekday = (month.getDay() + 6) % 7;
    const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const shiftMonth = (offset: number) => {
      const next = new Date(month.getFullYear(), month.getMonth() + offset, 1);
      setCalendarMonth(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`);
    };
    return (
      <div className={`account-page ${activeAccountModal ? 'account-page-detail' : ''}`}>
        {statusNotice}
        <input ref={avatarInputRef} type="file" accept="image/*" onChange={handleAvatarChange} className="hidden" aria-label="Загрузить фото профиля" />
        <main className="account-card">
          <header className="account-detail-header">
            <button type="button" className="account-back" onClick={() => activeAccountModal ? setActiveAccountModal(null) : setCurrentScreen('main')}>
              <ArrowLeftCircleOutlineIcon /><span>{activeAccountModal ? 'К профилю' : 'Назад'}</span>
            </button>
            <h1>{activeAccountModal === 'settings' ? 'Настройки профиля' : activeAccountModal === 'plan' ? 'План реабилитации' : 'Профиль'}</h1>
          </header>
          <div className="account-content" key={activeAccountModal || 'profile'}>
          {activeAccountModal ? (
            <>
              {activeAccountModal === 'settings' ? (
                <form onSubmit={handleSaveSettings} className="account-settings-form">
                  <div className="account-photo-row">
                    <img className="account-settings-avatar" src={avatarUrl} alt="Фото профиля" />
                    <div className="account-photo-actions">
                      <button type="button" className="account-upload" onClick={() => avatarInputRef.current?.click()}>Загрузить новое фото</button>
                      {avatarUrl !== DEFAULT_AVATAR_URL && <button type="button" className="account-reset-photo" onClick={() => setAvatarUrl(DEFAULT_AVATAR_URL)}>Вернуть стандартный аватар</button>}
                    </div>
                  </div>
                  <label className="account-field">Имя пользователя
                    <input type="text" value={settingsNameInput} onChange={e => setSettingsNameInput(e.target.value)} required maxLength={100} autoComplete="name" />
                  </label>
                  <label className="account-field">Email
                    <input type="email" value={settingsEmailInput} onChange={e => setSettingsEmailInput(e.target.value)} autoComplete="email" />
                  </label>
                  <label className="account-field">Телефон
                    <input type="tel" value={settingsPhoneInput} onChange={e => setSettingsPhoneInput(e.target.value)} autoComplete="tel" />
                  </label>
                  <button type="submit" className="account-save" disabled={settingsSaving}>{settingsSaving ? 'Сохраняю…' : 'Сохранить изменения'}</button>
                </form>
              ) : (
                <section className="account-plan" aria-label="Календарь реабилитации">
                  <p className="account-plan-status">{snapshot.plan ? (selectedOperation || 'Подтверждённый план реабилитации') : 'План пока не сохранён. Загрузите документ и подтвердите назначения.'}</p>
                  <div className="account-calendar-nav">
                    <button type="button" aria-label="Предыдущий месяц" onClick={() => shiftMonth(-1)}><span aria-hidden="true">‹</span></button>
                    <h2 aria-live="polite">{monthLabel}</h2>
                    <button type="button" aria-label="Следующий месяц" onClick={() => shiftMonth(1)}><span aria-hidden="true">›</span></button>
                  </div>
                  <div className="account-calendar">
                    {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(day => <span key={day} className="account-weekday">{day}</span>)}
                    {Array.from({ length: firstWeekday }, (_, i) => <span key={`empty-${i}`} />)}
                    {Array.from({ length: daysInMonth }, (_, i) => {
                      const day = i + 1;
                      const date = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                      const hasEvents = snapshot.events.some(event => event.scheduled_date === date && ['pending', 'completed'].includes(event.status));
                      return <button type="button" key={date} className={`account-day ${calendarDate === date ? 'is-selected' : ''}`} aria-label={date} aria-pressed={calendarDate === date} onClick={() => setCalendarDate(date)}>{day}{hasEvents && <span className="account-event-dot" />}</button>;
                    })}
                  </div>
                  <div className="account-day-tasks" aria-live="polite">
                    <h3>Задачи на {calendarDate}</h3>
                    {tasks.length ? <ul>{tasks.map(task => <li key={task.id}>
                      <button type="button" className={`account-task ${task.completed ? 'is-completed' : ''}`} onClick={() => void toggleTask(task.id)} disabled={savingEvents.includes(task.id)} aria-pressed={task.completed} title={snapshot.events.find(event => event.id === task.id)?.description}>
                        <span className="account-task-check" aria-hidden="true">{task.completed ? '✓' : ''}</span><span>{task.text}</span>
                      </button>
                    </li>)}</ul> : <p>На эту дату задач нет.</p>}
                  </div>
                </section>
              )}
            </>
          ) : (
            <div className="account-profile-inner">
              <div className="account-cover" aria-hidden="true"><img src={TRAIL_RUNNER_BG_URL} alt="" /></div>
              <button type="button" className="account-settings-button" onClick={openSettingsModal} aria-label="Настройки профиля">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="m9.5 3 .5-2h4l.5 2 2 .9 1.8-1 2.8 2.8-1 1.8.9 2 2 .5v4l-2 .5-.9 2 1 1.8-2.8 2.8-1.8-1-2 .9-.5 2h-4l-.5-2-2-.9-1.8 1-2.8-2.8 1-1.8-.9-2-2-.5v-4l2-.5.9-2-1-1.8 2.8-2.8 1.8 1z" />
                </svg>
              </button>
              <div className="account-identity">
                <button type="button" className="account-avatar" onClick={() => avatarInputRef.current?.click()} aria-label="Изменить фото профиля"><img src={avatarUrl} alt="Фото профиля" /></button>
                <h1>{userName}</h1>
                {selectedOperation && <p>{selectedOperation}</p>}
              </div>
              <div className="account-profile-actions">
                <button type="button" className="account-plan-button" onClick={() => {setCalendarMonth(calendarDate.slice(0, 7));setActiveAccountModal('plan');}}><StethoscopeOutlineIcon /><span>План реабилитации</span></button>
                <button type="button" className="account-logout" onClick={() => void handleLogout()}>Выйти из аккаунта</button>
              </div>
            </div>
          )}
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="h-screen w-full bg-[#FAFAFA] text-[#1A2E2B] flex flex-col relative overflow-hidden">
      {statusNotice}
      {isOperationMenuOpen && <ConditionSelector onClose={() => setIsOperationMenuOpen(false)} onSelect={text => { setIsOperationMenuOpen(false); setInputDraft({ text }); }} />}
      {/* Hidden file input for "Прикрепите выписку" */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff,.bmp"
        onChange={handleFileChange}
        disabled={isUploadingStatement}
        className="hidden"
      />

      {/* BLUR OVERLAY WHEN TASKS POPOVER IS OPEN (z-30 sits above <main z-10> and blurs everything) */}
      <AnimatePresence>
        {isTasksOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setIsTasksOpen(false)}
            className="fixed inset-0 bg-[#FAFAFA]/45 backdrop-blur-md z-30"
          />
        )}
      </AnimatePresence>

      {/* AUTHORIZATION MODAL WITH BLURRED BACKDROP */}
      <AnimatePresence>
        {isAuthModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setIsAuthModalOpen(false)}
            className="fixed inset-0 bg-[#1A2E2B]/10 backdrop-blur-md z-50 flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 10 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-[380px] rounded-[36px] bg-gradient-to-br from-[#95B8B8] via-[#A8C7C7] to-[#BDD8D8] p-[2px] shadow-[0_24px_64px_rgba(26,46,43,0.16)]"
            >
              {/* Top Accent Bar matching the green-teal popup design code */}
              <div className="px-6 pt-5 pb-4 flex items-center justify-between">
                <div>
                  <div className="text-[16px] font-semibold text-[#1A2E2B] leading-tight">
                    GIGA-восстановление
                  </div>
                  <div className="text-[13px] font-normal text-[#1A2E2B]/70 leading-tight mt-0.5">
                    Личный кабинет пациента
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsAuthModalOpen(false)}
                  className="px-3.5 py-1.5 rounded-full bg-white/35 hover:bg-white/55 text-[#1A2E2B] text-[13px] font-medium transition-colors cursor-pointer"
                >
                  Закрыть
                </button>
              </div>

              {/* Inner Card */}
              <div className="bg-[#FAFAFA] rounded-[34px] px-6 pt-6 pb-6">
                {/* Mode switcher */}
                <div className="flex items-center justify-between mb-5">
                  <h3 className="text-[22px] font-bold text-[#1A2E2B] tracking-tight">
                    {authMode === 'login' ? 'Авторизация' : 'Регистрация'}
                  </h3>
                  <div className="flex items-center gap-1 bg-[#EFEFEF] p-1 rounded-full">
                    <button
                      type="button"
                      onClick={() => setAuthMode('login')}
                      className={`px-3 py-1 rounded-full text-[12.5px] font-medium transition-all cursor-pointer ${
                        authMode === 'login'
                          ? 'bg-white text-[#1A2E2B] shadow-xs'
                          : 'text-[#6E7A78] hover:text-[#1A2E2B]'
                      }`}
                    >
                      Вход
                    </button>
                    <button
                      type="button"
                      onClick={() => setAuthMode('register')}
                      className={`px-3 py-1 rounded-full text-[12.5px] font-medium transition-all cursor-pointer ${
                        authMode === 'register'
                          ? 'bg-white text-[#1A2E2B] shadow-xs'
                          : 'text-[#6E7A78] hover:text-[#1A2E2B]'
                      }`}
                    >
                      Новый
                    </button>
                  </div>
                </div>

                <form onSubmit={handleAuthSubmit} className="space-y-3">
                  {authMode === 'register' && (
                    <div>
                      <input
                        type="text"
                        value={authName}
                        onChange={(e) => setAuthName(e.target.value)}
                        placeholder="Ваше имя (для профиля)"
                        autoFocus
                        className="w-full h-[52px] bg-white border border-[#EBEBEB] focus:border-[#A8C7C7] rounded-[18px] px-4 text-[14.5px] text-[#1A2E2B] placeholder:text-[#B0B7B5] focus:outline-none transition-colors"
                      />
                    </div>
                  )}

                  <div>
                    <input
                      type="text"
                      value={authEmail}
                      onChange={(e) => setAuthEmail(e.target.value)}
                      placeholder="Телефон или эл. почта"
                      autoFocus={authMode === 'login'}
                      className="w-full h-[52px] bg-white border border-[#EBEBEB] focus:border-[#A8C7C7] rounded-[18px] px-4 text-[14.5px] text-[#1A2E2B] placeholder:text-[#B0B7B5] focus:outline-none transition-colors"
                    />
                  </div>

                  <div>
                    <input
                      type="password"
                      value={authPassword}
                      onChange={(e) => setAuthPassword(e.target.value)}
                      placeholder="Пароль"
                      className="w-full h-[52px] bg-white border border-[#EBEBEB] focus:border-[#A8C7C7] rounded-[18px] px-4 text-[14.5px] text-[#1A2E2B] placeholder:text-[#B0B7B5] focus:outline-none transition-colors"
                    />
                  </div>

                  <div className="pt-2">
                    <button
                      type="submit"
                      disabled={authBusy}
                      className="w-full h-[54px] rounded-[18px] bg-[#A8C7C7] hover:bg-[#97B8B8] active:scale-[0.99] text-[#1A2E2B] font-semibold text-[15px] flex items-center justify-center gap-2 transition-all shadow-[0_6px_20px_rgba(168,199,199,0.35)] cursor-pointer"
                    >
                      <span>
                        {authBusy ? 'Подождите…' : authMode === 'login' ? 'Войти в аккаунт' : 'Создать аккаунт'}
                      </span>
                    </button>
                  </div>
                </form>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* TOP HEADER (Static, never scrolls) */}
      <header className="shrink-0 w-full px-4 sm:px-10 md:px-14 pt-8 pb-4 grid grid-cols-[1fr_auto_1fr] items-center relative z-40">
        {/* Left Zone:
            - Shown ONLY when authorized: "Задачи" (hover opens green accent popover + blurs background)
            - Empty when not authorized
        */}
        <div className="flex items-center justify-start relative">
          {isAuthorized && (
            <div
              className="relative inline-block"
              onMouseEnter={handleTasksMouseEnter}
              onMouseLeave={handleTasksMouseLeave}
            >
              <button
                type="button"
                onClick={() => setIsTasksOpen((prev) => !prev)}
                className="inline-flex items-center gap-2 text-[15px] font-medium text-[#1A2E2B] hover:opacity-75 transition-opacity cursor-pointer py-1"
              >
                <CheckCircleOutlineIcon className="w-[18px] h-[18px]" />
                <span>Задачи</span>
              </button>

              {/* HOVER POPOVER: Styled with the green accent color (#A8C7C7) and blurred background */}
              <AnimatePresence>
                {isTasksOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: 6, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 6, scale: 0.98 }}
                    transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                    className="absolute left-0 top-full pt-3 z-50"
                  >
                    <div className="w-[348px] max-w-[calc(100vw-32px)] rounded-[36px] bg-gradient-to-br from-[#94B8B8] via-[#A8C7C7] to-[#C2DCDC] p-[2px] shadow-[0_24px_60px_rgba(26,46,43,0.14)] select-none">
                      {/* Green Accent Header (matching the send button color #A8C7C7) */}
                      <div className="px-6 pt-5 pb-4 flex items-start justify-between">
                        <div>
                          <div className="text-[16px] font-medium text-[#1A2E2B] leading-tight">
                            Напоминания
                          </div>
                          <div className="text-[14px] font-normal text-[#1A2E2B]/70 leading-tight tabular-nums mt-1">
                            <time dateTime={todayDate}>{new Date(`${todayDate}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}</time>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={markAllTasksCompleted}
                          className="px-3.5 py-1.5 rounded-full bg-white/35 hover:bg-white/55 active:scale-95 text-[#1A2E2B] text-[13px] font-medium transition-all cursor-pointer whitespace-nowrap"
                        >
                          Отметить всё
                        </button>
                      </div>

                      {/* Inner Clean Card */}
                      <div className="bg-[#FAFAFA] rounded-[34px] px-6 pt-6 pb-6 relative min-h-[270px] flex flex-col justify-between">
                        <div>
                          <h3 className="text-[23px] font-bold text-[#1A2E2B] tracking-tight mb-5">
                            Задачи на сегодня
                          </h3>

                          <ul className="space-y-3.5 max-h-[min(320px,45dvh)] overflow-y-auto overflow-x-hidden">
                            {todayTasks.map((task) => (
                              <li key={task.id}>
                                <button
                                  type="button"
                                  onClick={() => void toggleTask(task.id)}
                                  disabled={savingEvents.includes(task.id)}
                                  aria-pressed={task.completed}
                                  title={savingEvents.includes(task.id) ? 'Сохраняю отметку…' : task.completed ? 'Снять отметку выполнения' : 'Отметить выполненной'}
                                  className="flex items-center gap-3 text-left w-full group cursor-pointer"
                                >
                                  {task.completed ? (
                                    <span className="w-[21px] h-[21px] rounded-full bg-[#1A2E2B] text-white flex items-center justify-center shrink-0 transition-transform group-hover:scale-105">
                                      <svg
                                        viewBox="0 0 16 16"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2.2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        className="w-3 h-3"
                                      >
                                        <path d="M3.8 8.3L6.6 11L12.2 5" />
                                      </svg>
                                    </span>
                                  ) : (
                                    <span className="w-[21px] h-[21px] rounded-full border-[1.6px] border-[#9BA6A4] shrink-0 transition-colors group-hover:border-[#1A2E2B]" />
                                  )}
                                  <span
                                    className={`text-[15px] leading-snug transition-colors ${
                                      task.completed
                                        ? 'text-[#1A2E2B] font-normal'
                                        : 'text-[#879290] font-normal'
                                    }`}
                                  >
                                    {task.text}
                                  </span>
                                </button>
                              </li>
                            ))}
                          </ul>

                          {!todayTasks.length && <p className="text-[15px] text-[#879290]">На сегодня задач нет.</p>}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>

        {/* Center Zone: Brand "GIGA-восстановление" (blurs when Tasks popover is open) */}
        <div
          className={`flex items-center justify-center transition-all duration-200 ${
            isTasksOpen ? 'blur-[6px] opacity-60 pointer-events-none' : ''
          }`}
        >
          <button
            type="button"
            onClick={handleResetToStart}
            className="text-[14px] sm:text-[18px] font-semibold tracking-tight text-[#1A2E2B] hover:opacity-80 transition-opacity cursor-pointer"
          >
            GIGA-восстановление
          </button>
        </div>

        {/* Right Zone:
            - When authorized: "Аккаунт" + icon
            - When NOT authorized and in chat mode: "Авторизация" + icon
        */}
        <div
          className={`flex items-center justify-end transition-all duration-200 ${
            isTasksOpen ? 'blur-[6px] opacity-60 pointer-events-none' : ''
          }`}
        >
          {isAuthorized ? (
            <button
              type="button"
              onClick={() => setCurrentScreen('account')}
              className="inline-flex items-center gap-2 text-[15px] font-medium text-[#1A2E2B] hover:opacity-75 transition-opacity cursor-pointer"
            >
              <span>Аккаунт</span>
              <UserCircleOutlineIcon className="w-[18px] h-[18px]" />
            </button>
          ) : isChatMode ? (
            <button
              type="button"
              onClick={() => setIsAuthModalOpen(true)}
              className="inline-flex items-center gap-2 text-[15px] font-medium text-[#1A2E2B] hover:opacity-75 transition-opacity cursor-pointer"
            >
              <span>Авторизация</span>
              <UserCircleOutlineIcon className="w-[18px] h-[18px]" />
            </button>
          ) : null}
        </div>
      </header>

      {/* MAIN VIEWPORT:
          - z-10 stacking context so the z-30 Tasks blur overlay blurs 100% of <main> (heading, buttons, chat, and input bar).
          - Inside <main>, the operation dropdown uses z-30 while input form uses z-20 so the dropdown always sits above the input bar.
      */}
      <main
        className={`flex-1 min-h-0 w-full relative z-10 flex flex-col items-center px-4 transition-all duration-200 ${
          isChatMode ? 'justify-end pb-10' : 'justify-center -mt-10'
        } ${isTasksOpen ? 'blur-[6px] pointer-events-none select-none' : ''}`}
      >
        {!isChatMode ? (
          /* START VIEW HERO + 2 BUTTONS (z-30 so the operation dropdown always overlays the input bar below) */
          <div className="w-full max-w-[584px] flex flex-col items-center relative z-30">
            <motion.h2
              layoutId="welcome-greeting"
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className="text-[36px] sm:text-[42px] font-bold text-[#1D2D2A] text-center leading-[1.16] tracking-[-0.02em] mb-10 select-none"
            >
              Привет, чем я могу помочь
              <br />с восстановлением?
            </motion.h2>

            {/* Two Action Buttons Row */}
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18 }}
              className="w-full grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3.5 relative z-30"
            >
              {/* Left Button: "Авторизуйтесь" (opens Auth Modal) OR "Прикрепите выписку" (when authorized) */}
              {!isAuthorized ? (
                <button
                  type="button"
                  onClick={() => setIsAuthModalOpen(true)}
                  className="h-[58px] bg-white border border-[#EBEBEB] hover:border-[#DCDCDC] rounded-[18px] px-3.5 flex items-center gap-3 text-left transition-all shadow-[0_2px_10px_rgba(0,0,0,0.015)] hover:shadow-[0_4px_14px_rgba(0,0,0,0.04)] cursor-pointer"
                >
                  <span className="w-9 h-9 rounded-[11px] bg-[#F2F4F3] flex items-center justify-center text-[#1A2E2B] shrink-0">
                    <UserCircleOutlineIcon className="w-[18px] h-[18px]" />
                  </span>
                  <span className="text-[14.5px] font-medium text-[#1A2E2B] truncate">
                    Авторизуйтесь
                  </span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="h-[58px] bg-white border border-[#EBEBEB] hover:border-[#DCDCDC] rounded-[18px] px-3.5 flex items-center gap-3 text-left transition-all shadow-[0_2px_10px_rgba(0,0,0,0.015)] hover:shadow-[0_4px_14px_rgba(0,0,0,0.04)] cursor-pointer"
                >
                  <span className="w-9 h-9 rounded-[11px] bg-[#F2F4F3] flex items-center justify-center text-[#1A2E2B] shrink-0">
                    <DischargeDocOutlineIcon className="w-[18px] h-[18px]" />
                  </span>
                  <span className="text-[14.5px] font-medium text-[#1A2E2B] truncate">
                    {attachedFileName ? attachedFileName : 'Прикрепите выписку'}
                  </span>
                </button>
              )}

              {/* Right Button: "Выберите операцию" with right chevron indicator */}
              <div className="relative z-40">
                <button
                  type="button"
                  onClick={() => setIsOperationMenuOpen(true)}
                  aria-haspopup="dialog"
                  aria-expanded={isOperationMenuOpen}
                  className="w-full h-[58px] bg-white border border-[#EBEBEB] hover:border-[#DCDCDC] rounded-[18px] px-3.5 flex items-center justify-between gap-2 text-left transition-all shadow-[0_2px_10px_rgba(0,0,0,0.015)] hover:shadow-[0_4px_14px_rgba(0,0,0,0.04)] cursor-pointer"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-9 h-9 rounded-[11px] bg-[#F2F4F3] flex items-center justify-center text-[#1A2E2B] shrink-0">
                      <StethoscopeOutlineIcon className="w-[18px] h-[18px]" />
                    </span>
                    <span className="text-[14.5px] font-medium text-[#1A2E2B] truncate">
                      Выберите операцию
                    </span>
                  </div>
                  <svg
                    viewBox="0 0 20 20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={`w-4 h-4 text-[#7D8986] shrink-0 mr-1 transition-transform duration-200 ${
                      isOperationMenuOpen ? 'rotate-180' : ''
                    }`}
                  >
                    <path d="M5.5 7.5L10 12L14.5 7.5" />
                  </svg>
                </button>

              </div>
            </motion.div>
          </div>
        ) : (
          /* SCROLLABLE CHAT AREA:
             Spans full height of <main> (inset-0) with bottom padding (pb-36) so messages scroll underneath the static input bar.
          */
          <div className="absolute inset-0 overflow-y-auto chat-scroll px-4 z-10">
            <div className="w-full max-w-[584px] mx-auto pt-20 pb-36 flex flex-col space-y-8">
              {messages.map((msg, index) => {
                if (msg.sender === 'assistant') {
                  return (
                    <div key={msg.id} className="flex justify-start">
                      <motion.div
                        layoutId={index === 0 ? 'welcome-greeting' : undefined}
                        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                        className="bg-white border border-[#EBEBEB] shadow-[0_4px_20px_rgba(0,0,0,0.035)] rounded-[18px] px-5 py-4 text-[15px] font-normal text-[#1A2E2B] max-w-[85%] whitespace-pre-wrap break-words"
                      >
                        {msg.documentReview ? 'Проверьте распознанный текст выписки в поле ниже и подтвердите его перед использованием.' : msg.text}
                        {msg.id === pendingStatementMessageId && pendingStatementText && (
                          <div className="flex flex-col gap-2 mt-4">
                            <textarea aria-label="Подтверждённые рекомендации" value={pendingStatementText} onChange={e=>{setPendingStatementText(e.target.value);setPlanPreview(null);}} disabled={isGeneratingSchedule} className="w-full min-h-[120px] rounded-xl border border-[#EBEBEB] p-3 text-[13px]" />
                            <label className="text-[13px]">Дата начала курса <input type="date" value={startDate} onChange={e=>{setStartDate(e.target.value);setPlanPreview(null);}} disabled={!!snapshot.plan?.recovery_start_date || isGeneratingSchedule} className="rounded-xl border border-[#EBEBEB] p-2" /></label>
                            {planPreview && <div className="max-h-[280px] overflow-auto text-[13px] space-y-3">
                              {planPreview.changes.map(change=><div key={change.key} className="border border-[#EBEBEB] rounded-xl p-3">
                                <strong>{change.title}</strong><p>{change.instruction}</p>
                                <p>{change.events.length} событий · {change.events[0]?.date} — {change.events.at(-1)?.date}</p>
                                <details><summary>Все даты и время</summary>{change.events.map((event,index)=><p key={index}>{event.date} · {event.time || 'Без времени'} · {event.description}</p>)}</details>
                                {!!change.conflicts.length && <><p>Возможное изменение назначения:</p>{change.conflicts.map(conflict=><p key={conflict.id}>{conflict.title}: {conflict.instruction} ({conflict.startsOn} — {conflict.endsOn})</p>)}
                                  <select aria-label={`Решение: ${change.title}`} value={conflictDecisions[change.key] || ''} onChange={e=>setConflictDecisions(prev=>({...prev,[change.key]:e.target.value}))} className="w-full rounded-xl border border-[#EBEBEB] p-2">
                                    <option value="">Выберите решение</option><option value="keep">Оставить прежнее назначение</option><option value="separate">Подтвердить как отдельный курс</option><option value="replace" disabled={change.conflicts.some(c=>c.id.startsWith('incoming:'))}>Заменить невыполненные задачи; сохранить выполненные</option>
                                  </select></>}
                              </div>)}
                              <button type="button" onClick={()=>void handlePersistPlan()} disabled={isGeneratingSchedule || planPreview.changes.some(c=>c.conflicts.length && !conflictDecisions[c.key])} className="px-4 py-2 rounded-full bg-[#A8C7C7] disabled:opacity-50 font-semibold">Подтвердить и сохранить план</button>
                            </div>}

                            <button
                              type="button"
                              onClick={() => void handleConfirmStatement()}
                              disabled={isGeneratingSchedule}
                              className="px-4 py-2 rounded-full bg-[#A8C7C7] hover:bg-[#97B8B8] disabled:opacity-50 text-[#1A2E2B] text-[13px] font-semibold transition-colors cursor-pointer"
                            >
                              Подтвердить текст
                            </button>
                            <button
                              type="button"
                              onClick={() => void cancelDraft().then(cancelled=>{if(cancelled)fileInputRef.current?.click();})}
                              disabled={isGeneratingSchedule}
                              className="px-4 py-2 rounded-full bg-[#F2F4F3] hover:bg-[#E8ECEB] text-[#1A2E2B] text-[13px] font-medium transition-colors cursor-pointer"
                            >
                              Загрузить другое фото
                            </button>
                          </div>
                        )}
                      </motion.div>
                    </div>
                  );
                }

                return (
                  <motion.div
                    key={msg.id}
                    initial={{ opacity: 0, y: 10, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ duration: 0.2 }}
                    className="flex justify-end"
                  >
                    <div className="bg-[#A8C7C7] rounded-[18px] px-5 py-4 text-[15px] font-normal text-[#1A2E2B] max-w-[85%] shadow-[0_2px_10px_rgba(168,199,199,0.25)]">
                      {msg.text}
                    </div>
                  </motion.div>
                );
              })}
              {(isUploadingStatement || isSendingMessage || isGeneratingSchedule) && (
                <div className="flex justify-start">
                  <div className="bg-white border border-[#EBEBEB] shadow-[0_4px_20px_rgba(0,0,0,0.035)] rounded-[18px] px-5 py-4 text-[15px] font-normal text-[#1A2E2B] max-w-[85%]">
                    {isUploadingStatement
                      ? 'Распознаю выписку...'
                      : isGeneratingSchedule
                        ? 'Формирую расписание...'
                        : 'Готовлю ответ...'}
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
          </div>
        )}

        {/* Subtle bottom gradient mask in chat mode so messages gliding beneath the input bar fade softly */}
        {isChatMode && (
          <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-[#FAFAFA] via-[#FAFAFA]/75 to-transparent z-10" />
        )}

        {/* Shared Persistent Input Form (static at bottom in chat mode, chat scrolls underneath it) */}
        <ChatInput
          resetKey={inputResetKey}
          draft={inputDraft}
          onHasInputChange={setHasInput}
          onSendMessage={(message) => void handleSendMessage(message)}
          disabled={
            isSendingMessage ||
            isUploadingStatement ||
            isGeneratingSchedule ||
            pendingStatementText !== null
          }
        />
      </main>
    </div>
  );
}
