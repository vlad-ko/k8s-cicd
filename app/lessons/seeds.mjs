// LESSON 3: Planting Seeds - why we spread money around (diversification).
export default {
  id: 'seeds',
  no: 'LESSON 3',
  name: 'Planting Seeds',
  sub: 'Why we spread money around',
  icon: '\u{1F331}',
  rewardTitle: 'You did it!',
  prop: {
    cls: 'prop-rocket',
    img: '/assets/props/seeds.png',
    size: '46px',
    html: `<svg viewBox="0 0 40 64">
          <path d="M20 2 C30 12 30 30 28 44 L12 44 C10 30 10 12 20 2Z" fill="#f5e6c8"/>
          <circle cx="20" cy="22" r="6" fill="#14263f" stroke="#4fd1c5" stroke-width="2"/>
          <path d="M12 40 L4 52 L12 48Z" fill="#e08e0b"/>
          <path d="M28 40 L36 52 L28 48Z" fill="#e08e0b"/>
          <g class="flame"><path d="M14 46 L20 62 L26 46Z" fill="#ffb938"/><path d="M16 46 L20 56 L24 46Z" fill="#ff7b6b"/></g>
        </svg>`,
  },
  run(ctx) {
    ctx.renderStep(`
      <div class="lesson-intro">${ctx.speech("Time to plant! \u{1F331} You have <b>6 seeds</b>. Tap each patch to plant one. Here is the secret: some seeds grow big, some grow slow, and some... will not grow at all. Nobody knows which! So what should we do?")}</div>
      <div class="lesson-stage">
        <div class="seed-field" id="seedField"></div>
      </div>
      <div class="feedback info show" style="display:block" id="seedFb">Plant all 6 seeds and see what happens! \u{1F33E}</div>
    `, `<button class="btn" id="seedDone" disabled>Plant all 6 seeds</button>`);
    const root = ctx.ovBody;
    const field = root.querySelector('#seedField');
    const outcomes = ctx.shuffle(['grown', 'grown', 'slow', 'grown', 'failed', 'slow']);
    let planted = 0;
    const fb = root.querySelector('#seedFb'), btn = ctx.ovActions.querySelector('#seedDone');
    for (let i = 0; i < 6; i++) {
      const s = document.createElement('div'); s.className = 'seed'; s.textContent = '\u{1F7EB}';
      s.onclick = () => {
        if (s.classList.contains('planted')) return;
        s.classList.add('planted');
        const o = outcomes[i];
        setTimeout(() => {
          if (o === 'grown') { s.classList.add('grown'); s.textContent = '\u{1F333}'; }
          else if (o === 'slow') { s.classList.add('slow'); s.textContent = '\u{1F331}'; }
          else { s.classList.add('failed'); s.textContent = '\u{1F342}'; }
        }, 250);
        planted++;
        if (planted === 6) {
          btn.disabled = false; btn.textContent = 'See what Webo learned →';
          fb.innerHTML = 'Look! Some grew into big trees \u{1F333}, some are still growing \u{1F331}, and one did not make it \u{1F342}.';
          fb.className = 'feedback good show';
        }
      };
      field.appendChild(s);
    }
    btn.onclick = () => {
      ctx.renderStep(
        `<div class="lesson-intro">${ctx.speech("Here is the big idea: because we planted <b>lots of different seeds</b>, it did not matter that one failed. The others still grew! \u{1F333}<br><br>Smart money helpers call this <b>not putting all your eggs in one basket</b>. Spreading out keeps you safe. You are a natural! \u{1F31F}")}</div>`,
        `<button class="btn" id="finSeed">Finish Lesson ⭐</button>`
      );
      ctx.ovActions.querySelector('#finSeed').onclick = () => ctx.finish("You learned to spread things out! Webo's rocket is fueled and ready. \u{1F680}");
    };
  },
};
