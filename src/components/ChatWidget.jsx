import { useEffect, useRef, useState } from 'react';
import { esc } from '../lib/format.js';
import { get } from '../state/store.js';

/* The animated assistant — a local, rule-based Q&A widget (no external API call). Every figure it states comes from /api/chat,
   which answers via the dashboard's own aggregate(), so it can never disagree with what's on screen. Ported from the source
   dashboard's public/app.js ("animated assistant"): draggable fab with persisted position, a one-time hint bubble, the panel. */
const HINT_KEY = 'aif-hint-done', HINT_MS = 6000, THRESHOLD = 6;
const hintDone = () => { try { return sessionStorage.getItem(HINT_KEY) === '1'; } catch { return false; } };

function renderBotPayload(result) {
  let html = esc(result.reply || '').replace(/\n/g, '<br>');
  if (result.kind === 'suggestions' && result.items?.length) {
    html += `<div class="clist">${result.items.map(s => `<button class="csug" data-q="${esc(s)}">${esc(s)}</button>`).join('')}</div>`;
  } else if (result.kind === 'list' && result.items?.length) {
    html += `<div class="clist">${result.items.map(r => `<div class="crow"><span>${r.rank}. ${esc(r.label)}<span class="csub">${esc(r.sub || '')}</span></span><b>${esc(r.value)}</b></div>`).join('')}</div>`;
  }
  return html;
}

