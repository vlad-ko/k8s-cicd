// LESSON 6: Earning Money - work turns into coins (effort -> reward).
export default {
  id: 'earn',
  no: 'LESSON 6',
  name: 'Earning Money',
  sub: 'Work turns into coins',
  icon: '\u{1F4AA}',
  rewardTitle: 'You are an earner!',
  prop: {
    cls: 'prop-coins',
    img: '/assets/props/earn.png',
    size: '54px',
    html: `<svg viewBox="0 0 60 50">
          <ellipse cx="30" cy="44" rx="20" ry="6" fill="#e08e0b"/>
          <ellipse cx="30" cy="40" rx="20" ry="6" fill="#f5a623"/>
          <ellipse cx="30" cy="36" rx="20" ry="6" fill="#e08e0b"/>
          <ellipse cx="30" cy="32" rx="20" ry="6" fill="#f5a623"/>
          <circle cx="22" cy="20" r="10" fill="#ffb938" stroke="#e08e0b" stroke-width="1.5"/>
          <path d="M22 15 v10 M19.5 17.5 h5 M19.5 22.5 h5" stroke="#e08e0b" stroke-width="1.6" fill="none" stroke-linecap="round"/>
        </svg>`,
  },
  run(ctx) {
    const jobs = [
      { emoji: '\u{1FAB4}', name: 'Water the plants', coins: 2 },
      { emoji: '\u{1F9F9}', name: 'Tidy your toys',   coins: 2 },
      { emoji: '\u{1F436}', name: 'Walk the dog',     coins: 2 },
      { emoji: '\u{1F373}', name: 'Help make lunch',  coins: 2 },
    ];
    let earned = 0;
    let done = 0;

    const finish = () => {
      ctx.renderStep(
        `<div class="lesson-intro">${ctx.speech(`Amazing! \u{1F4AA} You earned <b>${earned} coins</b> by helping out. That is how earning works: your <b>effort</b> turns into money. The more you help, the more you can earn, then you can save it, grow it, and reach your goals! \u{1FA99}`)}</div>`,
        `<button class="btn" id="earnFin">Finish Lesson ⭐</button>`
      );
      ctx.ovActions.querySelector('#earnFin').onclick =
        () => ctx.finish("You learned how to earn money by helping! A pile of coins appeared in Webo's world. \u{1FA99}");
    };

    ctx.renderStep(`
      <div class="lesson-intro">${ctx.speech("Money does not just appear. You can <b>earn</b> it by helping out and doing a good job! \u{1F4AA} Tap each chore to do it and watch your coins grow.")}</div>
      <div class="lesson-stage">
        <div class="earn-total">\u{1FA99} <span class="earn-count">0</span> coins earned</div>
        <div class="earn-jobs">
          ${jobs.map((j, idx) => `<button class="choice earn-job" data-i="${idx}">${j.emoji} ${j.name} <span class="earn-pay">+${j.coins} \u{1FA99}</span></button>`).join('')}
        </div>
        <div class="feedback" id="earnFb"></div>
      </div>
    `, `<button class="btn" id="earnNext" disabled>Do all your chores</button>`);

    const body = ctx.ovBody;
    const fb = body.querySelector('#earnFb');
    const next = ctx.ovActions.querySelector('#earnNext');
    const count = body.querySelector('.earn-count');

    body.querySelectorAll('.earn-job').forEach((b) => {
      b.onclick = () => {
        if (b.disabled) return;
        const j = jobs[+b.dataset.i];
        b.disabled = true;
        b.classList.add('correct');
        earned += j.coins;
        done++;
        count.textContent = earned;
        fb.innerHTML = `Nice work! \u{1F31F} You earned <b>${j.coins} coins</b> for that. Great helping!`;
        fb.className = 'feedback good show';
        if (done === jobs.length) {
          next.disabled = false;
          next.textContent = 'See what Webo thinks →';
          next.onclick = finish;
        }
      };
    });
  },
};
