import { useRef, useState, type ChangeEvent } from 'react'

type IconName =
  | 'spark'
  | 'chat'
  | 'paper'
  | 'arrow'
  | 'shield'
  | 'clock'
  | 'upload'
  | 'check'
  | 'close'
  | 'profile'

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
    case 'chat':
      return <svg {...common}><path d="M20 11.5a7 7 0 0 1-7 7H8l-4 3v-4.3A7 7 0 0 1 6 4.8 7.2 7.2 0 0 1 12 2.5h1a7 7 0 0 1 7 7v2Z" /><path d="M8.5 10.5h.01M12 10.5h.01M15.5 10.5h.01" /></svg>
    case 'paper':
      return <svg {...common}><path d="M7 3.5h7l4 4v13H7a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2Z" /><path d="M14 3.5v4h4M8.5 12h5M8.5 15.5h5" /></svg>
    case 'arrow':
      return <svg {...common}><path d="M5 19 19 5" /><path d="M7 5h12v12" /></svg>
    case 'shield':
      return <svg {...common}><path d="M12 3 19 6v5.5c0 4.3-2.8 7.8-7 9.5-4.2-1.7-7-5.2-7-9.5V6l7-3Z" /><path d="m9 12 2 2 4-4" /></svg>
    case 'clock':
      return <svg {...common}><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3 2" /></svg>
    case 'upload':
      return <svg {...common}><path d="M12 15V4" /><path d="m8 8 4-4 4 4" /><path d="M5 13v5.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V13" /></svg>
    case 'check':
      return <svg {...common}><path d="m5 12 4 4L19 6" /></svg>
    case 'close':
      return <svg {...common}><path d="m6 6 12 12M18 6 6 18" /></svg>
    case 'profile':
      return <svg {...common}><circle cx="12" cy="8" r="3.2" /><path d="M5.5 20c.7-3.4 2.8-5.2 6.5-5.2s5.8 1.8 6.5 5.2" /></svg>
    default:
      return null
  }
}

function App() {
  const [mode, setMode] = useState<'chat' | 'upload' | null>(null)
  const [dragging, setDragging] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const openFilePicker = () => fileInputRef.current?.click()

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.files?.[0] ?? null
    setFile(next)
  }

  const clearFile = () => setFile(null)

  return (
    <main className="app-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <header className="topbar page-width">
        <div className="brand" aria-label="Recovery home">
          <div className="brand-mark"><Icon name="spark" size={18} /></div>
          <span>recovery</span>
        </div>
        <div className="topbar-actions">
          <span className="privacy-chip"><span className="privacy-dot" /> Private & secure</span>
          <button className="avatar-button" aria-label="Open profile"><Icon name="profile" size={21} /></button>
        </div>
      </header>

      <section className="hero page-width">
        <div className="eyebrow"><span className="eyebrow-icon"><Icon name="spark" size={14} /></span> Your recovery companion</div>
        <h1>Let's take recovery<br /><span>one step at a time.</span></h1>
        <p className="hero-copy">
          Ask a question, share how you're feeling, or upload your discharge papers.<br className="desktop-break" />
          We'll help you understand what comes next.
        </p>
      </section>

      <section className="options-grid page-width" aria-label="Get started">
        <button className="action-card card-chat" onClick={() => setMode('chat')}>
          <div className="action-icon"><Icon name="chat" size={28} /></div>
          <div className="action-content">
            <div className="action-kicker">START WITH A CONVERSATION</div>
            <h2>Talk to your<br />recovery companion</h2>
            <p>Tell me what's bothering you or ask a question about your recovery.</p>
          </div>
          <div className="action-footer">
            <span>Start chatting</span>
            <span className="round-arrow"><Icon name="arrow" size={18} /></span>
          </div>
        </button>

        <button className="action-card card-upload" onClick={() => setMode('upload')}>
          <div className="action-icon"><Icon name="paper" size={28} /></div>
          <div className="action-content">
            <div className="action-kicker">PERSONALIZE YOUR RECOVERY</div>
            <h2>Upload your<br />discharge papers</h2>
            <p>We'll read your instructions and build a simple plan around them.</p>
          </div>
          <div className="action-footer">
            <span>Upload a document</span>
            <span className="round-arrow"><Icon name="arrow" size={18} /></span>
          </div>
        </button>
      </section>

      <section className="trust-row page-width">
        <div className="trust-item"><span className="trust-icon"><Icon name="shield" size={18} /></span><div><strong>Your data stays yours</strong><span>Private by design</span></div></div>
        <div className="trust-item"><span className="trust-icon"><Icon name="clock" size={18} /></span><div><strong>Available when you need it</strong><span>Support between visits</span></div></div>
      </section>

      <section className="lower-card page-width">
        <div className="lower-art"><div className="art-orb art-orb-a" /><div className="art-orb art-orb-b" /><div className="art-ring" /></div>
        <div className="lower-copy">
          <span className="lower-label">A calmer way to recover</span>
          <h3>Bring your instructions with you, not a stack of paper.</h3>
          <p>Your discharge information can become a clear, day-by-day guide that you can come back to whenever you need it.</p>
        </div>
        <div className="lower-note"><span className="lower-note-dot" /><span>Designed to support your care, not replace your doctor.</span></div>
      </section>

      <footer className="page-width footer">
        <span>AI Post-Operative Recovery Platform</span>
        <span>Prototype · 2026</span>
      </footer>

      <input ref={fileInputRef} type="file" hidden accept=".pdf,image/png,image/jpeg,image/jpg" onChange={onFileChange} />

      {mode && (
        <div className="modal-backdrop" onMouseDown={() => setMode(null)}>
          <section className="modal" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setMode(null)} aria-label="Close"><Icon name="close" size={20} /></button>

            {mode === 'chat' ? (
              <>
                <div className="modal-icon modal-icon-chat"><Icon name="chat" size={25} /></div>
                <span className="modal-label">NEW CONVERSATION</span>
                <h2>What’s on your mind today?</h2>
                <p>Start with a question or simply tell your recovery companion how you’re feeling.</p>
                <div className="chat-input-shell"><span>Share what's happening...</span><span className="send-dot"><Icon name="arrow" size={17} /></span></div>
                <button className="primary-button" onClick={() => setMode(null)}>Continue to chat</button>
              </>
            ) : (
              <>
                <div className="modal-icon modal-icon-upload"><Icon name="upload" size={25} /></div>
                <span className="modal-label">UPLOAD DISCHARGE PAPERS</span>
                <h2>Let's build your plan.</h2>
                <p>Upload a PDF or a clear photo of your discharge instructions. We'll extract the key details for you to review.</p>
                <div
                  className={`dropzone ${dragging ? 'is-dragging' : ''}`}
                  onDragEnter={(event) => { event.preventDefault(); setDragging(true) }}
                  onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
                  onDragLeave={(event) => { event.preventDefault(); setDragging(false) }}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDragging(false);
                    setFile(event.dataTransfer.files?.[0] ?? null)
                  }}
                  onClick={openFilePicker}
                >
                  <span className="drop-icon"><Icon name="upload" size={26} /></span>
                  {file ? <><strong>{file.name}</strong><small>{Math.max(1, Math.round(file.size / 1024))} KB · ready to review</small></> : <><strong>Drop it here or browse</strong><small>PDF, JPG or PNG · up to 10 MB</small></>}
                </div>
                {file && <button className="clear-file" onClick={clearFile}>Remove selected file</button>}
                <button className="primary-button" onClick={() => setMode(null)} disabled={!file}>Continue</button>
              </>
            )}
          </section>
        </div>
      )}
    </main>
  )
}

export default App
