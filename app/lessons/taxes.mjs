// LESSON 9: The Town Jar - taxes as community sharing. Each house pays a little into
// a shared jar; as it fills, things no one could buy alone appear for everyone.
// Strictly educational, metaphor only - no politics, no figures. Zero-CSS drop-in.
export default {
  id: 'taxes',
  no: 'LESSON 9',
  name: 'The Town Jar',
  sub: 'Why we share (taxes)',
  icon: '\u{1F3D8}\u{FE0F}',
  rewardTitle: 'A town that shares!',
  prop: {
    pos: { left: '40%', bottom: '4px' },
    img: '/assets/props/taxes.png',
    size: '84px',
    html: `<svg width="64" height="46" viewBox="0 0 64 46">
          <rect x="4" y="24" width="16" height="18" fill="#ff7b6b"/>
          <path d="M2 24 L12 14 L22 24 Z" fill="#e08e0b"/>
          <rect x="9" y="30" width="6" height="12" fill="#7a5230"/>
          <rect x="24" y="18" width="16" height="24" fill="#4fd1c5"/>
          <path d="M22 18 L32 8 L42 18 Z" fill="#e08e0b"/>
          <rect x="29" y="26" width="6" height="16" fill="#7a5230"/>
          <rect x="44" y="26" width="16" height="16" fill="#9d7bea"/>
          <path d="M42 26 L52 16 L62 26 Z" fill="#e08e0b"/>
          <rect x="49" y="32" width="6" height="10" fill="#7a5230"/>
        </svg>`,
  },
  run(ctx) {
    const SHARE = 3;
    const HOUSES = 4;
    const GOAL = SHARE * HOUSES; // 12
    const things = [
      { at: 3,  emoji: '\u{1F333}', name: 'a park' },
      { at: 6,  emoji: '\u{1F692}', name: 'a fire truck' },
      { at: 9,  emoji: '\u{1F4DA}', name: 'a library' },
      { at: 12, emoji: '\u{1F3EB}', name: 'a school' },
    ];
    let jar = 0;
    let paid = 0;
    let shownCount = 0;

    const finish = () => {
      ctx.renderStep(
        `<div class="lesson-intro">${ctx.speech("Look what you did! \u{1F31F} Every house gave just a <b>little</b>, and together the whole town got a <b>park, a fire truck, a library, and a school</b> that nobody could buy alone. That shared money is called <b>taxes</b>. We each give a little so everyone gets a lot. \u{1F49B}")}</div>`,
        `<button class="btn" id="taxFin">Finish Lesson ⭐</button>`
      );
      ctx.ovActions.querySelector('#taxFin').onclick =
        () => ctx.finish("You learned what taxes are! A little town appeared in Webo's world. \u{1F3D8}\u{FE0F}");
    };

    ctx.renderStep(`
      <div class="lesson-intro">${ctx.speech("Everyone in town puts a little money into a big <b>Town Jar</b> \u{1FAD9}. Then we can ALL share things no one could buy alone! Tap each house to pay its share.")}</div>
      <div class="lesson-stage">
        <div class="goal-top">\u{1FAD9} <span class="goal-count">0 / ${GOAL}</span></div>
        <div class="goal-bar"><div class="goal-fill" style="width:0"></div></div>
        <div class="goal-top" id="townThings" style="font-size:30px;min-height:38px"></div>
        <div class="nw-choices" id="houses">
          ${Array.from({ length: HOUSES }, (_, h) => `<button class="choice house" data-h="${h}">\u{1F3E0}</button>`).join('')}
        </div>
        <div class="feedback" id="taxFb"></div>
      </div>
    `, `<button class="btn" id="taxBtn" disabled>Have every house pay its share</button>`);

    const body = ctx.ovBody;
    const count = body.querySelector('.goal-count');
    const fill = body.querySelector('.goal-fill');
    const townThings = body.querySelector('#townThings');
    const fb = body.querySelector('#taxFb');
    const btn = ctx.ovActions.querySelector('#taxBtn');

    body.querySelectorAll('.house').forEach((h) => {
      h.onclick = () => {
        if (h.disabled) return;
        h.disabled = true;
        h.classList.add('correct');
        jar += SHARE;
        paid++;
        count.textContent = `${jar} / ${GOAL}`;
        fill.style.width = Math.round(jar / GOAL * 100) + '%';
        const unlocked = things.filter((t) => jar >= t.at);
        townThings.innerHTML = unlocked.map((t) => t.emoji).join('  ');
        if (unlocked.length > shownCount) {
          const newest = unlocked[unlocked.length - 1];
          fb.innerHTML = `The town jar grew, so <b>${newest.name}</b> ${newest.emoji} appeared for everyone to share!`;
          fb.className = 'feedback good show';
          shownCount = unlocked.length;
        }
        if (paid === HOUSES) {
          btn.disabled = false;
          btn.textContent = 'See what Webo says →';
        }
      };
    });
    btn.onclick = () => finish();
  },
};
