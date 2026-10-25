import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { esc } from '../lib/format.js';
import { api, get } from '../state/store.js';

/* The animated assistant — a local, rule-based Q&A widget (no external API call). Every figure it states comes from /api/chat,
   which answers via the dashboard's own aggregate(), so it can never disagree with what's on screen. Ported from the source
   dashboard's public/app.js ("animated assistant"): draggable fab with persisted position, a one-time hint bubble, the panel. */
const HINT_KEY = 'aif-hint-done', HINT_MS = 6000, THRESHOLD = 6;
// A small attention bounce of the button, every BOUNCE_EVERY_MS: five hops — the first two slower and a touch higher, the last three quicker.
const BOUNCE_EVERY_MS = 15000;
const BOUNCES = [{ ms: 760, px: 12 }, { ms: 760, px: 12 }, { ms: 400, px: 8 }, { ms: 400, px: 8 }, { ms: 400, px: 8 }];
const hintDone = () => { try { return sessionStorage.getItem(HINT_KEY) === '1'; } catch { return false; } };

/** **bold** markers from the API become <b> (the text is escaped first, so only these markers can produce markup). */
const bold = s => esc(s || '').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
const isNum = c => /^[-+$\d]|^—$|^N\/A$/.test(c || '');

/** A structured analyst answer (kind 'rich'): headline, titled sections (bullets or a small table), caveats, and follow-up questions. */
function renderRich(r) {
  let h = r.title ? `<div class="rtitle">${esc(r.title)}</div>` : '';
  h += `<div class="rsum">${bold(r.reply)}</div>`;
  for (const s of r.sections || []) {
    h += `<div class="rsec"><div class="rhead">${esc(s.heading)}</div>`;
    if (s.bullets) h += `<ul class="rul">${s.bullets.map(x => `<li>${bold(x)}</li>`).join('')}</ul>`;
    if (s.table) {
      const first = s.table.rows[0] || [], right = s.table.head.map((_, i) => i > 0 && isNum(first[i]));
      h += `<table class="rtbl"><thead><tr>${s.table.head.map((c, i) => `<th${right[i] ? ' class="n"' : ''}>${esc(c)}</th>`).join('')}</tr></thead><tbody>`
        + s.table.rows.map(row => `<tr>${row.map((c, i) => `<td${right[i] ? ' class="n"' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('') + '</tbody></table>';
    }
    h += '</div>';
  }
  for (const n of r.notes || []) h += `<div class="rnote">${bold(n)}</div>`;
  if (r.followups && r.followups.length) {
    h += `<div class="rfollow"><div class="rhead">You could also ask</div>${r.followups.map(q => `<button class="csug" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>`;
  }
  return h;
}

function renderBotPayload(result) {
  if (result.kind === 'rich') return renderRich(result);
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
  const [hint, setHint] = useState({ hide: true, in: false, above: false, below: false, ltr: false });
  const wrapRef = useRef(null), fabRef = useRef(null), msgsRef = useRef(null), inputRef = useRef(null), hintRef = useRef(null);
  const faces = useRef([]), talkTimer = useRef(0), hintTimer = useRef(0), hintByHover = useRef(false);
  const live = useRef({ open: false, busy: false });
  const bounceAnim = useRef(null);
  const chatCtx = useRef(null);                      // what the last answer was about (period / product / customer): lets "and in August?" work
  useLayoutEffect(() => { live.current = { open, busy }; });

  const botState = state => faces.current.forEach(f => { if (!f) return; f.classList.remove('thinking', 'talking'); if (state !== 'idle') f.classList.add(state); });
  const botPop = () => faces.current.forEach(f => { if (!f) return; f.classList.remove('pop'); void f.offsetWidth; f.classList.add('pop'); });
  const scrollDown = () => { const m = msgsRef.current; if (m) m.scrollTop = m.scrollHeight; };
  useEffect(scrollDown, [msgs, typing]);

  const addBot = result => {
    setMsgs(m => [...m, { who: 'bot', html: renderBotPayload(result), rich: result.kind === 'rich' }]);
    botPop(); botState('talking');
    clearTimeout(talkTimer.current);
    talkTimer.current = setTimeout(() => botState('idle'), 900);
  };

  // ---- hint bubble ----
  const placeHint = () => {
    const fab = fabRef.current; if (!fab) return { above: false, below: false, ltr: false };
    // not enough room to the left of the button for the bubble (narrow screen, or dragged to the left edge): sit above it, or below it
    // when the button is also near the top. Worked out from the button's position, not by measuring the bubble: it may not be on screen yet.
    const need = Math.min(260, window.innerWidth - 100) + (fab.getBoundingClientRect().width + 12) + 8;
    const noRoomLeft = window.matchMedia('(max-width:640px)').matches || fab.getBoundingClientRect().left < need;
    const nearTop = fab.getBoundingClientRect().top < 90;
    // above / below the button the bubble lines up with the button's right edge; when the button is too close to the left edge for that, with its left edge
    const ltr = fabRef.current ? fabRef.current.getBoundingClientRect().right < 268 : false;
    return { above: noRoomLeft && !nearTop, below: noRoomLeft && nearTop, ltr: noRoomLeft && ltr };
  };
  // The panel opens up-and-left of the button by default; wherever the button has been dragged, open it toward the side with room.
  const placePanel = () => {
    const wrap = wrapRef.current, fab = fabRef.current; if (!wrap || !fab) return;
    const r = fab.getBoundingClientRect(), pw = Math.min(400, window.innerWidth * 0.88), ph = Math.min(640, window.innerHeight * 0.78);
    const left = r.right - 8, right = window.innerWidth - r.left - 8, gap = r.height + 18, up = r.top - gap, down = window.innerHeight - r.bottom - gap;
    wrap.classList.toggle('pl-r', left < pw && right > left);
    wrap.classList.toggle('pl-b', up < ph && down > up);
  };
  const showHint = fromHover => {
    if (live.current.open) return;
    clearTimeout(hintTimer.current);
    setHint({ hide: false, in: false, above: false, below: false, ltr: false });
    requestAnimationFrame(() => {
      setHint({ hide: false, in: true, ...placeHint() });
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

  // ---- attention bounce ----
  const stopBounce = () => { if (bounceAnim.current) { bounceAnim.current.cancel(); bounceAnim.current = null; } };
  const bounce = () => {
    const fab = fabRef.current, wrap = wrapRef.current;
    if (!fab || !fab.animate || live.current.open || document.hidden || bounceAnim.current) return;
    if (wrap && wrap.classList.contains('dragging')) return;
    if (window.matchMedia('(prefers-reduced-motion:reduce)').matches) return;
    const total = BOUNCES.reduce((t, b) => t + b.ms, 0), frames = [];
    let at = 0;
    for (const b of BOUNCES) {
      frames.push({ offset: at / total, translate: '0 0', easing: 'cubic-bezier(.2,.7,.4,1)' });                 // up: fast out, slowing at the top
      frames.push({ offset: (at + b.ms * 0.42) / total, translate: `0 -${b.px}px`, easing: 'cubic-bezier(.6,0,.8,.4)' });   // down: speeding up
      at += b.ms;
    }
    frames.push({ offset: 1, translate: '0 0' });
    const a = fab.animate(frames, { duration: total });
    bounceAnim.current = a;
    a.onfinish = a.oncancel = () => { if (bounceAnim.current === a) bounceAnim.current = null; };
  };
  useEffect(() => { const t = setInterval(bounce, BOUNCE_EVERY_MS); return () => { clearInterval(t); stopBounce(); }; }, []);

  // ---- panel ----
  const openChat = () => {
    stopBounce(); placePanel(); setOpen(true); hideHint(true);
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
      if (chatCtx.current) body.context = chatCtx.current;
      let result;
      try { result = await api('/api/chat', { method: 'POST', body: JSON.stringify(body) }); }       // shared wrapper: cookie session + X-AIF-Client header
      catch (e) {
        if (!e.status) throw e;                                                                         // network failure: handled below
        result = e.body && e.body.reply ? e.body : { reply: e.message, kind: 'text' };                  // e.g. "source not loaded yet" (503)
      }
      if (result && result.context && Object.keys(result.context).length) chatCtx.current = result.context;
      // Hold the typing indicator for at least a beat even on a near-instant reply, so "thinking" reads as a genuine pause.
      await new Promise(r => setTimeout(r, Math.max(0, 450 - (Date.now() - started))));
      setTyping(false); addBot(result);
    } catch {
      setTyping(false); addBot({ reply: "I couldn't reach the server just now — try again in a moment.", kind: 'text' });
    } finally { setBusy(false); botState('idle'); }
  };

  // ---- dragging: the whole widget can be picked up by its button OR by the chat window's header and dropped anywhere on screen. The spot lasts only until the page is reloaded:
  //      every page load starts at the default corner (CSS right/bottom). A real drag suppresses the click. ----
  useEffect(() => {
    const wrap = wrapRef.current, fab = fabRef.current, head = wrap.querySelector('.chat-h');
    const handles = [fab, head].filter(Boolean);
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
    try { localStorage.removeItem('aif-chat-pos'); } catch { /* ignore */ }      // a position remembered by an earlier version must not move it at load
    const down = e => {
      if (e.button != null && e.button !== 0) return;
      if (e.target.closest && e.target.closest('.chat-close')) return;        // the ✕ in the header is a button, not a handle
      dragging = true; moved = false; stopBounce();
      const r = wrap.getBoundingClientRect();
      startX = e.clientX; startY = e.clientY; startLeft = r.left; startTop = r.top;
      e.currentTarget.setPointerCapture?.(e.pointerId);
      e.preventDefault();                                                    // no text selection / native drag while the pointer is held
    };
    const move = e => {
      if (!dragging) return;
      const dx = e.clientX - startX, dy = e.clientY - startY;
      if (!moved && Math.hypot(dx, dy) > THRESHOLD) { moved = true; wrap.classList.add('dragging'); }
      if (moved) { apply(startLeft + dx, startTop + dy); if (live.current.open) placePanel(); }
    };
    const up = e => {
      if (!dragging) return;
      dragging = false;
      if (moved) { wrap.classList.remove('dragging'); if (live.current.open) placePanel(); }
      else if (e.currentTarget === fab) { live.current.open ? closeChat() : openChat(); }      // a plain click on the button toggles the panel
    };
    const cancel = () => { dragging = false; wrap.classList.remove('dragging'); };
    const resize = () => { const r = wrap.getBoundingClientRect(); if (wrap.style.left) apply(r.left, r.top); if (live.current.open) placePanel(); };      // keep a moved widget on screen
    handles.forEach(h => { h.addEventListener('pointerdown', down); h.addEventListener('pointermove', move); h.addEventListener('pointerup', up); h.addEventListener('pointercancel', cancel); });
    window.addEventListener('resize', resize);
    return () => {
      handles.forEach(h => { h.removeEventListener('pointerdown', down); h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', cancel); });
      window.removeEventListener('resize', resize);
    };
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  const onMsgsClick = e => { const b = e.target.closest('.csug'); if (b) send(b.dataset.q); };
  return (
    <div className="chatwrap" id="chatWrap" ref={wrapRef}>
      <div className={['chathint', hint.hide && 'hide', hint.in && 'in', hint.above && 'above', hint.below && 'below', hint.ltr && 'ltr'].filter(Boolean).join(' ')} id="chatHint" role="status" ref={hintRef}>
        <div className="hint-pill">
          <span className="hint-text" id="chatHintText" onClick={openChat}>Ask me about revenue, margin or any product →</span>
          <button type="button" className="hint-x" id="chatHintX" aria-label="Dismiss hint" onClick={e => { e.stopPropagation(); hideHint(true); }}>×</button>
        </div>
      </div>
      <div className={'chatpanel' + (open ? ' show' : '')} id="chatPanel" aria-hidden={open ? 'false' : 'true'}>
        <div className="chat-h">
          <img className="botface" id="chatHeadFace" src="/chat-icon.gif" alt="AIF Assistant" draggable={false} ref={el => { faces.current[1] = el; }} />
          <div className="chat-h-text"><b>AIF Assistant</b><span id="chatStatus">Ask me about this dashboard's data</span></div>
          <button className="chat-close" id="chatClose" aria-label="Close" onClick={closeChat}>✕</button>
        </div>
        <div className="chat-msgs" id="chatMsgs" ref={msgsRef} onClick={onMsgsClick}>
          {msgs.map((m, i) => m.who === 'user'
            ? <div className="cmsg user" key={i}>{m.text}</div>
            : <div className={'cmsg bot' + (m.rich ? ' rich' : '')} key={i} dangerouslySetInnerHTML={{ __html: m.html }} />)}
          {typing ? <div className="cmsg bot" id="chatTyping"><span className="typing"><i /><i /><i /></span></div> : null}
        </div>
        <div className="chat-input-row">
          <input id="chatInput" placeholder="Ask a question…" autoComplete="off" maxLength={300} ref={inputRef} onKeyDown={e => { if (e.key === 'Enter') send(); }} />
          <button id="chatSend" aria-label="Send" disabled={busy} onClick={() => send()}>➤</button>
        </div>
      </div>
      <button className={'chatfab' + (open ? ' open' : '')} id="chatFab" aria-label="Open assistant" aria-describedby="chatHint" ref={fabRef}
        onClick={e => { if (e.detail === 0) (live.current.open ? closeChat() : openChat()); }}      /* keyboard (Enter / Space); pointer clicks are handled on pointerup */
        onMouseEnter={() => { if (!live.current.open && hint.hide) showHint(true); }} onMouseLeave={() => { if (hintByHover.current) hideHint(false); }}>
        <img className="botface" id="chatFabFace" src="/chat-icon.gif" alt="AIF Assistant" draggable={false} ref={el => { faces.current[0] = el; }} />
      </button>
    </div>
  );
}
