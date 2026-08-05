// Webo's Money World - core Alpine component (ES module).
//
// Owns app-wide state (lessons progress, persistence, cross-device codes, chat) and
// wires the lesson registry to the view. Each lesson is a self-contained module in
// lessons/ (see lessons/index.mjs); the core derives the lesson list, world props,
// progress dots, and reward titles from that registry - so adding a lesson is a
// single new file + one import line, with no edits here.
//
// Registered as an Alpine component on `alpine:init` so the CSP can stay tight
// (no inline script; script-src 'self' 'unsafe-eval').
import { LESSONS } from './lessons/index.mjs';
import { weboHtml, propArt, speech, escapeHtml, mergeProgress, prefersReducedMotion } from './lib/lesson-kit.mjs';

function weboWorld() {
  return {
    weboSvg: weboHtml(),

    // ---------- progress (persisted), derived from the lesson registry ----------
    lessons: LESSONS.map((l) => ({ id: l.id, no: l.no, name: l.name, sub: l.sub, icon: l.icon, completed: false })),
    STORAGE_KEY: 'webo-money-world.v1',

    // ---------- transient UI state ----------
    hint: 'Tap Webo to say hi!',
    overlayOpen: false, overlayTitle: '', currentLesson: 0,
    rewardOpen: false, rewardTitle: '', rewardText: '',
    chatOpen: false, chatBusy: false, chatInput: '',
    chatHistory: [],   // [{role, content}] sent to the backend for context
    messages: [],      // [{who:'bot'|'me', html}] rendered in the log
    suggestions: ['Why does money grow?', 'What is saving?', 'Is it bad to spend money?', 'What is a stock?'],

    // ---------- derived ----------
    get stars() { return this.lessons.filter((l) => l.completed).length; },
    isLocked(i) { return i > 0 && !this.lessons[i - 1].completed; },
    hasAsked() { return this.messages.some((m) => m.who === 'me'); },

    // ---------- lifecycle ----------
    init() {
      this.load();
      this.seedStars();
    },

    load() {
      try {
        const raw = localStorage.getItem(this.STORAGE_KEY);
        if (!raw) return;
        const saved = JSON.parse(raw);
        if (saved && Array.isArray(saved.lessons)) {
          saved.lessons.forEach((sl) => {
            const l = this.lessons.find((x) => x.id === sl.id);
            if (l) l.completed = !!sl.completed;
          });
        }
      } catch (e) { /* corrupt storage -> start fresh, never throw at a child */ }
    },

    save() {
      try {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify({
          stars: this.stars,
          lessons: this.lessons.map((l) => ({ id: l.id, completed: l.completed })),
        }));
      } catch (e) { /* private mode / quota -> progress just will not persist */ }
    },

    // ---------- cross-device progress code (anonymous, no PII; see /api/progress) ----------
    codeOpen: false, codeBusy: false, myCode: '', codeInput: '', codeMsg: '', codeMsgKind: '',

    openCodeModal() {
      this.myCode = ''; this.codeInput = ''; this.codeMsg = ''; this.codeMsgKind = '';
      this.codeOpen = true;
    },

    // The blob sent to the cloud: lesson completion only, never anything identifying.
    progressBlob() {
      return { v: 1, stars: this.stars, lessons: this.lessons.map((l) => ({ id: l.id, completed: l.completed })) };
    },

    async saveToCloud() {
      this.codeBusy = true; this.codeMsg = ''; this.codeMsgKind = ''; this.myCode = '';
      try {
        const res = await fetch('/api/progress', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ progress: this.progressBlob() }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.code) {
          this.myCode = data.code;
        } else {
          this.codeMsg = data.error || 'Could not get a code right now. Please try again later!';
          this.codeMsgKind = 'err';
        }
      } catch (e) {
        this.codeMsg = 'Could not get a code right now. Please try again later!';
        this.codeMsgKind = 'err';
      } finally {
        this.codeBusy = false;
      }
    },

    async restoreFromCloud() {
      const code = (this.codeInput || '').trim();
      if (!code) return;
      this.codeBusy = true; this.codeMsg = ''; this.codeMsgKind = '';
      try {
        const res = await fetch('/api/progress?code=' + encodeURIComponent(code));
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.progress) {
          this.applyProgress(data.progress);
          this.codeMsg = 'Your stars are here! \u{2B50}';
          this.codeMsgKind = 'ok';
        } else {
          this.codeMsg = data.error || 'That code did not work. Please check it and try again!';
          this.codeMsgKind = 'err';
        }
      } catch (e) {
        this.codeMsg = 'That code did not work. Please check it and try again!';
        this.codeMsgKind = 'err';
      } finally {
        this.codeBusy = false;
      }
    },

    // Merge restored progress into local state (never downgrades). See lesson-kit.
    applyProgress(blob) {
      mergeProgress(this.lessons, blob);
      this.save();
    },

    seedStars() {
      const c = this.$refs.worldStars;
      for (let i = 0; i < 26; i++) {
        const s = document.createElement('i');
        s.style.left = Math.random() * 100 + '%';
        s.style.top = Math.random() * 70 + '%';
        s.style.animationDelay = Math.random() * 3 + 's';
        c.appendChild(s);
      }
    },

    statusIcon(i) {
      if (this.lessons[i].completed)
        return '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="11" fill="#5ed47a"/><path d="M7 12l3.5 3.5L17 9" stroke="#0a1628" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      if (this.isLocked(i))
        return '<svg viewBox="0 0 24 24" fill="#9fb4d4"><path d="M12 2a5 5 0 00-5 5v3H6a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2v-8a2 2 0 00-2-2h-1V7a5 5 0 00-5-5zm3 8H9V7a3 3 0 016 0z"/></svg>';
      return '<svg viewBox="0 0 24 24" fill="none" stroke="#f5a623" stroke-width="2.5" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg>';
    },

    // ---------- world props (data-driven from the registry) ----------
    // Return the full class STRING (tuned class + reactive `on`). Alpine's :class does
    // NOT support a mixed ['str', {obj}] array - it stringifies the object to
    // "[object Object]" and never applies the toggle - which silently hid every prop
    // after the platform refactor. A method returning a plain string is reactive and
    // correct (the completed flag is passed in, so the binding re-runs on change).
    propClasses(i, done) { return (LESSONS[i].prop.cls || '') + (done ? ' on' : ''); },
    // A lesson may position its prop with a tuned CSS class (prop.cls) or, for a
    // zero-CSS drop-in, an inline position object (prop.pos: {left/right, bottom}).
    propStyle(i) {
      const p = LESSONS[i].prop.pos;
      return p ? Object.entries(p).map(([k, v]) => `${k}:${v}`).join(';') : '';
    },
    propHtml(i) { return propArt(LESSONS[i].prop); },

    // ---------- lesson navigation ----------
    openLesson(i) {
      if (this.isLocked(i)) return;
      this.currentLesson = i;
      this.overlayTitle = this.lessons[i].name;
      this.overlayOpen = true;
      this.$nextTick(() => LESSONS[i].run(this._lessonCtx()));
    },
    closeOverlay() { this.overlayOpen = false; },

    // The context handed to each lesson's run(): the scaffold render + the helpers a
    // lesson needs, without exposing the whole component.
    _lessonCtx() {
      const self = this;
      return {
        renderStep: (bodyHtml, actionsHtml) => self.renderStep(bodyHtml, actionsHtml),
        speech,
        shuffle: (a) => self.shuffle(a),
        finish: (text) => self.complete(self.currentLesson, text),
        reduceMotion: prefersReducedMotion(),
        get ovBody() { return self.$refs.ovBody; },
        get ovActions() { return self.$refs.ovActions; },
      };
    },

    // Render one lesson "screen" into the scaffold: bodyHtml fills the scrollable
    // body (intro -> stage -> feedback), actionsHtml fills the pinned footer.
    renderStep(bodyHtml, actionsHtml) {
      this.$refs.ovBody.innerHTML = bodyHtml;
      this.$refs.ovActions.innerHTML = actionsHtml || '';
      this.$refs.ovBody.scrollTop = 0;
    },

    // ---------- completion (idempotent: re-finishing never awards a 2nd star) ----------
    complete(i, text) {
      if (!this.lessons[i].completed) {
        this.lessons[i].completed = true;
        this.save();
      }
      this.overlayOpen = false;
      this.fireConfetti();
      this.rewardTitle = LESSONS[i].rewardTitle || 'You did it!';
      this.rewardText = text;
      this.rewardOpen = true;
    },

    shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; },

    // ---------- hero Webo tap (cosmetic) ----------
    tapWebo(el) {
      const hints = ["Money grows when you are patient! \u{1F331}", "Three jars: Spend, Save, Grow! \u{1FAD9}", "Tiny coins become BIG over time! ✨", "Spread your seeds around! \u{1F333}", "You are doing great, buddy! \u{1F49B}"];
      this.hint = hints[Math.floor(Math.random() * hints.length)];
      el.animate([{ transform: 'translateY(0) scale(1)' }, { transform: 'translateY(-12px) scale(1.06)' }, { transform: 'translateY(0) scale(1)' }], { duration: 500, easing: 'ease-out' });
    },

    fireConfetti() {
      const colors = ['#f5a623', '#4fd1c5', '#5ed47a', '#ff7b6b', '#9d7bea', '#ffb938'];
      for (let i = 0; i < 40; i++) {
        const c = document.createElement('div'); c.className = 'confetti';
        c.style.left = Math.random() * 100 + '%';
        c.style.background = colors[i % colors.length];
        c.style.transform = 'rotate(' + Math.random() * 360 + 'deg)';
        document.body.appendChild(c);
        const fall = 600 + Math.random() * 700;
        c.animate([{ transform: `translateY(0) rotate(0)`, opacity: 1 }, { transform: `translateY(${window.innerHeight + 40}px) rotate(${Math.random() * 720}deg)`, opacity: .2 }], { duration: fall + 1400, easing: 'cubic-bezier(.3,.6,.5,1)' });
        setTimeout(() => c.remove(), fall + 1500);
      }
    },

    // ================= ASK WEBO (server-proxied Claude) =================
    openChat() {
      this.chatOpen = true;
      if (this.messages.length === 0) {
        this.messages.push({ who: 'bot', html: "Hi there! I'm Webo \u{1F916} Ask me ANYTHING about money and I'll explain it in a fun way. What do you want to know?" });
      }
      this.$nextTick(() => { const i = document.querySelector('.chat-input input'); if (i) i.focus(); });
    },

    scrollChat() { this.$nextTick(() => { const log = this.$refs.chatLog; if (log) log.scrollTop = log.scrollHeight; }); },

    async sendChat(preset) {
      const text = (preset !== undefined ? preset : this.chatInput).trim();
      if (!text || this.chatBusy) return;
      this.chatInput = '';
      this.messages.push({ who: 'me', html: escapeHtml(text) });
      this.chatHistory.push({ role: 'user', content: text });
      this.chatBusy = true;
      this.scrollChat();
      try {
        const res = await fetch('/api/ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // send only the recent turns for context; the server holds the system prompt + key
          body: JSON.stringify({ messages: this.chatHistory.slice(-12), clientId: this.clientId() }),
        });
        const data = await res.json().catch(() => ({}));
        const reply = (data && typeof data.reply === 'string' && data.reply.trim())
          ? data.reply.trim()
          : "Hmm, my circuits got a little fuzzy! \u{1F916} Try asking me again!";
        this.messages.push({ who: 'bot', html: escapeHtml(reply).replace(/\n/g, '<br>') });
        this.chatHistory.push({ role: 'assistant', content: reply });
      } catch (e) {
        this.messages.push({ who: 'bot', html: "Oops, my antenna lost signal! \u{1F4E1} Ask me again in a moment!" });
      }
      this.chatBusy = false;
      this.scrollChat();
    },

    // Anonymous per-browser id for per-session rate limiting. Random, no PII;
    // persisted in localStorage. Lets kids sharing one IP each get their own budget.
    clientId() {
      const KEY = 'webo-money-world.cid';
      try {
        let id = localStorage.getItem(KEY);
        if (!id) {
          id = (crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now() + '-' + Math.random().toString(36).slice(2));
          id = id.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
          localStorage.setItem(KEY, id);
        }
        return id;
      } catch (e) {
        return ''; // private mode / no storage -> fall back to IP-only limiting
      }
    },
  };
}

// Register the component before Alpine initializes (CSP-clean, no inline script).
document.addEventListener('alpine:init', () => { window.Alpine.data('weboWorld', weboWorld); });
