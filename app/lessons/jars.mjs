// LESSON 1: The Three Jars - earning, spending & saving.
export default {
  id: 'jars',
  no: 'LESSON 1',
  name: 'The Three Jars',
  sub: 'Earning, spending & saving',
  icon: '\u{1FAD9}',
  rewardTitle: 'Three Jars done!',
  prop: {
    cls: 'prop-jars',
    img: '/assets/props/jars.png',
    size: '78px',
    html: '<span class="jar spend"></span><span class="jar save"></span><span class="jar grow"></span>',
  },
  run(ctx) {
    let coins = 6;
    const jars = { spend: 0, save: 0, grow: 0 };
    ctx.renderStep(`
      <div class="lesson-intro">${ctx.speech("You earned <b>6 gold coins</b> for helping out! \u{1FA99} Now, where should they go? Tap a jar to drop a coin in!")}</div>
      <div class="lesson-stage">
        <div class="coins-left">Coins left: <b id="coinsLeft">6</b></div>
        <div class="jar-game">
          <div class="jar-col spend" data-j="spend"><div class="jar-vessel"><span class="jar-rim"></span><div class="jar-big"><div class="jar-fill"></div><span class="jar-shine"></span></div></div><div class="jar-label">SPEND</div><div class="jar-amt" id="amt-spend">0 coins</div></div>
          <div class="jar-col save" data-j="save"><div class="jar-vessel"><span class="jar-rim"></span><div class="jar-big"><div class="jar-fill"></div><span class="jar-shine"></span></div></div><div class="jar-label">SAVE</div><div class="jar-amt" id="amt-save">0 coins</div></div>
          <div class="jar-col grow" data-j="grow"><div class="jar-vessel"><span class="jar-rim"></span><div class="jar-big"><div class="jar-fill"></div><span class="jar-shine"></span></div></div><div class="jar-label">GROW</div><div class="jar-amt" id="amt-grow">0 coins</div></div>
        </div>
      </div>
      <div class="feedback info show" style="display:block">\u{1F4A1} <b>Spend</b> is for fun stuff now. <b>Save</b> is for something bigger soon. <b>Grow</b> is money that makes MORE money later!</div>
    `, `<button class="btn" id="jarDone" disabled>Drop all your coins first</button>`);

    const body = ctx.ovBody;
    const cl = body.querySelector('#coinsLeft');
    const btn = ctx.ovActions.querySelector('#jarDone');
    const reduce = ctx.reduceMotion;

    // A coin glyph drops into the jar and lands as the fill bounces up. Skipped
    // (with the fill still updating) when the user prefers reduced motion.
    const dropCoin = (jarBig) => {
      if (reduce) return;
      const coin = document.createElement('span');
      coin.className = 'coin-drop';
      coin.textContent = '\u{1FA99}';
      jarBig.appendChild(coin);
      coin.animate([
        { transform: 'translateX(-50%) translateY(-12px) scale(.6)', opacity: 0 },
        { transform: 'translateX(-50%) translateY(4px) scale(1)', opacity: 1, offset: .35 },
        { transform: 'translateX(-50%) translateY(74px) scale(.9)', opacity: 1, offset: .9 },
        { transform: 'translateX(-50%) translateY(84px) scale(.5)', opacity: 0 },
      ], { duration: 480, easing: 'cubic-bezier(.5,0,.75,1)' }).onfinish = () => coin.remove();
    };

    body.querySelectorAll('.jar-col').forEach((col) => {
      const jarBig = col.querySelector('.jar-big');
      jarBig.onclick = () => {
        if (coins <= 0) return;
        const j = col.dataset.j; jars[j]++; coins--;
        cl.textContent = coins;
        col.querySelector('.jar-fill').style.height = Math.min(jars[j] * 16, 100) + '%';
        body.querySelector('#amt-' + j).textContent = jars[j] + (jars[j] === 1 ? ' coin' : ' coins');
        dropCoin(jarBig);
        if (!reduce) jarBig.animate(
          [{ transform: 'scale(1)' }, { transform: 'scale(1.05)' }, { transform: 'scale(1)' }],
          { duration: 220, easing: 'ease-out' }
        );
        if (coins === 0) { btn.disabled = false; btn.textContent = 'See what Webo thinks →'; }
      };
    });
    btn.onclick = () => {
      let msg;
      if (jars.grow >= 1 && jars.save >= 1 && jars.spend >= 1)
        msg = "Wow, you used <b>all three jars</b>! That is exactly how smart money helpers do it. A little fun, a little saved, and some set aside to grow. \u{1F31F}";
      else if (jars.spend === 6)
        msg = "Ooh, you spent it all on fun! That is okay sometimes, but if you <b>save</b> and <b>grow</b> a little too, you will have even more later. Let us remember that! \u{1F49B}";
      else
        msg = "Nice choices! The big secret is that the <b>Grow</b> jar is magic. Keep some coins there and they turn into MORE coins over time. You will see how in the next lesson! ✨";
      ctx.renderStep(`<div class="lesson-intro">${ctx.speech(msg)}</div>`, `<button class="btn" id="finJar">Finish Lesson ⭐</button>`);
      ctx.ovActions.querySelector('#finJar').onclick = () => ctx.finish("You learned the 3 Jars! Webo's world just got its first jars. \u{1FAD9}");
    };
  },
};
