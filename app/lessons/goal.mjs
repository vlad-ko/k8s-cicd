// LESSON 5: Saving for a Goal - patience pays off (delayed gratification).
export default {
  id: 'goal',
  no: 'LESSON 5',
  name: 'Saving for a Goal',
  sub: 'Patience pays off',
  icon: '\u{1FA81}',
  rewardTitle: 'Patience pays off!',
  prop: {
    cls: 'prop-kite',
    img: '/assets/props/goal.png',
    size: '56px',
    html: `<svg viewBox="0 0 60 92">
          <path d="M30 4 L52 34 L30 58 L8 34 Z" fill="#9d7bea"/>
          <path d="M30 4 L40 34 L30 58 L20 34 Z" fill="#b79bf0"/>
          <path d="M30 4 L30 58 M8 34 L52 34" stroke="#0a1628" stroke-width="2"/>
          <path d="M30 58 Q35 70 27 78 Q21 86 30 92" stroke="#f5a623" stroke-width="2.5" fill="none"/>
          <circle cx="30" cy="70" r="3" fill="#ff7b6b"/><circle cx="26" cy="81" r="3" fill="#5ed47a"/>
        </svg>`,
  },
  run(ctx) {
    const GOAL = 5;   // coins needed for the kite
    let saved = 0;    // coins in the goal jar
    let week = 1;     // current week
    let spent = 0;    // times the kid chose to spend instead of save

    const finish = () => {
      const msg = spent === 0
        ? `Wow, you saved every single week! \u{1F451} That is super patience. Saving a little at a time gets you the BIG thing.`
        : `You got your kite! \u{1FA81} Saving instead of spending right away got you something bigger. Patience pays off!`;
      ctx.renderStep(
        `<div class="lesson-intro">${ctx.speech(msg)}</div>`,
        `<button class="btn" id="goalFin">Finish Lesson ⭐</button>`
      );
      ctx.ovActions.querySelector('#goalFin').onclick =
        () => ctx.finish("You saved for a goal! A kite is flying in Webo's world now. \u{1FA81}");
    };

    const round = () => {
      const pct = Math.round((saved / GOAL) * 100);
      ctx.renderStep(`
        <div class="lesson-intro">${ctx.speech(`You really want this kite \u{1FA81}. It costs <b>${GOAL} coins</b>. Each week you get <b>1 coin</b>. Save it for the kite, or spend it on a treat right now?`)}</div>
        <div class="lesson-stage">
          <div class="goal-top">\u{1FA81} <span class="goal-count">${saved} / ${GOAL}</span></div>
          <div class="goal-bar"><div class="goal-fill" style="width:${pct}%"></div></div>
          <div class="goal-week">Week <b>${week}</b> &middot; you have <b>1 coin</b> \u{1FA99}</div>
          <div class="goal-choices">
            <button class="choice goal-save">\u{1F4B0} Save it for the kite</button>
            <button class="choice goal-spend">\u{1F36C} Spend it on candy</button>
          </div>
          <div class="feedback" id="goalFb"></div>
        </div>
      `, `<button class="btn" id="goalNext" disabled>Pick Save or Spend</button>`);

      const body = ctx.ovBody;
      const fb = body.querySelector('#goalFb');
      const next = ctx.ovActions.querySelector('#goalNext');
      const choices = body.querySelectorAll('.goal-choices .choice');
      const fill = body.querySelector('.goal-fill');
      const count = body.querySelector('.goal-count');

      const lockAndAdvance = (label) => {
        choices.forEach((x) => { x.disabled = true; });
        next.disabled = false;
        next.textContent = label;
      };

      body.querySelector('.goal-save').onclick = () => {
        saved++;
        week++;
        fill.style.width = Math.round((saved / GOAL) * 100) + '%';
        count.textContent = `${saved} / ${GOAL}`;
        body.querySelector('.goal-save').classList.add('correct');
        if (saved >= GOAL) {
          fb.innerHTML = `You did it! \u{1F389} Your kite jar is full. Waiting really paid off! \u{1FA81}`;
          fb.className = 'feedback good show';
          lockAndAdvance('Fly the kite →');
          next.onclick = finish;
          return;
        }
        fb.innerHTML = `Great choice! \u{1F31F} Your kite jar is filling up. Just <b>${GOAL - saved}</b> to go!`;
        fb.className = 'feedback good show';
        lockAndAdvance('Next week →');
        next.onclick = () => round();
      };

      body.querySelector('.goal-spend').onclick = () => {
        spent++;
        week++;
        body.querySelector('.goal-spend').classList.add('wrong');
        fb.innerHTML = `Yum, candy! \u{1F36C} But the coin is gone, so the kite is still <b>${GOAL - saved}</b> coins away. Patience is tricky!`;
        fb.className = 'feedback info show';
        lockAndAdvance('Next week →');
        next.onclick = () => round();
      };
    };

    round();
  },
};
