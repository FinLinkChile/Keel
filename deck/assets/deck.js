/* Keel deck: builds the slides from window.KEEL_TEXT (content-en.js or content-es.js) and
   animates them with anime.js v4 (global `anime`). Keys: arrows / space / click to move,
   N notes, T rehearsal timer, F full screen, Home and End. */
(() => {
  const { createTimeline, animate, stagger, svg, utils } = anime;
  const T = window.KEEL_TEXT;

  // Phone screens are captures of the app at 390 px wide, drawn 360 px wide.
  const K = 360 / 390;
  const px = (v) => `${Math.round(v * K)}px`;

  const ICON = {
    key: '<path d="M15 7a4 4 0 1 1-3.9 4.9L4 19v-3h3v-3h3l1.1-1.1A4 4 0 0 1 15 7z"/><circle cx="16" cy="9" r="1"/>',
    bot: '<rect x="4" y="8" width="16" height="11" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01M9 16h6"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    doc: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M10 12h5M10 16h5"/>',
    ship: '<path d="M3 15l2 5h14l2-5H3zM6 15V9h12v6M12 4v5"/>',
    check: '<path d="M5 12l5 5 9-10"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    pen: '<path d="M4 20l4-1 11-11-3-3L5 16z"/>',
    scale: '<path d="M12 4v16M6 8h12M6 8l-3 6h6zM18 8l-3 6h6z"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
    bank: '<path d="M3 10l9-6 9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    shield: '<path d="M12 3 4.5 6v6c0 4.5 3.2 7.6 7.5 9 4.3-1.4 7.5-4.5 7.5-9V6z"/><path d="M9 12l2 2 4-4"/>',
    flask: '<path d="M9 3h6M10 3v6L4.5 18.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3"/><path d="M7 15h10"/>',
  };
  const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[name]}</svg>`;

  const logo = () => `
    <span class="logo">
      <svg class="tile" viewBox="0 0 28 30"><path class="tile-shape" d="M7 0h21l-7 30H0z" fill="#A8B4FF"/>
        <text class="tile-k" x="17.6" y="25" text-anchor="middle" font-family="Figtree" font-weight="800" font-size="26" fill="#000" stroke="#000" stroke-width="1.2" stroke-linejoin="round" transform="skewX(-13)">K</text></svg>
      <span class="eel"><span>e</span><span>e</span><span>l</span></span>
    </span>`;

  const tile = () => `<svg viewBox="0 0 28 30" aria-hidden="true"><path d="M7 0h21l-7 30H0z" fill="#A8B4FF"/>
    <text x="17.6" y="25" text-anchor="middle" font-family="Figtree" font-weight="800" font-size="26" fill="#000" stroke="#000" stroke-width="1.2" stroke-linejoin="round" transform="skewX(-13)">K</text></svg>`;

  const odometer = (value) => `<span class="odo" aria-label="${value}">${String(value).split('').map((ch) => {
    const d = Number(ch);
    const seq = d === 0 ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0] : Array.from({ length: d + 1 }, (_, i) => i);
    return `<span class="odo-cell"><span class="odo-strip" data-n="${seq.length}">${seq.map((x) => `<span>${x}</span>`).join('')}</span></span>`;
  }).join('')}</span>`;

  // screens: [{ src, hl: [{ id, x, y, w, h, cls }], taps: [{ id, x, y }] }]
  const phone = (screens, label = '') => `
    <div class="phone a-phone">
      <div class="notch"></div>
      <div class="screen">
        ${screens.map((s, i) => `
          <div class="layer" data-i="${i}" style="position:absolute;left:0;top:0;width:360px;opacity:${i === 0 ? 1 : 0}">
            <img class="scr on" src="assets/screens/${s.src}" alt="">
            ${(s.hl || []).map((h) => `<div class="hl ${h.cls || ''}" data-hl="${h.id}" style="left:${px(h.x)};top:${px(h.y)};width:${px(h.w)};height:${px(h.h)}"></div>`).join('')}
            ${(s.taps || []).map((t) => `<div class="tap" data-tap="${t.id}" style="left:${px(t.x)};top:${px(t.y)}"></div>`).join('')}
          </div>`).join('')}
      </div>
    </div>
    ${label ? `<div class="phone-label">${label}</div>` : ''}`;

  const tracker = (now) => `
    <div class="tracker a-up">
      ${T.flowSteps.map((s, i) => `<div class="st ${i < now ? 'done' : i === now ? 'now' : ''}"><i>${i < now ? icon('check').replace('<svg', '<svg width="20" height="20"') : i + 1}</i>${s}</div>`).join('')}
    </div>`;

  const bullets = (items) => `<div class="bullets">${items.map((b) => `<div class="b a-up"><span class="ico">${icon(b.icon)}</span><span>${b.text}</span></div>`).join('')}</div>`;

  // Helpers used by the animations
  const $ = (root, sel) => root.querySelector(sel);
  const $$ = (root, sel) => [...root.querySelectorAll(sel)];
  const layer = (root, i) => $(root, `.layer[data-i="${i}"]`);
  const scrollTo = (tl, root, i, appY, at, duration = 1600) => tl.add(layer(root, i), { y: -appY * K, duration, ease: 'inOutCubic' }, at);
  const swap = (tl, root, from, to, at) => {
    tl.add(layer(root, from), { opacity: 0, duration: 450, ease: 'outQuad' }, at);
    tl.add(layer(root, to), { opacity: [0, 1], scale: [0.97, 1], duration: 600, ease: 'outQuad' }, at + 150);
  };
  const glow = (tl, root, id, at) => tl.add($(root, `[data-hl="${id}"]`), { opacity: [0, 1], scale: [1.08, 1], duration: 700, ease: 'outBack' }, at);
  const tap = (tl, root, id, at) => tl.add($(root, `[data-tap="${id}"]`), { opacity: [0.9, 0], scale: [0.5, 1.6], duration: 700, ease: 'outQuad' }, at);
  const intro = (tl, root, at = 0) => {
    tl.add($$(root, '.a-up'), { opacity: [0, 1], y: [36, 0], duration: 800, delay: stagger(110), ease: 'outExpo' }, at);
    const ph = $(root, '.a-phone');
    if (ph) tl.add(ph, { opacity: [0, 1], x: [120, 0], rotate: [4, 0], duration: 1100, ease: 'outExpo' }, at + 150);
  };

  // ---------------------------------------------------------------- slides
  const SLIDES = [
    {
      id: 'title',
      html: (t) => `
        <div class="s-title" style="height:100%">
          <div class="a-logo">${logo()}</div>
          <div class="tag a-up">${t.tag}</div>
          <div class="lead a-up" style="max-width:1200px">${t.sub}</div>
          <div class="meta a-up">${t.chips.map((c) => `<span class="chip"><span class="dot"></span>${c}</span>`).join('')}</div>
        </div>`,
      enter: (root, tl) => {
        tl.add($(root, '.tile'), { opacity: [0, 1], x: [-200, 0], skewX: [-20, 0], duration: 900, ease: 'outExpo' }, 0);
        tl.add($$(root, '.eel span'), { opacity: [0, 1], y: [80, 0], duration: 800, delay: stagger(90), ease: 'outBack' }, 250);
        tl.add($(root, '.tile-k'), { opacity: [0, 1], duration: 500 }, 500);
        tl.add($$(root, '.a-up'), { opacity: [0, 1], y: [40, 0], duration: 900, delay: stagger(160), ease: 'outExpo' }, 800);
      },
    },
    {
      id: 'problem',
      html: (t) => `
        <div style="display:grid;grid-template-columns:1000px 1fr;gap:80px;height:100%">
          <div>
            <div class="kicker a-up">${t.kicker}</div>
            <div class="h2 a-up" style="font-size:56px">${t.title}</div>
            <div class="route">
              <svg class="path" viewBox="0 0 1000 230"><path class="route-line" d="M180 95 C 380 -10, 620 -10, 820 95" fill="none" stroke="#5A5A60" stroke-width="4" stroke-dasharray="2 14" stroke-linecap="round"/></svg>
              <div class="party a-party" style="left:30px"><div class="av" style="background:#C8D99A">AT</div><div class="nm">${t.importer}</div><div class="pl">${t.importerPlace}</div></div>
              <div class="party a-party" style="left:670px"><div class="av" style="background:#F4B183">LE</div><div class="nm">${t.exporter}</div><div class="pl">${t.exporterPlace}</div></div>
              <div class="coin a-coin" style="left:150px;top:20px">USD 87,000</div>
            </div>
            <div class="question a-q">${t.question}</div>
            <div class="dilemma">
              <div class="card a-dil"><b>${t.payFirst}</b>${t.payFirstRisk}</div>
              <div class="card a-dil"><b>${t.payLater}</b>${t.payLaterRisk}</div>
            </div>
          </div>
          <div style="position:relative;display:flex;flex-direction:column;justify-content:center;gap:40px">
            <div style="position:relative">
              <div class="mail a-mail">
                <div class="from">${t.mailFrom}</div>
                <div class="subj">${t.mailSubject}</div>
                <div>${t.mailBody}</div>
                <div class="acct">${t.mailAccount}</div>
              </div>
              <div class="fraud-stamp a-stamp" style="right:-10px;bottom:-110px">${t.stamp}</div>
            </div>
            <div class="pains" style="flex-direction:column;align-items:flex-start;margin-top:110px">${t.pains.map((p) => `<span class="chip a-pain"><span class="dot" style="background:#FF6A5C"></span>${p}</span>`).join('')}</div>
          </div>
        </div>`,
      enter: (root, tl) => {
        intro(tl, root);
        tl.add($$(root, '.a-party'), { opacity: [0, 1], scale: [0.6, 1], duration: 700, delay: stagger(150), ease: 'outBack' }, 300);
        const line = svg.createDrawable($(root, '.route-line'));
        tl.add(line, { draw: ['0 0', '0 1'], duration: 1000, ease: 'inOutQuad' }, 600);
        tl.add($(root, '.a-coin'), { opacity: [0, 1], duration: 300 }, 900);
        tl.add($(root, '.a-coin'), { x: [0, 260], duration: 1300, ease: 'inOutSine' }, 900);
        tl.add($(root, '.a-coin'), { x: [260, 0], duration: 1300, ease: 'inOutSine' }, 2300);
        tl.add($(root, '.a-coin'), { x: [0, 130], duration: 700, ease: 'outSine' }, 3700);
        tl.add($(root, '.a-q'), { opacity: [0, 1], y: [30, 0], duration: 800, ease: 'outExpo' }, 1800);
        tl.add($$(root, '.a-dil'), { opacity: [0, 1], y: [30, 0], duration: 700, delay: stagger(160), ease: 'outExpo' }, 2500);
        tl.add($(root, '.a-mail'), { opacity: [0, 1], y: [120, 0], rotate: [6, -2], duration: 1100, ease: 'outBack' }, 3600);
        tl.add($(root, '.a-stamp'), { opacity: [0, 1], scale: [2.4, 1], duration: 500, ease: 'outBack' }, 4700);
        tl.add($$(root, '.a-pain'), { opacity: [0, 1], x: [-30, 0], duration: 600, delay: stagger(140), ease: 'outExpo' }, 5300);
      },
    },
    {
      id: 'meet',
      html: (t) => `
        <div class="split">
          <div class="copy">
            <div class="kicker a-up">${t.kicker}</div>
            <div class="a-up" style="font-size:140px">${logo()}</div>
            <div class="h2 a-up" style="margin-top:40px">${t.title}</div>
            ${bullets(t.bullets)}
          </div>
          <div class="phone-col">${phone([{ src: 'connect.png' }, { src: 'home-importer.png', hl: [{ id: 'agent', x: 20, y: 280, w: 350, h: 50 }, { id: 'locked', x: 20, y: 232, w: 350, h: 48 }] }], t.phoneLabel)}</div>
        </div>`,
      enter: (root, tl) => {
        intro(tl, root);
        swap(tl, root, 0, 1, 3000);
        glow(tl, root, 'locked', 3900);
        glow(tl, root, 'agent', 4500);
      },
    },
    {
      id: 'sign',
      html: (t) => `
        <div class="split">
          <div class="copy">
            ${tracker(0)}
            <div class="h2 a-up">${t.title}</div>
            <div class="lead a-up">${t.lead}</div>
            ${bullets(t.bullets)}
          </div>
          <div class="phone-col">${phone([{ src: 'sign-order.png', hl: [{ id: 'step', x: 12, y: 520, w: 366, h: 68, cls: 'turn' }, { id: 'acct', x: 18, y: 838, w: 354, h: 318 }] }], t.phoneLabel)}</div>
        </div>`,
      enter: (root, tl) => {
        intro(tl, root);
        glow(tl, root, 'step', 1500);
        scrollTo(tl, root, 0, 330, 2700);
        glow(tl, root, 'acct', 4300);
      },
    },
    {
      id: 'lock',
      html: (t) => `
        <div class="split">
          <div class="copy">
            ${tracker(1)}
            <div class="h2 a-up">${t.title}</div>
            <div class="lead a-up">${t.lead}</div>
            <div class="vscene a-up">
              <div class="vparty v-imp"><div class="av" style="background:#C8D99A">AT</div><b>${t.importer}</b><span class="vnum v-imp-amt">87,000</span></div>
              <div class="vault">
                <svg viewBox="0 0 200 190" aria-hidden="true"><path class="shackle" d="M70 58V38a30 30 0 0 1 60 0v20"/><rect class="vbody" x="16" y="54" width="168" height="132" rx="20"/>
                  <text class="vlabel" x="100" y="78">ESCROW</text><circle class="vdoor" cx="100" cy="132" r="40"/>
                  <g class="dial"><circle cx="100" cy="132" r="7"/><path d="M100 100v14M100 150v14M68 132h14M118 132h14M77 109l10 10M113 145l10 10M77 155l10-10M113 119l10-10"/></g></svg>
                <span class="vnum v-esc">0</span><span class="vpend">${t.pending}</span><span class="vchip">${icon('lock').replace('<svg', '<svg width="20" height="20"')} ${t.locked}</span>
              </div>
              <div class="vparty v-exp"><div class="av" style="background:#F4B183">LE</div><b>${t.exporter}</b><span class="vnum v-exp-amt">0</span><span class="vsub">${t.paid}</span></div>
              ${Array.from({ length: 8 }, () => '<i class="vcoin c-dep" style="left:93px;top:120px">$</i>').join('')}
              ${Array.from({ length: 5 }, () => '<i class="vcoin c-adv" style="left:483px;top:140px">$</i>').join('')}
            </div>
            <div class="a-leg" style="font-size:26px;color:var(--muted);margin-top:18px;max-width:900px">${t.note}</div>
          </div>
          <div class="phone-col">${phone([{ src: 'home-importer.png', taps: [{ id: 'lockedrow', x: 300, y: 255 }] }, { src: 'order-advance-paid.png', hl: [{ id: 'ring', x: 70, y: 186, w: 250, h: 250, cls: 'round' }, { id: 'rows', x: 12, y: 452, w: 366, h: 98, cls: 'money' }, { id: 'adv', x: 12, y: 700, w: 366, h: 64, cls: 'money' }] }], t.phoneLabel)}</div>
        </div>`,
      enter: (root, tl) => {
        intro(tl, root);
        const num = (sel, from, to, at, dur) => {
          const el = $(root, sel); const o = { v: from };
          tl.add(o, { v: [from, to], duration: dur, ease: 'outQuad', onUpdate: () => { el.textContent = Math.round(o.v).toLocaleString('en-US'); } }, at);
        };
        const fly = (cls, dx, dy, at, dur = 900, gap = 110, arc = -60) => {
          tl.add($$(root, cls), { opacity: [0, 1], duration: 150, delay: stagger(gap) }, at);
          tl.add($$(root, cls), { x: [0, dx], duration: dur, delay: stagger(gap), ease: 'inOutQuad' }, at);
          tl.add($$(root, cls), { y: [{ from: 0, to: dy / 2 + arc, duration: dur / 2, ease: 'outQuad' }, { to: dy, duration: dur / 2, ease: 'inQuad' }], delay: stagger(gap) }, at);
          tl.add($$(root, cls), { opacity: [1, 0], duration: 150, delay: stagger(gap) }, at + dur - 150);
        };
        tl.add($$(root, '.vparty, .vault'), { opacity: [0, 1], y: [30, 0], duration: 700, delay: stagger(150), ease: 'outExpo' }, 700);
        fly('.c-dep', 390, 20, 1300);
        num('.v-imp-amt', 87000, 0, 1300, 1700);
        num('.v-esc', 0, 87000, 1400, 1700);
        tl.add($(root, '.dial'), { rotate: [0, -180], duration: 700, ease: 'inOutCubic' }, 3100);
        utils.set($(root, '.shackle'), { translateY: -16 });
        tl.add($(root, '.shackle'), { translateY: [-16, 0], duration: 600, ease: 'outBounce' }, 3300);
        tl.add($(root, '.vchip'), { opacity: [0, 1], y: [10, 0], duration: 500 }, 3500);
        fly('.c-adv', 390, -20, 4000, 1000, 120, -70);
        num('.v-esc', 87000, 43500, 4100, 1200);
        num('.v-exp-amt', 0, 43500, 4400, 1300);
        tl.add($(root, '.vsub'), { opacity: [0, 1], duration: 400 }, 4600);
        tl.add($(root, '.vpend'), { opacity: [0, 1], y: [8, 0], duration: 500 }, 5300);
        tl.add($(root, '.v-esc'), { scale: [{ from: 1, to: 1.12, duration: 200 }, { to: 1, duration: 300 }] }, 5300);
        tl.add($(root, '.v-exp'), { scale: [{ from: 1, to: 1.06, duration: 200 }, { to: 1, duration: 300 }] }, 5600);
        tl.add($$(root, '.a-leg'), { opacity: [0, 1], duration: 600 }, 5800);
        tap(tl, root, 'lockedrow', 2400);
        swap(tl, root, 0, 1, 2800);
        glow(tl, root, 'ring', 3600);
        glow(tl, root, 'rows', 5000);
        scrollTo(tl, root, 1, 360, 6200);
        glow(tl, root, 'adv', 7600);
      },
    },
    {
      id: 'prove',
      html: (t) => `
        <div class="split">
          <div class="copy">
            ${tracker(2)}
            <div class="h2 a-up">${t.title}</div>
            <div class="flow">
              ${t.nodes.map((n, i) => `<div class="row a-node"><div class="node"><span class="sweep"></span><span class="n">${icon(n.icon)}</span><div>${n.title}<small>${n.sub}</small></div><span class="okc">${icon('check')}</span></div></div>`).join('')}
              <div class="kscan">${tile()}</div>
            </div>
            <div class="rscene a-release">
              <div class="vault">
                <svg viewBox="0 0 200 190" aria-hidden="true"><path class="shackle" d="M70 58V38a30 30 0 0 1 60 0v20"/><rect class="vbody" x="16" y="54" width="168" height="132" rx="20"/>
                  <text class="vlabel" x="100" y="78">ESCROW</text><circle class="vdoor" cx="100" cy="132" r="40"/>
                  <g class="dial"><circle cx="100" cy="132" r="7"/><path d="M100 100v14M100 150v14M68 132h14M118 132h14M77 109l10 10M113 145l10 10M77 155l10-10M113 119l10-10"/></g></svg>
                <div class="rv"><span class="vnum r-esc">43,500</span><span class="vpend r-pend">${t.pending}</span></div>
              </div>
              <div class="rparty"><div class="av" style="background:#F4B183">LE</div><div><b>${t.exporter}</b><span class="vnum r-exp">43,500</span><span class="vsub r-sub">${t.received}</span></div></div>
              ${Array.from({ length: 6 }, () => '<i class="vcoin c-rel" style="left:53px;top:70px">$</i>').join('')}
            </div>
          </div>
          <div class="phone-col">${phone([{ src: 'home-exporter.png', taps: [{ id: 'up', x: 300, y: 555 }] }, { src: 'exporter-upload.png', hl: [{ id: 'turn', x: 18, y: 415, w: 354, h: 316, cls: 'turn' }], taps: [{ id: 'bl', x: 311, y: 623 }, { id: 'inv', x: 311, y: 680 }] }, { src: 'order-settled.png', hl: [{ id: 'bal', x: 12, y: 714, w: 366, h: 112, cls: 'money' }] }], t.phoneLabel)}</div>
        </div>`,
      enter: (root, tl) => {
        intro(tl, root);
        tl.add($$(root, '.a-node'), { opacity: [0, 1], x: [-40, 0], duration: 700, delay: stagger(700), ease: 'outExpo' }, 1200);
        tap(tl, root, 'up', 1600);
        swap(tl, root, 0, 1, 2000);
        glow(tl, root, 'turn', 2700);
        tap(tl, root, 'bl', 3600);
        tap(tl, root, 'inv', 4200);
        const nodes = $$(root, '.a-node .node');
        const k = $(root, '.kscan');
        const yOf = (n) => n.parentElement.offsetTop + n.offsetHeight / 2 - 32;
        tl.add(k, { opacity: [0, 1], scale: [0.4, 1], y: [yOf(nodes[0]), yOf(nodes[0])], duration: 400, ease: 'outBack' }, 4500);
        nodes.forEach((n, i) => {
          const at = 4800 + i * 750;
          if (i > 0) tl.add(k, { y: yOf(n), duration: 380, ease: 'inOutCubic' }, at - 380);
          tl.add(k, { rotate: [{ from: 0, to: -12, duration: 120 }, { to: 8, duration: 140 }, { to: 0, duration: 140 }], scale: [{ from: 1, to: 1.18, duration: 200 }, { to: 1, duration: 200 }] }, at);
          tl.add(n.querySelector('.sweep'), { opacity: [{ from: 0, to: 1, duration: 180 }, { to: 0, duration: 340 }], translateX: { from: '0%', to: '520%', duration: 520, ease: 'inOutSine' } }, at + 60);
          tl.add(n, { boxShadow: ['inset 0 0 0 0px rgba(93,211,166,0)', 'inset 0 0 0 2px rgba(93,211,166,0.6)'], duration: 350 }, at + 420);
          tl.add(n.querySelector('.okc'), { opacity: [0, 1], scale: [0.3, 1], duration: 450, ease: 'outBack' }, at + 420);
        });
        tl.add(k, { opacity: 0, scale: 0.6, duration: 400 }, 7200);
        swap(tl, root, 1, 2, 5600);
        scrollTo(tl, root, 2, 420, 6300, 1400);
        glow(tl, root, 'bal', 7600);
        // The checks pass: the escrow opens and pays the balance to the exporter
        const num = (sel, from, to, at, dur) => {
          const el = $(root, sel); const o = { v: from };
          tl.add(o, { v: [from, to], duration: dur, ease: 'outQuad', onUpdate: () => { el.textContent = Math.round(o.v).toLocaleString('en-US'); } }, at);
        };
        tl.add($(root, '.a-release'), { opacity: [0, 1], y: [20, 0], duration: 600, ease: 'outExpo' }, 7000);
        tl.add($$(root, '.rscene .vault, .rscene .rparty'), { opacity: [0, 1], scale: [0.9, 1], duration: 600, delay: stagger(150), ease: 'outBack' }, 7000);
        tl.add($(root, '.r-pend'), { opacity: [0, 1], duration: 300 }, 7100);
        tl.add($(root, '.rscene .dial'), { rotate: [0, 180], duration: 600, ease: 'inOutCubic' }, 7500);
        tl.add($(root, '.rscene .shackle'), { translateY: [0, -16], duration: 500, ease: 'outQuad' }, 8000);
        tl.add($(root, '.r-pend'), { opacity: [1, 0], duration: 300 }, 8100);
        tl.add($$(root, '.c-rel'), { opacity: [0, 1], duration: 150, delay: stagger(110) }, 8300);
        tl.add($$(root, '.c-rel'), { x: [0, 540], duration: 900, delay: stagger(110), ease: 'inOutQuad' }, 8300);
        tl.add($$(root, '.c-rel'), { y: [{ from: 0, to: -60, duration: 450, ease: 'outQuad' }, { to: 0, duration: 450, ease: 'inQuad' }], delay: stagger(110) }, 8300);
        tl.add($$(root, '.c-rel'), { opacity: [1, 0], duration: 150, delay: stagger(110) }, 9050);
        num('.r-esc', 43500, 0, 8300, 1500);
        num('.r-exp', 43500, 87000, 8500, 1500);
        tl.add($(root, '.r-sub'), { opacity: [0, 1], duration: 400 }, 9500);
        tl.add($(root, '.rparty'), { scale: [{ from: 1, to: 1.05, duration: 200 }, { to: 1, duration: 300 }] }, 9900);
      },
    },
    {
      id: 'refund',
      html: (t) => `
        <div class="split">
          <div class="copy">
            ${tracker(3)}
            <div class="h2 a-up">${t.title}</div>
            <div class="lead a-up">${t.lead}</div>
            <div class="vscene a-up" style="margin-top:56px">
              <div class="vparty v-imp"><div class="av" style="background:#C8D99A">AT</div><b>${t.importer}</b><span class="vnum v-imp-amt">0</span><span class="vsub v-imp-sub">${t.back}</span></div>
              <div class="vault">
                <div class="vdue"><span class="vdue-ico">${icon('clock').replace('<svg', '<svg width="20" height="20"')}</span><span class="vdue-txt">${t.deadline}</span></div>
                <svg viewBox="0 0 200 190" aria-hidden="true"><path class="shackle" d="M70 58V38a30 30 0 0 1 60 0v20"/><rect class="vbody" x="16" y="54" width="168" height="132" rx="20"/>
                  <text class="vlabel" x="100" y="78">ESCROW</text><circle class="vdoor" cx="100" cy="132" r="40"/>
                  <g class="dial"><circle cx="100" cy="132" r="7"/><path d="M100 100v14M100 150v14M68 132h14M118 132h14M77 109l10 10M113 145l10 10M77 155l10-10M113 119l10-10"/></g></svg>
                <span class="vnum v-esc">43,500</span><span class="vpend">${t.pending}</span>
              </div>
              <div class="vparty v-exp"><div class="av" style="background:#F4B183">LE</div><b>${t.exporter}</b><span class="vnum v-exp-amt">43,500</span><span class="vsub">${t.kept}</span></div>
              <div class="vstamp-wrap"><div class="vstamp">${t.stamp}</div></div>
              ${Array.from({ length: 6 }, () => '<i class="vcoin c-back" style="left:483px;top:150px">$</i>').join('')}
            </div>
          </div>
          <div class="phone-col">${phone([{ src: 'order-refunded.png', hl: [{ id: 'ref', x: 12, y: 758, w: 366, h: 116, cls: 'money' }, { id: 'back', x: 12, y: 452, w: 366, h: 98, cls: 'money' }] }], t.phoneLabel)}</div>
        </div>`,
      enter: (root, tl) => {
        intro(tl, root);
        const num = (sel, from, to, at, dur) => {
          const el = $(root, sel); const o = { v: from };
          tl.add(o, { v: [from, to], duration: dur, ease: 'outQuad', onUpdate: () => { el.textContent = Math.round(o.v).toLocaleString('en-US'); } }, at);
        };
        tl.add($$(root, '.vparty, .vault'), { opacity: [0, 1], y: [30, 0], duration: 700, delay: stagger(150), ease: 'outExpo' }, 600);
        tl.add($$(root, '.vpend, .v-exp .vsub'), { opacity: [0, 1], duration: 400 }, 1000);
        // The ship-by date runs out
        const t = T.slides.refund;
        const due = $(root, '.vdue-txt'); const days = { d: 3 };
        tl.add(days, { d: [3, 0], duration: 1500, ease: 'linear', onUpdate: () => { due.textContent = `${Math.ceil(days.d)} ${t.daysLeft}`; } }, 1300);
        tl.add($(root, '.vdue-ico'), { rotate: [0, 720], duration: 1500, ease: 'inOutSine' }, 1300);
        tl.add($(root, '.vdue'), { backgroundColor: ['rgba(42,21,19,0)', 'rgba(42,21,19,1)'], color: ['#A1A1A8', '#FF6A5C'], duration: 300, onComplete: () => { due.textContent = t.expired; } }, 2800);
        tl.add($(root, '.vstamp'), { opacity: [0, 1], scale: [2.2, 1], rotate: [-10, -10], duration: 450, ease: 'outBack' }, 3100);
        tl.add($(root, '.v-exp'), { opacity: [1, 0.55], duration: 400 }, 3500);
        // The lock opens and the balance flies back to the importer
        tl.add($(root, '.dial'), { rotate: [0, 180], duration: 600, ease: 'inOutCubic' }, 3600);
        tl.add($(root, '.shackle'), { translateY: [0, -16], duration: 500, ease: 'outQuad' }, 4100);
        tl.add($(root, '.vpend'), { opacity: 0, duration: 300 }, 4200);
        tl.add($$(root, '.c-back'), { opacity: [0, 1], duration: 150, delay: stagger(110) }, 4500);
        tl.add($$(root, '.c-back'), { x: [0, -390], duration: 900, delay: stagger(110), ease: 'inOutQuad' }, 4500);
        tl.add($$(root, '.c-back'), { y: [{ from: 0, to: -80, duration: 450, ease: 'outQuad' }, { to: -20, duration: 450, ease: 'inQuad' }], delay: stagger(110) }, 4500);
        tl.add($$(root, '.c-back'), { opacity: [1, 0], duration: 150, delay: stagger(110) }, 5250);
        num('.v-esc', 43500, 0, 4500, 1500);
        num('.v-imp-amt', 0, 43500, 4700, 1500);
        tl.add($(root, '.v-imp-sub'), { opacity: [0, 1], duration: 400 }, 5600);
        tl.add($(root, '.v-imp'), { scale: [{ from: 1, to: 1.06, duration: 200 }, { to: 1, duration: 300 }] }, 6200);
        glow(tl, root, 'back', 4600);
        scrollTo(tl, root, 0, 300, 5600);
        glow(tl, root, 'ref', 7000);
      },
    },
    {
      id: 'security',
      html: (t) => `
        <div class="split" style="grid-template-columns:1fr 440px;gap:50px">
          <div class="copy" style="max-width:1100px">
            <div class="kicker a-up">${t.kicker}</div>
            <div class="h2 a-up">${t.title}</div>
            <div class="layers">${t.layers.map((l) => `<div class="layer a-layer"><div class="who">${l.who}</div><div class="what">${l.what}</div><div class="how">${l.how}</div></div>`).join('')}</div>
            <div class="attacks">${t.attacks.map((a, i) => `
              <div class="attack a-att"><div class="t">${a.title}</div><div class="d">${a.desc}</div>
                <div class="result a-res">${icon('check').replace('<svg', '<svg width="26" height="26"')} ${a.result}</div>
                <div class="hash">${a.hash}</div></div>`).join('')}</div>
            <div class="punch a-punch">${t.punch}</div>
          </div>
          <div class="phone-col" style="transform:scale(0.92)">${phone([{ src: 'exporter-upload.png', hl: [{ id: 'ignored', x: 16, y: 1020, w: 358, h: 56, cls: 'money' }] }], t.phoneLabel)}</div>
        </div>`,
      enter: (root, tl) => {
        intro(tl, root);
        tl.add($$(root, '.a-layer'), { opacity: [0, 1], y: [30, 0], duration: 600, delay: stagger(220), ease: 'outExpo' }, 700);
        tl.add($$(root, '.a-att'), { opacity: [0, 1], y: [40, 0], duration: 700, delay: stagger(900), ease: 'outExpo' }, 2000);
        tl.add($$(root, '.a-res'), { opacity: [0, 1], scale: [0.7, 1], duration: 500, delay: stagger(900), ease: 'outBack' }, 2700);
        scrollTo(tl, root, 0, 300, 1500, 1800);
        glow(tl, root, 'ignored', 3400);
        tl.add($(root, '.a-punch'), { opacity: [0, 1], y: [30, 0], duration: 800, ease: 'outExpo' }, 4300);
      },
    },
    {
      id: 'analyst',
      html: (t) => `
        <div class="split">
          <div class="copy">
            <div class="kicker a-up">${t.kicker}</div>
            <div class="h2 a-up">${t.title}</div>
            <div class="lead a-up">${t.lead}</div>
            ${bullets(t.bullets)}
          </div>
          <div class="phone-col">${phone([{ src: 'agent.png', hl: [{ id: 'sees', x: 14, y: 186, w: 362, h: 230 }] }], t.phoneLabel)}</div>
        </div>`,
      enter: (root, tl) => {
        intro(tl, root);
        glow(tl, root, 'sees', 1400);
        tl.add($(root, '[data-hl="sees"]'), { opacity: 0, duration: 400 }, 3200);
        scrollTo(tl, root, 0, 520, 3400, 2600);
        scrollTo(tl, root, 0, 1060, 6400, 2600);
      },
    },
    {
      id: 'chain',
      html: (t) => `
        <div>
          <div class="kicker a-up">${t.kicker}</div>
          <div class="h2 a-up">${t.title}</div>
          <div class="lead a-up" style="max-width:1400px">${t.lead}</div>
          <div class="contracts">${t.contracts.map((c) => `<div class="contract a-c"><div class="nm">${c.name}</div><div class="rl">${c.role}</div><div class="ad" data-addr="${c.addr}">${c.addr}</div></div>`).join('')}</div>
          <div class="netline a-up"><span class="badge built">${t.network}</span><span class="chip"><span class="dot" style="background:var(--turn)"></span>${t.hashes}</span></div>
        </div>`,
      enter: (root, tl) => {
        intro(tl, root);
        tl.add($$(root, '.a-c'), { opacity: [0, 1], y: [30, 0], duration: 600, delay: stagger(140), ease: 'outExpo' }, 800);
        $$(root, '.ad').forEach((el, i) => {
          const full = el.dataset.addr; const o = { n: 0 };
          tl.add(o, { n: full.length, duration: 900, ease: 'linear', modifier: utils.round(0), onUpdate: () => { el.textContent = full.slice(0, o.n); } }, 1000 + i * 160);
        });
      },
    },
    {
      id: 'business',
      html: (t) => `
        <div>
          <div style="display:flex;gap:24px;align-items:center" class="a-up"><div class="kicker" style="margin:0">${t.kicker}</div><span class="badge proposal">${t.badge}</span></div>
          <div class="h2 a-up" style="margin-top:24px">${t.title}</div>
          <div class="biz" style="height:400px">
            <svg class="lines" viewBox="0 0 1640 400">
              <path class="bz-l1" d="M300 242 H 670" stroke="#3A3A3E" stroke-width="4" fill="none" stroke-dasharray="2 12" stroke-linecap="round"/>
              <path class="bz-l2" d="M970 242 H 1340" stroke="#3A3A3E" stroke-width="4" fill="none" stroke-dasharray="2 12" stroke-linecap="round"/>
              <path class="bz-l3" d="M820 170 V 150" stroke="#FFD60A" stroke-width="4" fill="none" stroke-dasharray="2 12" stroke-linecap="round"/>
            </svg>
            <div class="box a-box" style="left:0;top:180px"><div class="t">${t.importer}</div><div class="s">${t.importerSub}</div></div>
            <div class="box keel a-box" style="left:670px;top:170px"><div class="t" style="font-size:44px">${logo()}</div><div class="s">${t.keelSub}</div></div>
            <div class="box a-box" style="left:1340px;top:180px"><div class="t">${t.exporter}</div><div class="s">${t.exporterSub}</div></div>
            <div class="box bank a-box" style="left:670px;top:-10px;padding:18px 26px"><div class="t" style="font-size:26px">${t.bank}</div><div class="s">${t.bankSub}</div></div>
            ${t.fees.map((f, i) => `<div class="fee a-fee" style="left:${325 + i * 670}px;top:170px;width:320px;text-align:center">${f}<span class="strike"></span></div>`).join('')}
          </div>
          <div class="revenue">${t.revenue.map((r) => `<div class="card a-rev"><div class="t">${r.title}</div><div class="s">${r.sub}</div></div>`).join('')}</div>
        </div>`,
      enter: (root, tl) => {
        intro(tl, root);
        tl.add($$(root, '.a-box'), { opacity: [0, 1], scale: [0.85, 1], duration: 700, delay: stagger(200), ease: 'outBack' }, 500);
        ['.bz-l1', '.bz-l2', '.bz-l3'].forEach((s, i) => tl.add(svg.createDrawable($(root, s)), { draw: ['0 0', '0 1'], duration: 800, ease: 'inOutQuad' }, 1300 + i * 300));
        tl.add($$(root, '.a-fee'), { opacity: [0, 1], y: [20, 0], duration: 500, delay: stagger(200) }, 2300);
        tl.add($$(root, '.a-fee .strike'), { scaleX: [0, 1], duration: 500, delay: stagger(200), ease: 'outExpo' }, 3200);
        tl.add($$(root, '.a-fee'), { opacity: 0.75, duration: 400 }, 3800);
        tl.add($$(root, '.a-rev'), { opacity: [0, 1], y: [30, 0], duration: 700, delay: stagger(200), ease: 'outExpo' }, 4200);
      },
    },
    {
      id: 'mvp',
      html: (t) => `
        <div>
          <div class="kicker a-up">${t.kicker}</div>
          <div class="h2 a-up">${t.title}</div>
          <div class="lead a-up" style="max-width:1500px">${t.lead}</div>
          <div class="road">${t.phases.map((p, i) => `<div class="card a-ph ${i === 0 ? 'now' : ''}"><div class="ph-name">${p.name}</div><div class="t">${p.title}</div><ul>${p.items.map((x) => `<li>${x}</li>`).join('')}</ul></div>`).join('')}</div>
        </div>`,
      enter: (root, tl) => {
        intro(tl, root);
        tl.add($$(root, '.a-ph'), { opacity: [0, 1], y: [50, 0], duration: 800, delay: stagger(300), ease: 'outExpo' }, 700);
        tl.add($$(root, '.road li'), { opacity: [0, 1], x: [-16, 0], duration: 400, delay: stagger(90) }, 1200);
      },
    },
    {
      id: 'close',
      html: (t) => `
        <div class="s-close" style="height:100%">
          <div class="h1 a-up" style="max-width:1500px">${t.title}</div>
          <div class="stats">${t.stats.map((s) => `<div class="stat a-stat"><span class="sico">${icon(s.icon)}</span><div class="v">${odometer(s.v)}</div><div class="l">${s.l}</div></div>`).join('')}</div>
          <a class="verify a-up" href="${t.verifyUrl}" target="_blank" rel="noopener">${icon('check').replace('<svg', '<svg width="22" height="22"')} ${t.verify} <span class="mono">sepolia.basescan.org/tx/0x66af…cf1e</span></a>
          <div style="display:flex;align-items:center;gap:50px;margin-top:80px" class="a-up">
            <span style="font-size:120px">${logo()}</span>
            <div><div style="font-size:46px;font-weight:800">${t.thanks}</div><div class="lead" style="margin-top:8px">${t.repo}</div></div>
          </div>
        </div>`,
      enter: (root, tl) => {
        intro(tl, root);
        tl.add($$(root, '.a-stat'), { opacity: [0, 1], y: [40, 0], scale: [0.94, 1], duration: 800, delay: stagger(200), ease: 'outBack' }, 600);
        // Each big icon draws itself, then its number rolls like an odometer
        $$(root, '.a-stat').forEach((card, i) => {
          const at = 800 + i * 200;
          tl.add(svg.createDrawable(card.querySelectorAll('.sico path, .sico circle, .sico rect')), { draw: ['0 0', '0 1'], duration: 1100, ease: 'inOutQuad' }, at);
          tl.add(card.querySelector('.sico'), { scale: [{ from: 0.7, to: 1.08, duration: 500, ease: 'outBack' }, { to: 1, duration: 300 }] }, at);
          card.querySelectorAll('.odo-strip').forEach((strip) => {
            const n = Number(strip.dataset.n);
            tl.add(strip, { translateY: ['0em', `${-(n - 1) * 1.2}em`], duration: 2000, ease: 'outQuart' }, at + 300);
          });
        });
      },
    },
  ];

  // ---------------------------------------------------------------- engine
  const stage = document.getElementById('stage');
  SLIDES.forEach((s) => {
    const el = document.createElement('section');
    el.className = `slide slide-${s.id}`;
    el.dataset.id = s.id;
    stage.appendChild(el);
  });
  const els = [...stage.querySelectorAll('.slide')];
  let cur = -1;
  let tl = null;

  const fit = () => {
    const k = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    stage.style.transform = `translate(-50%, -50%) scale(${k})`;
  };
  window.addEventListener('resize', fit);
  fit();

  const notes = document.getElementById('notes');
  const renderNotes = () => {
    const n = T.slides[SLIDES[cur].id].notes;
    notes.innerHTML = `<div class="nt">${cur + 1} / ${SLIDES.length} · ${n.time}</div><div class="say">${n.say}</div>${n.tip ? `<div class="tip">${n.tip}</div>` : ''}`;
  };

  const go = (i) => {
    i = Math.max(0, Math.min(SLIDES.length - 1, i));
    if (i === cur) return;
    if (tl) tl.pause();
    if (cur >= 0) els[cur].classList.remove('active');
    cur = i;
    const s = SLIDES[i];
    const root = els[i];
    root.innerHTML = s.html(T.slides[s.id]);
    // Everything animated starts hidden, so nothing flashes before its turn
    utils.set(root.querySelectorAll('.a-up,.a-phone,.a-party,.a-coin,.a-q,.a-dil,.a-mail,.a-stamp,.a-pain,.a-src,.a-node,.a-release,.a-layer,.a-att,.a-res,.a-punch,.a-c,.a-box,.a-fee,.a-rev,.a-ph,.a-stat,.a-leg,.vparty,.vault,.vcoin,.vchip,.vsub,.vpend,.kscan,.okc,.vstamp,.r-sub'), { opacity: 0 });
    if (s.id === 'title') utils.set(root.querySelectorAll('.tile,.eel span,.tile-k'), { opacity: 0 });
    root.classList.add('active');
    tl = createTimeline({ defaults: { duration: 800, ease: 'outExpo' } });
    s.enter(root, tl);
    document.getElementById('progress').style.width = `${((i + 1) / SLIDES.length) * 100}%`;
    document.getElementById('counter').textContent = `${String(i + 1).padStart(2, '0')} / ${SLIDES.length}`;
    document.getElementById('brand').style.display = i === 0 || i === SLIDES.length - 1 ? 'none' : 'block';
    renderNotes();
    try { history.replaceState(null, '', `#${i + 1}`); } catch (_) {}
  };

  document.getElementById('brand').innerHTML = logo();

  // Language switch: the other file of the deck. Published as an artifact, the English deck is the page itself.
  const lang = document.getElementById('lang');
  if (lang) {
    const local = location.protocol === 'file:';
    lang.textContent = T.lang === 'en' ? 'ES' : 'EN';
    lang.href = T.lang === 'en' ? 'keel-deck-es.html' : (local ? 'keel-deck-en.html' : 'index.html');
    lang.addEventListener('click', (e) => { e.stopPropagation(); lang.href += location.hash; });
  }

  // Rehearsal timer: T starts and stops it, it turns red after 8 minutes
  const timer = document.getElementById('timer');
  let t0 = null; let tick = null;
  const toggleTimer = () => {
    if (tick) { clearInterval(tick); tick = null; timer.classList.remove('on'); return; }
    t0 = Date.now(); timer.classList.add('on');
    tick = setInterval(() => {
      const s = Math.floor((Date.now() - t0) / 1000);
      timer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      timer.classList.toggle('late', s >= 480);
    }, 250);
  };

  window.addEventListener('keydown', (e) => {
    if (['ArrowRight', 'PageDown', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); go(cur + 1); }
    else if (['ArrowLeft', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); go(cur - 1); }
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(SLIDES.length - 1);
    else if (e.key === 'n' || e.key === 'N') notes.classList.toggle('on');
    else if (e.key === 't' || e.key === 'T') toggleTimer();
    else if (e.key === 'r' || e.key === 'R') { const i = cur; cur = -1; go(i); }
    else if (e.key === 'f' || e.key === 'F') { try { const p = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen(); if (p && p.catch) p.catch(() => {}); } catch (_) {} }
  });
  stage.addEventListener('click', (e) => { if (e.target.closest('a')) return; if (e.clientX > window.innerWidth / 3) go(cur + 1); else go(cur - 1); });

  const start = parseInt(location.hash.slice(1), 10);
  go(Number.isFinite(start) ? start - 1 : 0);
})();