export function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [typing, setTyping] = useState(false);
  const [msgs, setMsgs] = useState([]);                  // { who: 'user'|'bot', text|html }
  const [hint, setHint] = useState({ hide: true, in: false, above: false });
  const wrapRef = useRef(null), fabRef = useRef(null), msgsRef = useRef(null), inputRef = useRef(null), hintRef = useRef(null);
  const faces = useRef([]), talkTimer = useRef(0), hintTimer = useRef(0), hintByHover = useRef(false);
  const live = useRef({ open: false, busy: false });
  live.current = { open, busy };

  const botState = state => faces.current.forEach(f => { if (!f) return; f.classList.remove('thinking', 'talking'); if (state !== 'idle') f.classList.add(state); });
  const botPop = () => faces.current.forEach(f => { if (!f) return; f.classList.remove('pop'); void f.offsetWidth; f.classList.add('pop'); });
  const scrollDown = () => { const m = msgsRef.current; if (m) m.scrollTop = m.scrollHeight; };
  useEffect(scrollDown, [msgs, typing]);

  const addBot = result => {
    setMsgs(m => [...m, { who: 'bot', html: renderBotPayload(result) }]);
    botPop(); botState('talking');
    clearTimeout(talkTimer.current);
    talkTimer.current = setTimeout(() => botState('idle'), 900);
  };

  // ---- hint bubble ----
  const placeHint = () => {
    const h = hintRef.current; if (!h) return false;
    // not enough room to the left of the button (narrow screen, or dragged to the left edge): sit above it instead
    return window.matchMedia('(max-width:640px)').matches || h.getBoundingClientRect().left < 8;
  };
  const showHint = fromHover => {
    if (live.current.open) return;
    clearTimeout(hintTimer.current);
    setHint({ hide: false, in: false, above: false });
    requestAnimationFrame(() => {
      setHint({ hide: false, in: true, above: placeHint() });
    });
    hintByHover.current = !!fromHover;
    if (!fromHover) hintTimer.current = setTimeout(() => hideHint(false), HINT_MS);
  };
  const hideHint = markDone => {
    clearTimeout(hintTimer.current); hintByHover.current = false;
    setHint(h => ({ ...h, hide: true, in: false }));
    if (markDone) { try { sessionStorage.setItem(HINT_KEY, '1'); } catch { /* ignore */ } }
  };
  useEffect(() => {
    // A brief, once-per-session invitation — shows shortly after load, fades out by itself, and stays away once dismissed or opened.
    if (!hintDone()) { const t = setTimeout(() => showHint(false), 800); return () => clearTimeout(t); }
    return undefined;
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  // ---- panel ----
  const openChat = () => {
    setOpen(true); hideHint(true);
    setMsgs(m => (m.length ? m : [{ who: 'bot', html: renderBotPayload({ reply: "Hi! I'm your AIF assistant — ask me about revenue, margin, or a specific product, customer or month. Try \"help\" for examples.", kind: 'text' }) }]));
    setTimeout(() => inputRef.current && inputRef.current.focus(), 250);
  };
  const closeChat = () => setOpen(false);
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape' && live.current.open) closeChat(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const send = async text => {
    text = (text ?? inputRef.current.value).trim();
    if (!text || live.current.busy) return;
    inputRef.current.value = '';
    setMsgs(m => [...m, { who: 'user', text }]);
    setBusy(true); botState('thinking'); setTyping(true);
    const started = Date.now();
    try {
      const st = get();
      const body = { source: st.source, message: text };
      if (st.from && st.to) { body.from = st.from; body.to = st.to; }
      const res = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-aif-user': st.user }, body: JSON.stringify(body) });
      const result = await res.json().catch(() => ({ reply: `HTTP ${res.status}`, kind: 'text' }));
      // Hold the typing indicator for at least a beat even on a near-instant reply, so "thinking" reads as a genuine pause.
      await new Promise(r => setTimeout(r, Math.max(0, 450 - (Date.now() - started))));
      setTyping(false); addBot(result);
    } catch {
      setTyping(false); addBot({ reply: "I couldn't reach the server just now — try again in a moment.", kind: 'text' });
    } finally { setBusy(false); botState('idle'); }
  };

  // ---- dragging: the whole widget can be picked up by its fab; the chosen spot persists across reloads. A real drag suppresses the click. ----
  useEffect(() => {
    const wrap = wrapRef.current, fab = fabRef.current;
    let dragging = false, moved = false, startX = 0, startY = 0, startLeft = 0, startTop = 0;
    const clamp = (left, top) => {
      const w = wrap.offsetWidth, h = wrap.offsetHeight;
      const maxLeft = Math.max(8, window.innerWidth - w - 8), maxTop = Math.max(8, window.innerHeight - h - 8);
      return { left: Math.min(Math.max(8, left), maxLeft), top: Math.min(Math.max(8, top), maxTop) };
    };
    const apply = (left, top) => {
      const c = clamp(left, top);
      wrap.style.left = c.left + 'px'; wrap.style.top = c.top + 'px'; wrap.style.right = 'auto'; wrap.style.bottom = 'auto';
      return c;
    };
    const save = c => { try { localStorage.setItem('aif-chat-pos', JSON.stringify(c)); } catch { /* ignore */ } };
    try {
      const saved = JSON.parse(localStorage.getItem('aif-chat-pos') || 'null');
      if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) apply(saved.left, saved.top);
    } catch { /* ignore */ }
    const down = e => {
      if (e.button != null && e.button !== 0) return;
      dragging = true; moved = false;
      const r = wrap.getBoundingClientRect();
      startX = e.clientX; startY = e.clientY; startLeft = r.left; startTop = r.top;
      fab.setPointerCapture?.(e.pointerId);
    };
    const move = e => {
      if (!dragging) return;
      const dx = e.clientX - startX, dy = e.clientY - startY;
      if (!moved && Math.hypot(dx, dy) > THRESHOLD) { moved = true; wrap.classList.add('dragging'); }
      if (moved) apply(startLeft + dx, startTop + dy);
    };
    const up = () => {
      if (!dragging) return;
      dragging = false;
      if (moved) { wrap.classList.remove('dragging'); const r = wrap.getBoundingClientRect(); save(clamp(r.left, r.top)); }
      else { live.current.open ? closeChat() : openChat(); }
    };
    const cancel = () => { dragging = false; wrap.classList.remove('dragging'); };
    const resize = () => { const r = wrap.getBoundingClientRect(); if (wrap.style.left) save(apply(r.left, r.top)); };
    fab.addEventListener('pointerdown', down); fab.addEventListener('pointermove', move); fab.addEventListener('pointerup', up); fab.addEventListener('pointercancel', cancel);
    window.addEventListener('resize', resize);
    return () => {
      fab.removeEventListener('pointerdown', down); fab.removeEventListener('pointermove', move); fab.removeEventListener('pointerup', up); fab.removeEventListener('pointercancel', cancel);
      window.removeEventListener('resize', resize);
    };
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  const onMsgsClick = e => { const b = e.target.closest('.csug'); if (b) send(b.dataset.q); };
  return (
    <div className="chatwrap" id="chatWrap" ref={wrapRef}>
      <div className={['chathint', hint.hide && 'hide', hint.in && 'in', hint.above && 'above'].filter(Boolean).join(' ')} id="chatHint" role="status" ref={hintRef}>
        <div className="hint-pill">
          <span className="hint-text" id="chatHintText" onClick={openChat}>Ask me about revenue, margin or any product →</span>
          <button type="button" className="hint-x" id="chatHintX" aria-label="Dismiss hint" onClick={e => { e.stopPropagation(); hideHint(true); }}>×</button>
        </div>
      </div>
      <div className={'chatpanel' + (open ? ' show' : '')} id="chatPanel" aria-hidden={open ? 'false' : 'true'}>
        <div className="chat-h">
          <img className="botface" id="chatHeadFace" src="/chat-icon.gif" alt="AIF Assistant" ref={el => { faces.current[1] = el; }} />
          <div className="chat-h-text"><b>AIF Assistant</b><span id="chatStatus">Ask me about this dashboard's data</span></div>
          <button className="chat-close" id="chatClose" aria-label="Close" onClick={closeChat}>✕</button>
        </div>
        <div className="chat-msgs" id="chatMsgs" ref={msgsRef} onClick={onMsgsClick}>
          {msgs.map((m, i) => m.who === 'user'
            ? <div className="cmsg user" key={i}>{m.text}</div>
            : <div className="cmsg bot" key={i} dangerouslySetInnerHTML={{ __html: m.html }} />)}
          {typing ? <div className="cmsg bot" id="chatTyping"><span className="typing"><i /><i /><i /></span></div> : null}
        </div>
        <div className="chat-input-row">
          <input id="chatInput" placeholder="Ask a question…" autoComplete="off" maxLength={300} ref={inputRef} onKeyDown={e => { if (e.key === 'Enter') send(); }} />
          <button id="chatSend" aria-label="Send" disabled={busy} onClick={() => send()}>➤</button>
        </div>
      </div>
      <button className={'chatfab' + (open ? ' open' : '')} id="chatFab" aria-label="Open assistant" aria-describedby="chatHint" ref={fabRef}
        onMouseEnter={() => { if (!live.current.open && hint.hide) showHint(true); }} onMouseLeave={() => { if (hintByHover.current) hideHint(false); }}>
        <img className="botface" id="chatFabFace" src="/chat-icon.gif" alt="AIF Assistant" ref={el => { faces.current[0] = el; }} />
      </button>
    </div>
  );
}
