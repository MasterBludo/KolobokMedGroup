import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { api, Patient, RecoveryCase, PlanSnapshot, PlanPreview, patientToday } from './api';

interface Message {
  id: string;
  sender: 'assistant' | 'user';
  text: string;
}

interface ChatInputProps {
  disabled: boolean;
  resetKey: number;
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

const DEFAULT_AVATAR_URL = '/src/assets/images/default_user_avatar_1791136890330.jpg';
const TRAIL_RUNNER_BG_URL = '/src/assets/images/trail_runner_bg_1791136878819.jpg';

const OPERATIONS_LIST = [
  'Эндопротезирование тазобедренного сустава',
  'Артроскопия коленного сустава',
  'Реконструкция передней крестообразной связки (ПКС)',
  'Остеосинтез при переломе',
  'Эндопротезирование коленного сустава',
  'Удаление грыжи межпозвоночного диска',
];

function ChatInput({
  disabled,
  resetKey,
  onHasInputChange,
  onSendMessage,
}: ChatInputProps) {
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setInputValue('');
  }, [resetKey]);

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
  const [settingsNameInput, setSettingsNameInput] = useState<string>('');

  // Chat & Input states
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
  const [isAddingTask, setIsAddingTask] = useState<boolean>(false);
  const [newTaskText, setNewTaskText] = useState<string>('');
  const tasksTimeoutRef = useRef<number | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const [patient, setPatient] = useState<Patient | null>(null);
  const [cases, setCases] = useState<RecoveryCase[]>([]);
  const [caseId, setCaseId] = useState('');
  const [snapshot, setSnapshot] = useState<PlanSnapshot>({ plan:null, prescriptions:[], events:[] });
  const [draftId, setDraftId] = useState<string | null>(null);
  const [startDate, setStartDate] = useState('');
  const [calendarDate, setCalendarDate] = useState('');
  const [planPreview, setPlanPreview] = useState<PlanPreview | null>(null);
  const [conflictDecisions, setConflictDecisions] = useState<Record<string,string>>({});
  const [persistenceError, setPersistenceError] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [restoringSession, setRestoringSession] = useState(true);
  const [savingEvents, setSavingEvents] = useState<string[]>([]);
  const [caseBusy, setCaseBusy] = useState(false);
  const patientRef = useRef<string | null>(null);
  const selectedCaseRef = useRef('');

  const clearPatientState = () => {
    patientRef.current=null;selectedCaseRef.current='';setPatient(null);setIsAuthorized(false);setUserName('');setAvatarUrl(DEFAULT_AVATAR_URL);
    setCases([]);setCaseId('');setTasks([]);setSnapshot({plan:null,prescriptions:[],events:[]});
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
  };
  const loadCases = async (current:Patient) => {
    const data=await api<{cases:RecoveryCase[]}>('/cases');
    if (patientRef.current!==current.id) return;
    setCases(data.cases);
    const stored=localStorage.getItem(`recovery-case:${current.id}`);
    const selected=data.cases.find(c=>c.id===stored) || data.cases[0];
    setCaseId(selected?.id || '');
  };
  const acceptPatient = async (current:Patient) => {
    patientRef.current=current.id;setPatient(current);setUserName(current.username);setIsAuthorized(true);
    setCalendarDate(patientToday(current.timezone));
    setTasks([]);setSnapshot({plan:null,prescriptions:[],events:[]});
    await loadCases(current);
  };
  useEffect(() => {
    let live=true;
    api<{patient:Patient|null}>('/auth/me').then(async data=>{
      if (live && data.patient) await acceptPatient(data.patient);
    }).catch(error=>{if(live)setPersistenceError(error.message);}).finally(()=>{if(live)setRestoringSession(false);});
    return ()=>{live=false;};
  },[]);
  useEffect(() => {
    selectedCaseRef.current=caseId;
    setDraftId(null);setPlanPreview(null);setPendingStatementText(null);setPendingStatementMessageId(null);
    setHasInput(false);setInputResetKey(key=>key+1);setMessages([{id:'welcome',sender:'assistant',text:'Привет, чем я могу помочь с восстановлением?'}]);
    setAttachedFileName(null);setRecommendationsText('');setSnapshot({plan:null,prescriptions:[],events:[]});setTasks([]);
    const selected=cases.find(c=>c.id===caseId);
    setSelectedOperation(selected?.procedure_name || null);setStartDate(selected?.recovery_start_date || '');
    if (!caseId || !patient) return;
    localStorage.setItem(`recovery-case:${patient.id}`,caseId);
    let live=true;
    api<PlanSnapshot>(`/cases/${caseId}/plan`).then(value=>{if(live)applySnapshot(value);}).catch(error=>{if(live)setPersistenceError(error.message);});
    return ()=>{live=false;};
  },[caseId,patient?.id]);
  useEffect(() => {
    setTasks(snapshot.events.filter(e=>e.scheduled_date===calendarDate && ['pending','completed'].includes(e.status)).map(e=>({id:e.id,text:`${e.scheduled_time?.slice(0,5) || 'Без времени'} · ${e.title}`,completed:e.status==='completed'})));
  },[snapshot,calendarDate]);
  const createCase = async () => {
    if (!selectedOperation) {setPersistenceError('Выберите операцию для нового эпизода.');return;}
    if (caseBusy) return;
    setCaseBusy(true);setPersistenceError('');
    try {
      const data=await api<{recoveryCase:RecoveryCase}>('/cases',{method:'POST',body:JSON.stringify({procedureName:selectedOperation,startDate:null})});
      setCases(prev=>[data.recoveryCase,...prev]);setCaseId(data.recoveryCase.id);
    } catch(error) {setPersistenceError((error as Error).message);} finally {setCaseBusy(false);}
  };
  const handleLogout = async () => {
    try {
      if (draftId && !await cancelDraft()) return;
      await api('/auth/logout',{method:'POST'});
      clearPatientState();setPersistenceError('');
    } catch(error) {setPersistenceError((error as Error).message);}
  };
  const handlePersistPlan = async () => {
    if (!planPreview || isGeneratingSchedule) return;
    const savingCase=caseId, savingPatient=patientRef.current;
    setIsGeneratingSchedule(true);setPersistenceError('');
    try {
      const value=await api<PlanSnapshot>('/plans/confirm',{method:'POST',body:JSON.stringify({draftId:planPreview.draftId,version:planPreview.version,decisions:conflictDecisions})});
      if (patientRef.current!==savingPatient || selectedCaseRef.current!==savingCase) return;
      applySnapshot(value);setPlanPreview(null);setPendingStatementText(null);setPendingStatementMessageId(null);setDraftId(null);
      setCases(prev=>prev.map(c=>c.id===caseId ? {...c,recovery_start_date:planPreview.startDate}:c));setStartDate(planPreview.startDate);
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

    if (!isAuthorized) {setIsAuthModalOpen(true);return;}
    const userMsg: Message = {
      id: `user-${Date.now()}`,
      sender: 'user',
      text: trimmed,
    };

    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setIsSendingMessage(true);
    const chatPatient=patientRef.current;

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: nextMessages.map((message) => ({
            role: message.sender,
            content: message.text,
          })),
          caseId: caseId || undefined,
        }),
      });
      const data: { reply?: string; error?: string } = await response.json();
      if (response.status===401) window.dispatchEvent(new Event('recovery-session-expired'));
      if (!response.ok) {
        throw new Error(data.error || 'Не удалось получить ответ от сервера.');
      }
      if (!data.reply) {
        throw new Error('Сервер вернул пустой ответ.');
      }
      if (patientRef.current!==chatPatient) return;
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
      if (patientRef.current!==chatPatient) return;
      setMessages((prev) => [
        ...prev,
        {
          id: `assistant-${Date.now()}`,
          sender: 'assistant',
          text: `Не удалось получить ответ: ${errorMessage}`,
        },
      ]);
    } finally {
      setIsSendingMessage(false);
    }
  };

  const handleResetToStart = () => {
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
      setIsAddingTask(false);
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
  const handleAddTaskSubmit = async (e: React.FormEvent) => {
    e.preventDefault();const text=newTaskText.trim();if(!text||!caseId)return;
    try {
      applySnapshot(await api<PlanSnapshot>(`/cases/${caseId}/tasks`,{method:'POST',body:JSON.stringify({text,date:calendarDate})}));
      setNewTaskText('');setIsAddingTask(false);
    } catch(error) {setPersistenceError((error as Error).message);}
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || isUploadingStatement || isGeneratingSchedule) return;
    if (!isAuthorized) {setIsAuthModalOpen(true);return;}
    if (!caseId) {setPersistenceError('Создайте или выберите эпизод восстановления перед загрузкой.');return;}
    if (draftId) await cancelDraft();
    const uploadCaseId=caseId;

    setAttachedFileName(file.name);
    setIsUploadingStatement(true);

    try {
      const extension = file.name.split('.').pop()?.toLowerCase() || '';
      const ocrResponse = await fetch(
        `/api/ocr?extension=${encodeURIComponent(extension)}&caseId=${encodeURIComponent(caseId)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: file,
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
      if (selectedCaseRef.current!==uploadCaseId) return;
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
      const generationCase=caseId, generationPatient=patientRef.current;
      const data=await api<PlanPreview>('/generate-schedule',{method:'POST',body:JSON.stringify({draftId,confirmedText:pendingStatementText,startDate})});
      if (patientRef.current!==generationPatient || selectedCaseRef.current!==generationCase) return;
      setPlanPreview(data);setConflictDecisions({});
    } catch(error) {setPersistenceError((error as Error).message);} finally {setIsGeneratingSchedule(false);}
  };
  const markAllTasksCompleted = async () => {
    for (const task of tasks.filter(t=>!t.completed)) await toggleTask(task.id,true);
  };

  const openSettingsModal = () => {
    setSettingsNameInput(userName);
    setActiveAccountModal('settings');
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const data=await api<{patient:Patient}>('/patient',{method:'PATCH',body:JSON.stringify({username:settingsNameInput})});
      setPatient(data.patient);setUserName(data.patient.username);setActiveAccountModal(null);
    } catch(error) {setPersistenceError((error as Error).message);}
  };
  const statusNotice = (persistenceError || restoringSession) && <div role="status" className="fixed top-2 left-1/2 -translate-x-1/2 z-[70] max-w-[90vw] rounded-[18px] border border-[#EBEBEB] bg-white px-4 py-2 text-[13px] text-[#1A2E2B] shadow-sm" onClick={()=>setPersistenceError('')}>{restoringSession ? 'Проверяю сессию…':persistenceError}</div>;

  // SCREEN 6: Account View ("Аккаунт")
  if (currentScreen === 'account') {
    return (
      <div className="h-screen w-full bg-[#FAFAFA] text-[#1A2E2B] flex flex-col justify-between relative overflow-hidden">
        {statusNotice}
        {/* Hidden file input for Avatar upload */}
        <input
          ref={avatarInputRef}
          type="file"
          accept="image/*"
          onChange={handleAvatarChange}
          className="hidden"
        />

        {/* Top Header:
            - Left: Empty
            - Center: "Аккаунт"
            - Right (Top-Right Corner): "Назад" button as required
        */}
        <header className="shrink-0 w-full px-10 md:px-14 pt-8 pb-4 grid grid-cols-3 items-center relative z-30">
          {/* Top-Left: Empty */}
          <div />

          {/* Top-Center: Title */}
          <div className="flex items-center justify-center">
            <h1 className="text-[18px] font-semibold tracking-tight text-[#1A2E2B]">
              Аккаунт
            </h1>
          </div>

          {/* Top-Right Corner: "Назад" button */}
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={() => setCurrentScreen('main')}
              className="inline-flex items-center gap-2 text-[15px] font-medium text-[#1A2E2B] hover:opacity-70 transition-opacity cursor-pointer"
            >
              <ArrowLeftCircleOutlineIcon className="w-[18px] h-[18px]" />
              <span>Назад</span>
            </button>
          </div>
        </header>

        {/* Account Sub-Modals ("Настройки" & "План реабилитации") with blurred background */}
        <AnimatePresence>
          {activeAccountModal && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setActiveAccountModal(null)}
              className="fixed inset-0 bg-[#1A2E2B]/12 backdrop-blur-md z-50 flex items-center justify-center p-4"
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 10 }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-[400px] rounded-[36px] bg-gradient-to-br from-[#95B8B8] via-[#A8C7C7] to-[#BDD8D8] p-[2px] shadow-[0_24px_64px_rgba(26,46,43,0.18)]"
              >
                <div className="px-6 pt-5 pb-4 flex items-center justify-between">
                  <div>
                    <div className="text-[16px] font-semibold text-[#1A2E2B] leading-tight">
                      {activeAccountModal === 'settings'
                        ? 'Настройки профиля'
                        : 'План реабилитации'}
                    </div>
                    <div className="text-[13px] font-normal text-[#1A2E2B]/70 leading-tight mt-0.5">
                      {activeAccountModal === 'settings'
                        ? 'Личные данные и аватар'
                        : selectedOperation || 'Базовый протокол восстановления'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveAccountModal(null)}
                    className="px-3.5 py-1.5 rounded-full bg-white/35 hover:bg-white/55 text-[#1A2E2B] text-[13px] font-medium transition-colors cursor-pointer"
                  >
                    Закрыть
                  </button>
                </div>

                <div className="bg-[#FAFAFA] rounded-[34px] px-6 pt-6 pb-6">
                  {activeAccountModal === 'settings' ? (
                    <form onSubmit={handleSaveSettings} className="space-y-4">
                      {/* Avatar picker inside settings */}
                      <div className="flex items-center gap-4">
                        <div className="w-16 h-16 rounded-full overflow-hidden bg-[#EAEFEF] border border-[#E0E7E6] shrink-0">
                          <img
                            src={avatarUrl}
                            alt={userName}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <button
                            type="button"
                            onClick={() => avatarInputRef.current?.click()}
                            className="px-3.5 py-1.5 rounded-xl bg-white border border-[#E2E8E7] hover:border-[#A8C7C7] text-[13px] font-medium text-[#1A2E2B] transition-colors cursor-pointer"
                          >
                            Загрузить новое фото
                          </button>
                          {avatarUrl !== DEFAULT_AVATAR_URL && (
                            <button
                              type="button"
                              onClick={() => setAvatarUrl(DEFAULT_AVATAR_URL)}
                              className="text-[12px] text-[#6E7A78] hover:text-[#1A2E2B] text-left cursor-pointer"
                            >
                              Вернуть стандартный аватар
                            </button>
                          )}
                        </div>
                      </div>

                      <div>
                        <label className="block text-[12.5px] font-medium text-[#6E7A78] mb-1.5 px-1">
                          Имя пользователя
                        </label>
                        <input
                          type="text"
                          value={settingsNameInput}
                          onChange={(e) => setSettingsNameInput(e.target.value)}
                          placeholder="Ваше имя"
                          className="w-full h-[50px] bg-white border border-[#EBEBEB] focus:border-[#A8C7C7] rounded-[18px] px-4 text-[14.5px] text-[#1A2E2B] focus:outline-none transition-colors"
                        />
                      </div>

                      <button
                        type="submit"
                        className="w-full h-[52px] rounded-[18px] bg-[#A8C7C7] hover:bg-[#97B8B8] text-[#1A2E2B] font-semibold text-[14.5px] transition-all cursor-pointer"
                      >
                        Сохранить изменения
                      </button>
                    </form>
                  ) : (
                    <div className="space-y-3.5">
                      <div className="p-4 rounded-[20px] bg-white border border-[#EBEBEB]">
                        <div className="text-[12.5px] text-[#7D8986]">Текущий этап</div>
                        <div className="text-[15.5px] font-semibold text-[#1A2E2B] mt-0.5">
                          {snapshot.plan ? 'Подтверждённый план' : 'План ещё не подтверждён'}
                        </div>
                      </div>
                      <div className="space-y-2.5 max-h-[340px] overflow-auto">
                        {snapshot.events.filter(e=>e.status!=='cancelled').map((event) => ({id:event.id,text:`${event.scheduled_date} · ${event.scheduled_time?.slice(0,5) || 'Без времени'} · ${event.title}`,completed:event.status==='completed'})).map((t) => (
                          <div
                            key={t.id}
                            onClick={() => toggleTask(t.id)}
                            className="flex items-center gap-3 p-3 rounded-[16px] bg-white border border-[#F0F0F0] cursor-pointer hover:border-[#A8C7C7]/60 transition-colors"
                          >
                            <span
                              className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                                t.completed
                                  ? 'bg-[#1A2E2B] text-white'
                                  : 'border-[1.5px] border-[#9BA6A4]'
                              }`}
                            >
                              {t.completed && (
                                <svg
                                  viewBox="0 0 16 16"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2.2"
                                  className="w-3 h-3"
                                >
                                  <path d="M3.8 8.3L6.6 11L12.2 5" />
                                </svg>
                              )}
                            </span>
                            <span className="text-[14px] text-[#1A2E2B]">{t.text}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Main Center Profile Card modeled after the reference image */}
        <main
          className={`flex-1 flex items-center justify-center px-4 sm:px-8 pb-10 transition-all duration-200 ${
            activeAccountModal ? 'blur-[6px] pointer-events-none select-none' : ''
          }`}
        >
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="w-full max-w-[780px] rounded-[38px] bg-white/85 p-2.5 shadow-[0_20px_60px_rgba(26,46,43,0.08)] border border-[#ECECEC]"
          >
            <div className="relative w-full min-h-[420px] sm:min-h-[440px] rounded-[30px] bg-white overflow-hidden flex flex-col justify-between p-7 sm:p-10">
              {/* Right-side Trail Runner Background Image with smooth left white gradient blend */}
              <div className="absolute inset-y-0 right-0 w-[72%] sm:w-[66%] h-full pointer-events-none select-none">
                <img
                  src={TRAIL_RUNNER_BG_URL}
                  alt="Восстановление и движение"
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover object-center"
                />
                {/* Soft multi-stop gradient fading the photo into pure white on the left */}
                <div
                  className="absolute inset-0"
                  style={{
                    background:
                      'linear-gradient(90deg, #FFFFFF 0%, #FFFFFF 22%, rgba(255,255,255,0.92) 38%, rgba(255,255,255,0.35) 62%, rgba(255,255,255,0) 85%)',
                  }}
                />
              </div>

              {/* Top Section: Avatar (uploadable/changeable) + User Name below it */}
              <div className="relative z-10 flex flex-col items-start max-w-[380px]">
                {/* Circular Avatar with hover/click upload trigger */}
                <div className="relative group">
                  <button
                    type="button"
                    onClick={() => avatarInputRef.current?.click()}
                    title="Нажмите, чтобы изменить аватар"
                    className="w-[96px] h-[96px] rounded-full bg-[#EFEFEF] overflow-hidden ring-4 ring-white shadow-[0_6px_20px_rgba(0,0,0,0.06)] relative flex items-center justify-center cursor-pointer focus:outline-none"
                  >
                    <img
                      src={avatarUrl}
                      alt={userName}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-[#1A2E2B]/45 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center text-white text-[11px] font-medium">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="w-5 h-5 mb-0.5"
                      >
                        <path d="M23 19C23 19.5304 22.7893 20.0391 22.4142 20.4142C22.0391 20.7893 21.5304 21 21 21H3C2.46957 21 1.96086 20.7893 1.58579 20.4142C1.21071 20.0391 1 19.5304 1 19V8C1 7.46957 1.21071 6.96086 1.58579 6.58579C1.96086 6.21071 2.46957 6 3 6H7L9 3H15L17 6H21C21.5304 6 22.0391 6.21071 22.4142 6.58579C22.7893 6.96086 23 7.46957 23 8V19Z" />
                        <circle cx="12" cy="13" r="4" />
                      </svg>
                      <span>Фото</span>
                    </div>
                  </button>
                </div>

                {/* User Name (set during registration) */}
                <h2 className="mt-5 text-[26px] sm:text-[28px] font-bold text-[#1A2E2B] tracking-tight leading-snug">
                  {userName}
                </h2>
                {selectedOperation && (
                  <p className="mt-1 text-[14px] text-[#5B6866] font-normal">
                    {selectedOperation}
                  </p>
                )}
              </div>

              {/* Bottom Row:
                  - Left: "Настройки" and "План реабилитации" buttons
                  - Right (in place of "Get in touch"): "Выйти из аккаунта" button
              */}
              <div className="relative z-10 flex flex-col sm:flex-row items-start sm:items-end justify-between gap-4 mt-12">
                {/* Left buttons: Настройки & План реабилитации */}
                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    type="button"
                    onClick={openSettingsModal}
                    className="h-[48px] px-5 rounded-[18px] bg-[#F5F7F6] hover:bg-[#A8C7C7]/35 border border-[#E6ECEB] text-[14.5px] font-medium text-[#1A2E2B] inline-flex items-center gap-2.5 transition-all cursor-pointer"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="w-[17px] h-[17px] text-[#1A2E2B]"
                    >
                      <circle cx="12" cy="12" r="3" />
                      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                    </svg>
                    <span>Настройки</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveAccountModal('plan')}
                    className="h-[48px] px-5 rounded-[18px] bg-[#F5F7F6] hover:bg-[#A8C7C7]/35 border border-[#E6ECEB] text-[14.5px] font-medium text-[#1A2E2B] inline-flex items-center gap-2.5 transition-all cursor-pointer"
                  >
                    <StethoscopeOutlineIcon className="w-[17px] h-[17px] text-[#1A2E2B]" />
                    <span>План реабилитации</span>
                  </button>
                </div>

                {/* Right pill button (in place of "Get in touch" on the reference card): Logout */}
                <button
                  type="button"
                  onClick={() => void handleLogout()}
                  className="h-[52px] px-8 rounded-full bg-white hover:bg-[#FAFAFA] active:scale-95 text-[#1A2E2B] text-[15px] font-semibold shadow-[0_10px_28px_rgba(0,0,0,0.14)] flex items-center justify-center transition-all cursor-pointer shrink-0"
                >
                  Выйти из аккаунта
                </button>
              </div>
            </div>
          </motion.div>
        </main>
      </div>
    );
  }

  return (
    <div className="h-screen w-full bg-[#FAFAFA] text-[#1A2E2B] flex flex-col relative overflow-hidden">
      {statusNotice}
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
                    Recovery ID
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
                      disabled={authBusy || restoringSession}
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

      {isAuthorized && <div className="absolute top-[82px] left-1/2 -translate-x-1/2 z-30 flex flex-wrap justify-center items-center gap-2 max-w-[90vw] text-[12px]">
        <select aria-label="Эпизод восстановления" value={caseId} onChange={e=>{const next=e.target.value;void cancelDraft().then(cancelled=>{if(cancelled)setCaseId(next);});}} disabled={isUploadingStatement || isGeneratingSchedule} className="max-w-[220px] bg-white border border-[#EBEBEB] rounded-full px-3 py-2">
          <option value="">Выберите эпизод</option>{cases.map(c=><option key={c.id} value={c.id}>{c.procedure_name} · {c.recovery_start_date || 'Дата не подтверждена'}</option>)}
        </select>
        <select aria-label="Операция нового эпизода" value={selectedOperation || ''} onChange={e=>setSelectedOperation(e.target.value)} className="max-w-[190px] bg-white border border-[#EBEBEB] rounded-full px-3 py-2">
          <option value="">Операция</option>{OPERATIONS_LIST.map(op=><option key={op} value={op}>{op}</option>)}
        </select>
        <button type="button" disabled={caseBusy || isUploadingStatement || isGeneratingSchedule} onClick={()=>void createCase()} className="bg-[#A8C7C7] rounded-full px-3 py-2">Создать эпизод</button>
      </div>}

      {/* TOP HEADER (Static, never scrolls) */}
      <header className="shrink-0 w-full px-10 md:px-14 pt-8 pb-4 grid grid-cols-3 items-center relative z-40">
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
                    <div className="w-[348px] rounded-[36px] bg-gradient-to-br from-[#94B8B8] via-[#A8C7C7] to-[#C2DCDC] p-[2px] shadow-[0_24px_60px_rgba(26,46,43,0.14)] select-none">
                      {/* Green Accent Header (matching the send button color #A8C7C7) */}
                      <div className="px-6 pt-5 pb-4 flex items-start justify-between">
                        <div>
                          <div className="text-[16px] font-medium text-[#1A2E2B] leading-tight">
                            Reminders
                          </div>
                          <div className="text-[14px] font-normal text-[#1A2E2B]/70 leading-tight tabular-nums mt-1">
                            <input aria-label="Дата задач" type="date" value={calendarDate} onChange={e=>setCalendarDate(e.target.value)} className="bg-transparent max-w-[150px]" />
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
                            Tasks for Today
                          </h3>

                          <ul className="space-y-3.5 pr-12">
                            {tasks.map((task) => (
                              <li key={task.id}>
                                <button
                                  type="button"
                                  onClick={() => void toggleTask(task.id)}
                                  disabled={savingEvents.includes(task.id)}
                                  title={snapshot.events.find(e=>e.id===task.id)?.description}
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

                          {isAddingTask && (
                            <form onSubmit={handleAddTaskSubmit} className="mt-3.5 pr-14">
                              <input
                                type="text"
                                autoFocus
                                value={newTaskText}
                                onChange={(e) => setNewTaskText(e.target.value)}
                                onBlur={handleAddTaskSubmit}
                                placeholder="New task..."
                                className="w-full bg-white border border-[#DCE4E3] rounded-xl px-3 py-1.5 text-[14px] text-[#1A2E2B] placeholder:text-[#9BA6A4] focus:outline-none focus:border-[#A8C7C7]"
                              />
                            </form>
                          )}
                        </div>

                        {/* Floating Plus Button inside the bottom-right of the card */}
                        <button
                          type="button"
                          onClick={() => setIsAddingTask(true)}
                          disabled={!caseId}
                          aria-label="Add task"
                          className="absolute bottom-5 right-5 w-[50px] h-[50px] rounded-full bg-white border border-[#E6ECEB] shadow-[0_4px_14px_rgba(26,46,43,0.06)] flex items-center justify-center text-[#1A2E2B] hover:bg-[#A8C7C7]/25 hover:scale-105 active:scale-95 transition-all cursor-pointer"
                        >
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            className="w-5 h-5"
                          >
                            <path d="M12 5V19" />
                            <path d="M5 12H19" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>

        {/* Center Zone: Brand "Recovery" (blurs when Tasks popover is open) */}
        <div
          className={`flex items-center justify-center transition-all duration-200 ${
            isTasksOpen ? 'blur-[6px] opacity-60 pointer-events-none' : ''
          }`}
        >
          <button
            type="button"
            onClick={handleResetToStart}
            className="text-[18px] font-semibold tracking-tight text-[#1A2E2B] hover:opacity-80 transition-opacity cursor-pointer"
          >
            Recovery
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
                  onClick={() => setIsOperationMenuOpen((prev) => !prev)}
                  className="w-full h-[58px] bg-white border border-[#EBEBEB] hover:border-[#DCDCDC] rounded-[18px] px-3.5 flex items-center justify-between gap-2 text-left transition-all shadow-[0_2px_10px_rgba(0,0,0,0.015)] hover:shadow-[0_4px_14px_rgba(0,0,0,0.04)] cursor-pointer"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-9 h-9 rounded-[11px] bg-[#F2F4F3] flex items-center justify-center text-[#1A2E2B] shrink-0">
                      <StethoscopeOutlineIcon className="w-[18px] h-[18px]" />
                    </span>
                    <span className="text-[14.5px] font-medium text-[#1A2E2B] truncate">
                      {selectedOperation ? selectedOperation : 'Выберите операцию'}
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

                {/* Operation Picker Dropdown (overlays input bar cleanly) */}
                <AnimatePresence>
                  {isOperationMenuOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 6 }}
                      transition={{ duration: 0.15 }}
                      className="absolute left-0 right-0 top-full mt-2 bg-white border border-[#EBEBEB] rounded-[18px] shadow-[0_16px_40px_rgba(26,46,43,0.12)] py-2 z-50"
                    >
                      {OPERATIONS_LIST.map((op) => (
                        <button
                          key={op}
                          type="button"
                          onClick={() => {
                            setSelectedOperation(op);
                            setIsOperationMenuOpen(false);
                          }}
                          className={`w-full text-left px-4 py-2.5 text-[13.5px] hover:bg-[#F5F7F6] transition-colors cursor-pointer ${
                            selectedOperation === op
                              ? 'font-semibold text-[#1A2E2B] bg-[#F2F4F3]/60'
                              : 'text-[#1A2E2B]'
                          }`}
                        >
                          {op}
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
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
                        {msg.text}
                        {msg.id === pendingStatementMessageId && pendingStatementText && (
                          <div className="flex flex-col gap-2 mt-4">
                            <textarea aria-label="Подтверждённые рекомендации" value={pendingStatementText} onChange={e=>{setPendingStatementText(e.target.value);setPlanPreview(null);}} disabled={isGeneratingSchedule} className="w-full min-h-[120px] rounded-xl border border-[#EBEBEB] p-3 text-[13px]" />
                            <label className="text-[13px]">Дата начала курса <input type="date" value={startDate} onChange={e=>{setStartDate(e.target.value);setPlanPreview(null);}} disabled={!!cases.find(c=>c.id===caseId)?.recovery_start_date || isGeneratingSchedule} className="rounded-xl border border-[#EBEBEB] p-2" /></label>
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
