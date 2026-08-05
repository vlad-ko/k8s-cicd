// LESSON 4: Needs vs Wants - what we must have vs what is nice.
export default {
  id: 'needs',
  no: 'LESSON 4',
  name: 'Needs vs Wants',
  sub: 'What we must have vs what is nice',
  icon: '\u{1F9FA}',
  rewardTitle: 'Needs vs Wants done!',
  prop: {
    cls: 'prop-basket',
    img: '/assets/props/needs.png',
    size: '60px',
    html: `<svg viewBox="0 0 70 60">
          <circle cx="28" cy="22" r="8" fill="#ff7b6b"/>
          <circle cx="44" cy="20" r="9" fill="#5ed47a"/>
          <rect x="33" y="12" width="6" height="14" rx="3" fill="#f5a623"/>
          <path d="M14 28 L56 28 L50 56 L20 56 Z" fill="#b9762e"/>
          <path d="M13 28 L57 28 L55 34 L15 34 Z" fill="#e08e0b"/>
          <path d="M22 38 L48 38 M21 46 L49 46" stroke="#8a5620" stroke-width="2" fill="none"/>
          <path d="M22 28 Q35 8 48 28" stroke="#8a5620" stroke-width="3" fill="none"/>
        </svg>`,
  },
  run(ctx) {
    const items = ctx.shuffle([
      { emoji: '\u{1F34E}', name: 'an apple',       need: true,  why: 'our bodies need food to grow strong' },
      { emoji: '\u{1F9F8}', name: 'a teddy bear',    need: false, why: 'toys are fun, but we can live without them' },
      { emoji: '\u{1F3E0}', name: 'a home',          need: true,  why: 'everyone needs a safe place to live' },
      { emoji: '\u{1F36C}', name: 'candy',           need: false, why: 'it is yummy to want, but not something we need' },
      { emoji: '\u{1F9E5}', name: 'a warm coat',     need: true,  why: 'we need warm clothes when it is cold' },
      { emoji: '\u{1F3AE}', name: 'a video game',    need: false, why: 'it is fun to want, not a need' },
    ]);
    let score = 0;

    const card = (i) => {
      const it = items[i];
      const isLast = i === items.length - 1;
      ctx.renderStep(`
        <div class="lesson-intro">${ctx.speech("Some things we <b>need</b> to live, and some are just nice to <b>want</b>. Tap the right basket for each one! \u{1F9FA}")}</div>
        <div class="lesson-stage">
          <div class="nw-progress">Item <b>${i + 1}</b> of ${items.length}</div>
          <div class="nw-item">${it.emoji}<div class="nw-name">${it.name}</div></div>
          <div class="nw-choices">
            <button class="choice nw-need" data-need="true">\u{2705} Need</button>
            <button class="choice nw-want" data-need="false">\u{2728} Want</button>
          </div>
          <div class="feedback" id="nwFb"></div>
        </div>
      `, `<button class="btn" id="nwNext" disabled>Pick Need or Want</button>`);

      const body = ctx.ovBody;
      const fb = body.querySelector('#nwFb');
      const next = ctx.ovActions.querySelector('#nwNext');
      body.querySelectorAll('.nw-choices .choice').forEach((b) => {
        b.onclick = () => {
          const chose = b.dataset.need === 'true';
          body.querySelectorAll('.nw-choices .choice').forEach((x) => { x.disabled = true; });
          body.querySelector(it.need ? '.nw-need' : '.nw-want').classList.add('correct');
          const name = it.name.charAt(0).toUpperCase() + it.name.slice(1);
          if (chose === it.need) {
            score++;
            fb.innerHTML = `Yes! \u{1F31F} ${name} is a <b>${it.need ? 'need' : 'want'}</b> because ${it.why}.`;
            fb.className = 'feedback good show';
          } else {
            b.classList.add('wrong');
            fb.innerHTML = `Good thinking! Actually ${it.name} is a <b>${it.need ? 'need' : 'want'}</b> because ${it.why}.`;
            fb.className = 'feedback info show';
          }
          next.disabled = false;
          next.textContent = isLast ? 'See what Webo thinks →' : 'Next →';
        };
      });
      next.onclick = () => {
        if (!isLast) { card(i + 1); return; }
        ctx.renderStep(
          `<div class="lesson-intro">${ctx.speech(`Awesome sorting! \u{1F9FA} You got <b>${score} of ${items.length}</b>. The big idea: <b>needs come first</b> (food, a home, warm clothes), then we can choose <b>wants</b> with what is left. \u{1F49B}`)}</div>`,
          `<button class="btn" id="nwFin">Finish Lesson ⭐</button>`
        );
        ctx.ovActions.querySelector('#nwFin').onclick = () => ctx.finish("You learned needs vs wants! A basket of goodies appeared in Webo's world. \u{1F9FA}");
      };
    };
    card(0);
  },
};
