import { useLayoutEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'

type IconName =
  | 'spark'
  | 'paper'
  | 'medical'

function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }

  switch (name) {
    case 'spark':
      return <svg {...common}><path d="M12 3 10.7 8.3a4.5 4.5 0 0 1-3.4 3.4L2 13l5.3 1.3a4.5 4.5 0 0 1 3.4 3.4L12 23l1.3-5.3a4.5 4.5 0 0 1 3.4-3.4L22 13l-5.3-1.3a4.5 4.5 0 0 1-3.4-3.4L12 3Z" /></svg>
    case 'paper':
      return <svg {...common}><path d="M7 3.5h7l4 4v13H7a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2Z" /><path d="M14 3.5v4h4M8.5 12h5M8.5 15.5h5" /></svg>
    case 'medical':
      return <svg {...common}><path d="M5 4h14M6 4l1.5 6.1A5 5 0 0 0 12.4 14h0a5 5 0 0 0 4.8-3.9L19 4M12 14v5m-4 1h8" /><path d="M9.5 9.5c1.2-2.1 4.8-2.1 5 0 .2 1.5-2.4 2.2-3.2.8-.8-1.3.2-3 2-3.8" /></svg>
    default:
      return null
  }
}

function App() {
  const [message, setMessage] = useState('')
  const [submittedMessage, setSubmittedMessage] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [submittedFile, setSubmittedFile] = useState<File | null>(null)
  const [operation, setOperation] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const messageInputRef = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const input = messageInputRef.current
    if (!input) return

    const resizeInput = () => {
      input.style.height = 'auto'
      input.style.height = `${Math.min(input.scrollHeight, 144)}px`
      input.style.overflowY = input.scrollHeight > 144 ? 'auto' : 'hidden'
    }

    resizeInput()
    window.addEventListener('resize', resizeInput)
    return () => window.removeEventListener('resize', resizeInput)
  }, [message])

  const openFilePicker = () => fileInputRef.current?.click()

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.files?.[0] ?? null
    setFile(next)
    event.target.value = ''
  }

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const text = message.trim()
    if (!text && !file) return

    setSubmittedMessage(text || 'Пожалуйста, помогите разобраться с моей выпиской.')
    setSubmittedFile(file)
    setMessage('')
    setFile(null)
  }

  return (
    <main className="app-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <section className="hero page-width">
        <h1>Recovery</h1>
      </section>

      <section className="composer page-width" aria-label="Опишите ситуацию">
        <div className="quick-actions">
          <button className="quick-action" type="button" onClick={openFilePicker}>
            <Icon name="paper" size={16} />
            <span>Прикрепить выписку</span>
          </button>
          <label className={`quick-action operation-action${operation ? ' is-selected' : ''}`}>
            <Icon name="spark" size={15} />
            <select
              className="operation-select"
              aria-label="Выбрать операцию"
              value={operation}
              onChange={(event) => {
                const operation = event.target.value
                setOperation(operation)
                if (operation) setMessage(`Восстановление после ${operation}`)
              }}
            >
              <option value="">Выбрать операцию</option>
              <option value="аппендэктомии">Аппендэктомия</option>
              <option value="холецистэктомии">Холецистэктомия</option>
              <option value="артроскопии колена">Артроскопия колена</option>
              <option value="эндопротезирования тазобедренного сустава">Эндопротезирование тазобедренного сустава</option>
              <option value="пластики грыжи">Пластика грыжи</option>
              <option value="кесарева сечения">Кесарево сечение</option>
              <option value="операции по удалению катаракты">Операция по удалению катаракты</option>
              <option value="тонзиллэктомии">Тонзиллэктомия</option>
              <option value="операции">Другое</option>
            </select>
          </label>
        </div>

        <form className="message-form" onSubmit={onSubmit}>
          <div className="composer-input-row">
            <textarea
              ref={messageInputRef}
              aria-label="Опишите ваше состояние или задайте вопрос"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="или начните вводить"
              rows={1}
            />
            <button className="send-button" type="submit" disabled={!message.trim() && !file} aria-label="Отправить">
              <Icon name="medical" size={24} />
            </button>
          </div>
          {file && (
            <div className="attached-file">
              <Icon name="paper" size={15} />
              <span>{file.name}</span>
              <button type="button" onClick={() => setFile(null)} aria-label="Убрать файл">×</button>
            </div>
          )}
        </form>
        {submittedMessage && (
          <div className="submitted-message" aria-live="polite">
            <span>{submittedMessage}</span>
            {submittedFile && <small>Прикреплён файл: {submittedFile.name}</small>}
          </div>
        )}
        <input ref={fileInputRef} type="file" hidden accept=".pdf,image/*" onChange={onFileChange} />
      </section>
    </main>
  )
}

export default App
