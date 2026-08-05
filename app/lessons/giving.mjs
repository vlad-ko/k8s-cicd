// LESSON 7: Giving and Sharing - a little from many adds up to a lot.
// Reuses existing semantic classes (.goal-bar/.goal-fill/.goal-count/.choice/.feedback)
// and an inline prop position, so it is a true zero-CSS drop-in.
export default {
  id: 'giving',
  no: 'LESSON 7',
  name: 'Giving and Sharing',
  sub: 'A little from many adds up',
  icon: '\u{1F49B}',
  rewardTitle: 'You are a giver!',
  prop: {
    pos: { left: '3%', bottom: '50px' },
    img: '/assets/props/giving.png',
    size: '60px',
    html: `<svg width="58" height="58" viewBox="0 0 58 58">
          <path d="M15 56 V32 M29 56 V26 M43 56 V34" stroke="#3fae5c" stroke-width="3" stroke-linecap="round" fill="none"/>
          <ellipse cx="15" cy="28" rx="7" ry="9" fill="#ff7b6b"/>
          <ellipse cx="29" cy="22" rx="7" ry="9" fill="#f5a623"/>
          <ellipse cx="43" cy="30" rx="7" ry="9" fill="#9d7bea"/>
          <circle cx="15" cy="28" r="2.5" fill="#fff"/><circle cx="29" cy="22" r="2.5" fill="#fff"/><circle cx="43" cy="30" r="2.5" fill="#fff"/>
        </svg>`,
  },
  run(ctx) {
    const GOAL = 20;
    let myCoins = 5;
    let shared = 0;

    // Step 2: show that many kids each sharing a little fills the whole goal.
    const bloom = () => {
      ctx.renderStep(
        `<div class="lesson-intro">${ctx.speech(`You shared <b>${shared} ${shared === 1 ? 'coin' : 'coins'}</b>! \u{1F49B} Now watch what happens when LOTS of kids each share a little too...`)}</div>
         <div class="lesson-stage">
           <div class="goal-top">\u{1F333} <span class="goal-count">${shared} / ${GOAL}</span></div>
           <div class="goal-bar"><div class="goal-fill" style="width:${Math.round(shared / GOAL * 100)}%"></div></div>
           <div class="feedback good show" style="display:block" id="giveFb">Other kids are sharing too... \u{1F49B}</div>
         </div>`,
        `<button class="btn" id="giveFin" disabled>Watch the garden grow...</button>`
      );
      const fill = ctx.ovBody.querySelector('.goal-fill');
      const count = ctx.ovBody.querySelector('.goal-count');
      const fb = ctx.ovBody.querySelector('#giveFb');
      const fin = ctx.ovActions.querySelector('#giveFin');
      const finishFill = () => {
        fill.style.width = '100%';
        count.textContent = `${GOAL} / ${GOAL}`;
        fb.innerHTML = 'The garden is planted! \u{1F333}\u{1F33B} A little from <b>many</b> people added up to a LOT. Sharing helps others, and it feels good too! \u{1F49B}';
        fin.disabled = false; fin.textContent = 'Finish Lesson ⭐';
      };
      if (ctx.reduceMotion) finishFill();
      else setTimeout(finishFill, 700); // let the bar animate the rest of the way up
      fin.onclick = () => ctx.finish("You shared to help others! A little garden is blooming in Webo's world. \u{1F33B}");
    };

    // Step 1: the child shares a few of their own coins toward the community goal.
    const share = () => {
      ctx.renderStep(
        `<div class="lesson-intro">${ctx.speech("Sharing a little helps a lot! \u{1F49B} Our town wants to plant a <b>community garden</b> \u{1F333}. It needs <b>20 coins</b>. You have some coins, so tap to <b>share</b> a few and help out!")}</div>
         <div class="lesson-stage">
           <div class="goal-top">\u{1F333} <span class="goal-count">0 / ${GOAL}</span></div>
           <div class="goal-bar"><div class="goal-fill" style="width:0"></div></div>
           <div class="goal-week">Your coins: <b id="giveMine">${myCoins}</b> \u{1FA99}</div>
           <div class="goal-choices"><button class="choice" id="giveShare">\u{1F49B} Share a coin</button></div>
           <div class="feedback" id="giveFb"></div>
         </div>`,
        `<button class="btn" id="giveNext" disabled>Share at least one coin</button>`
      );
      const body = ctx.ovBody;
      const fill = body.querySelector('.goal-fill');
      const count = body.querySelector('.goal-count');
      const mine = body.querySelector('#giveMine');
      const fb = body.querySelector('#giveFb');
      const shareBtn = body.querySelector('#giveShare');
      const next = ctx.ovActions.querySelector('#giveNext');
      shareBtn.onclick = () => {
        if (myCoins <= 0) return;
        myCoins--; shared++;
        mine.textContent = myCoins;
        count.textContent = `${shared} / ${GOAL}`;
        fill.style.width = Math.round(shared / GOAL * 100) + '%';
        fb.innerHTML = 'Thank you for sharing! \u{1F49B} That helps the garden grow.';
        fb.className = 'feedback good show';
        next.disabled = false; next.textContent = 'Done sharing →';
        if (myCoins === 0) { shareBtn.disabled = true; shareBtn.textContent = 'All shared! \u{1F49B}'; }
      };
      next.onclick = () => bloom();
    };

    share();
  },
};
