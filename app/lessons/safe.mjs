// LESSON 8: Keeping Money Safe - pocket (loses coins) -> piggy bank (safe at home)
// -> bank (super safe + a little growth). Reuses existing classes + inline prop.pos.
export default {
  id: 'safe',
  no: 'LESSON 8',
  name: 'Keeping Money Safe',
  sub: 'Piggy bank to a bank',
  icon: '\u{1F3E6}',
  rewardTitle: 'Safe and sound!',
  prop: {
    pos: { left: '3%', bottom: '122px' },
    img: '/assets/props/safe.png',
    size: '62px',
    html: `<svg width="60" height="52" viewBox="0 0 60 52">
          <path d="M30 4 L54 18 L6 18 Z" fill="#f5e6c8"/>
          <rect x="8" y="18" width="44" height="4" fill="#e08e0b"/>
          <rect x="12" y="22" width="5" height="22" fill="#f5e6c8"/>
          <rect x="22" y="22" width="5" height="22" fill="#f5e6c8"/>
          <rect x="32" y="22" width="5" height="22" fill="#f5e6c8"/>
          <rect x="42" y="22" width="5" height="22" fill="#f5e6c8"/>
          <rect x="6" y="44" width="48" height="5" rx="1" fill="#e08e0b"/>
        </svg>`,
  },
  run(ctx) {
    let coins = 10;

    // Step 3: a bank keeps it super safe AND adds a little over time.
    const bank = () => {
      ctx.renderStep(`
        <div class="lesson-intro">${ctx.speech("A <b>bank</b> is like a giant safe \u{1F3E6}. It keeps LOTS of money super safe, and as a thank-you it even adds a <b>little extra</b> over time!")}</div>
        <div class="lesson-stage">
          <div class="goal-top">\u{1F3E6} <span class="goal-count">${coins} coins</span></div>
          <div class="goal-bar"><div class="goal-fill" style="width:100%"></div></div>
          <div class="goal-week">Safety: <b>Super safe!</b> \u{1F512}</div>
          <div class="feedback" id="safeFb"></div>
        </div>
      `, `<button class="btn" id="safeBtn">Keep coins in the bank</button>`);
      const fb = ctx.ovBody.querySelector('#safeFb');
      const count = ctx.ovBody.querySelector('.goal-count');
      const btn = ctx.ovActions.querySelector('#safeBtn');
      btn.onclick = () => {
        btn.disabled = true;
        fb.innerHTML = 'Your coins are locked up super safe \u{1F512}. Now wait a little...';
        fb.className = 'feedback good show';
        const reveal = () => {
          coins += 1;
          count.textContent = coins + ' coins';
          fb.innerHTML = `\u{1F389} The bank added a <b>bonus coin</b> as a thank-you! You have <b>${coins}</b> now. Safe money can even grow over time!`;
          btn.disabled = false; btn.textContent = 'Finish Lesson ⭐';
          btn.onclick = () => ctx.finish("You learned to keep money safe! A little bank appeared in Webo's world. \u{1F3E6}");
        };
        if (ctx.reduceMotion) reveal(); else setTimeout(reveal, 1000);
      };
    };

    // Step 2: a piggy bank keeps coins safe at home.
    const piggy = () => {
      ctx.renderStep(`
        <div class="lesson-intro">${ctx.speech("Let's put your coins in a <b>piggy bank</b> \u{1F437}. It keeps them safe at home, no more falling out!")}</div>
        <div class="lesson-stage">
          <div class="goal-top">\u{1F437} <span class="goal-count">${coins} coins</span></div>
          <div class="goal-bar"><div class="goal-fill" style="width:70%"></div></div>
          <div class="goal-week">Safety: <b>Safe at home</b> \u{1F642}</div>
          <div class="feedback good show" style="display:block">Nice! Your <b>${coins} coins</b> are safe in the piggy bank. But it can only hold so much, and it cannot grow. Is there somewhere even better?</div>
        </div>
      `, `<button class="btn" id="safeBtn">Try a bank \u{1F3E6}</button>`);
      ctx.ovActions.querySelector('#safeBtn').onclick = () => bank();
    };

    // Step 1: a pocket is not safe - coins fall out.
    ctx.renderStep(`
      <div class="lesson-intro">${ctx.speech("You have <b>10 coins</b> in your <b>pocket</b> \u{1F456}. But pockets have holes! Tap to see what happens...")}</div>
      <div class="lesson-stage">
        <div class="goal-top">\u{1F456} <span class="goal-count">10 coins</span></div>
        <div class="goal-bar"><div class="goal-fill" style="width:30%; background: linear-gradient(90deg, var(--red), #d9594a);"></div></div>
        <div class="goal-week">Safety: <b>Not safe!</b> \u{26A0}\u{FE0F}</div>
        <div class="goal-choices"><button class="choice" id="pocketCheck">\u{1F440} Check my pocket</button></div>
        <div class="feedback" id="safeFb"></div>
      </div>
    `, `<button class="btn" id="safeBtn" disabled>Check your pocket first</button>`);
    const count = ctx.ovBody.querySelector('.goal-count');
    const fb = ctx.ovBody.querySelector('#safeFb');
    const check = ctx.ovBody.querySelector('#pocketCheck');
    const btn = ctx.ovActions.querySelector('#safeBtn');
    check.onclick = () => {
      if (check.disabled) return;
      check.disabled = true;
      coins -= 2;
      count.textContent = coins + ' coins';
      fb.innerHTML = "Oh no! \u{1F61F} <b>2 coins fell out</b> through a hole. Pockets are not safe for keeping money. Let's find somewhere better!";
      fb.className = 'feedback info show';
      btn.disabled = false; btn.textContent = 'Find a safe place \u{1F437}';
    };
    btn.onclick = () => piggy();
  },
};
