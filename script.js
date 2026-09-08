(() => {
  'use strict';

  const STORAGE_KEY = 'lucasSimulator3000.restaurants';

  const STARTER_LIST = [
    'Pierre\u2019s Palace of Pasta',
    'The Saucy Baguette',
    'Wok This Way',
    'Taco \u2018Bout Delicious',
    'Curry On My Wayward Son',
    'The Sizzling Skillet',
    'Sushi, Actually',
    'Grill Seeking Missile'
  ];

  // Golden-angle hue rotation + a rotating set of saturation/lightness "bands"
  // guarantees visually distinct colors no matter how many restaurants are added,
  // instead of a fixed palette that repeats after a handful of entries.
  const GOLDEN_ANGLE = 137.508;
  const COLOR_BANDS = [
    { s: 82, l: 58, textDark: true },
    { s: 88, l: 46, textDark: false },
    { s: 78, l: 66, textDark: true },
    { s: 90, l: 36, textDark: false }
  ];

  function segmentStyle(index) {
    const hue = (index * GOLDEN_ANGLE) % 360;
    const band = COLOR_BANDS[index % COLOR_BANDS.length];
    return {
      fill: `hsl(${hue.toFixed(1)}, ${band.s}%, ${band.l}%)`,
      textColor: band.textDark ? '#3d0910' : '#fff6df'
    };
  }

  const RESULT_TAGLINES = [
    'Destiny does not accept returns.',
    'The wheel has spoken. Argue with it if you dare.',
    'Somewhere, a chef just sensed your arrival.',
    'This decision is now legally binding.*',
    'The universe has run the numbers. This is it.',
    'Resistance is futile. Bring a napkin.'
  ];

  const MUTE_KEY = 'lucasSimulator3000.muted';
  const SPIN_DURATION_MS = 4200;

  /* ---------------- State ---------------- */

  let restaurants = loadRestaurants();
  let currentRotation = 0;
  let isSpinning = false;
  let isMuted = loadMuted();

  /* ---------------- DOM refs ---------------- */

  const wheelCanvas = document.getElementById('wheelCanvas');
  const wheelCtx = wheelCanvas.getContext('2d');
  const spinBtn = document.getElementById('spinBtn');
  const wheelHint = document.getElementById('wheelHint');

  const addForm = document.getElementById('addForm');
  const restaurantInput = document.getElementById('restaurantInput');
  const restaurantListEl = document.getElementById('restaurantList');
  const emptyMsg = document.getElementById('emptyMsg');
  const resetBtn = document.getElementById('resetBtn');
  const clearBtn = document.getElementById('clearBtn');

  const resultOverlay = document.getElementById('resultOverlay');
  const resultName = document.getElementById('resultName');
  const closeResult = document.getElementById('closeResult');

  const confettiCanvas = document.getElementById('confettiCanvas');
  const confettiCtx = confettiCanvas.getContext('2d');

  const soundToggle = document.getElementById('soundToggle');

  /* ---------------- Sound engine ----------------
     Procedurally synthesized with the Web Audio API — layered oscillators,
     filtered noise, a convolution reverb tail, and a waveshaper for the sub
     boom. This sandbox can only reach npm/GitHub/PyPI, and the only bundled
     CC0 audio reachable there turned out to be thin 64kbps UI blips, wrong
     for a fanfare or an explosion. Full-quality synthesis avoids that and
     any licensing question entirely. Everything is built once at load time
     (buffers, impulse response, distortion curve) so there's zero setup
     delay the first time a sound plays — only ctx.resume() waits on a user
     gesture, which happens synchronously inside the click handlers below. */

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const actx = AudioContextClass ? new AudioContextClass() : null;

  let masterGain = null;
  let reverbSend = null;
  let noiseBuffer = null;
  let distortionCurve = null;

  if (actx) {
    masterGain = actx.createGain();
    masterGain.gain.value = 1;
    masterGain.connect(actx.destination);

    // shared 2s white noise buffer, reused (sliced) by every noise-based sound
    const noiseSeconds = 2;
    noiseBuffer = actx.createBuffer(1, actx.sampleRate * noiseSeconds, actx.sampleRate);
    const noiseData = noiseBuffer.getChannelData(0);
    for (let i = 0; i < noiseData.length; i++) noiseData[i] = Math.random() * 2 - 1;

    // procedural reverb impulse response (exponentially decaying noise)
    const irSeconds = 2.2;
    const irBuffer = actx.createBuffer(2, actx.sampleRate * irSeconds, actx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = irBuffer.getChannelData(ch);
      for (let i = 0; i < data.length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2.5);
      }
    }
    const convolver = actx.createConvolver();
    convolver.buffer = irBuffer;
    reverbSend = actx.createGain();
    reverbSend.gain.value = 0.55;
    reverbSend.connect(convolver).connect(masterGain);

    // waveshaper curve for a gritty, punchy sub-bass boom
    const amount = 45;
    const curveSamples = 44100;
    distortionCurve = new Float32Array(curveSamples);
    for (let i = 0; i < curveSamples; i++) {
      const x = (i * 2) / curveSamples - 1;
      distortionCurve[i] = ((3 + amount) * x * 20 * (Math.PI / 180)) / (Math.PI + amount * Math.abs(x));
    }
  }

  function loadMuted() {
    try {
      return localStorage.getItem(MUTE_KEY) === '1';
    } catch (e) {
      return false;
    }
  }

  function saveMuted() {
    try {
      localStorage.setItem(MUTE_KEY, isMuted ? '1' : '0');
    } catch (e) {
      // ignore
    }
  }

  function resumeAudio() {
    if (actx && actx.state === 'suspended') actx.resume();
  }

  function noiseSource(durationSec, offsetSec) {
    const src = actx.createBufferSource();
    src.buffer = noiseBuffer;
    src.start(actx.currentTime, offsetSec != null ? offsetSec : Math.random() * 1.5, durationSec);
    return src;
  }

  function playTick() {
    if (isMuted || !actx) return;
    const now = actx.currentTime;

    // short high-passed noise transient for the "click"
    const src = noiseSource(0.04);
    const hp = actx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3200;
    const gain = actx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.55, now + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);
    src.connect(hp).connect(gain).connect(masterGain);

    // tiny tonal pop layered underneath for body
    const osc = actx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(820 + Math.random() * 260, now);
    osc.frequency.exponentialRampToValueAtTime(420, now + 0.03);
    const og = actx.createGain();
    og.gain.setValueAtTime(0.0001, now);
    og.gain.exponentialRampToValueAtTime(0.16, now + 0.004);
    og.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);
    osc.connect(og).connect(masterGain);
    osc.start(now);
    osc.stop(now + 0.05);
  }

  function playTada() {
    if (isMuted || !actx) return;
    const now = actx.currentTime;

    // ascending brass-ish arpeggio: two detuned sawtooths per note through a
    // sweeping lowpass, for a fat "horn stab" character
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5]; // C5 E5 G5 C6 E6
    notes.forEach((freq, i) => {
      const start = now + i * 0.11;
      [-6, 6].forEach((detune) => {
        const osc = actx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, start);
        osc.detune.setValueAtTime(detune, start);
        const filt = actx.createBiquadFilter();
        filt.type = 'lowpass';
        filt.frequency.setValueAtTime(700, start);
        filt.frequency.exponentialRampToValueAtTime(4200, start + 0.05);
        filt.frequency.exponentialRampToValueAtTime(1100, start + 0.45);
        const g = actx.createGain();
        g.gain.setValueAtTime(0.0001, start);
        g.gain.exponentialRampToValueAtTime(0.17, start + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, start + 0.55);
        osc.connect(filt).connect(g);
        g.connect(masterGain);
        g.connect(reverbSend);
        osc.start(start);
        osc.stop(start + 0.6);
      });
    });

    // crash swell at the top
    const crashSrc = noiseSource(1.2, 0);
    const crashFilt = actx.createBiquadFilter();
    crashFilt.type = 'highpass';
    crashFilt.frequency.value = 4500;
    const crashGain = actx.createGain();
    crashGain.gain.setValueAtTime(0.0001, now);
    crashGain.gain.exponentialRampToValueAtTime(0.22, now + 0.02);
    crashGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.1);
    crashSrc.connect(crashFilt).connect(crashGain);
    crashGain.connect(masterGain);
    crashGain.connect(reverbSend);

    // sparkle bells to finish
    const sparkleStart = now + notes.length * 0.11 + 0.05;
    [1568, 2093, 2637].forEach((freq, i) => {
      const start = sparkleStart + i * 0.06;
      const osc = actx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);
      const g = actx.createGain();
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(0.13, start + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.8);
      osc.connect(g);
      g.connect(masterGain);
      g.connect(reverbSend);
      osc.start(start);
      osc.stop(start + 0.85);
    });
  }

  function playExplosion(pan, delaySec) {
    if (isMuted || !actx) return;
    const now = actx.currentTime + (delaySec || 0);

    let outNode = masterGain;
    if (actx.createStereoPanner) {
      const panner = actx.createStereoPanner();
      panner.pan.setValueAtTime(pan || 0, now);
      panner.connect(masterGain);
      outNode = panner;
    }

    // initial crack transient
    const crackSrc = noiseSource(0.1);
    const crackFilt = actx.createBiquadFilter();
    crackFilt.type = 'highpass';
    crackFilt.frequency.setValueAtTime(1400, now);
    const crackGain = actx.createGain();
    crackGain.gain.setValueAtTime(0.0001, now);
    crackGain.gain.exponentialRampToValueAtTime(0.95, now + 0.006);
    crackGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
    crackSrc.connect(crackFilt).connect(crackGain).connect(outNode);

    // sub-bass thump, distorted for punch
    const sub = actx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(150, now);
    sub.frequency.exponentialRampToValueAtTime(28, now + 0.5);
    const shaper = actx.createWaveShaper();
    shaper.curve = distortionCurve;
    const subGain = actx.createGain();
    subGain.gain.setValueAtTime(0.0001, now);
    subGain.gain.exponentialRampToValueAtTime(0.9, now + 0.03);
    subGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.1);
    sub.connect(shaper).connect(subGain).connect(outNode);
    sub.start(now);
    sub.stop(now + 1.2);

    // rolling rumble tail, lowpass sweeping down, fed through reverb
    const rumbleSrc = actx.createBufferSource();
    rumbleSrc.buffer = noiseBuffer;
    rumbleSrc.loop = true;
    const rumbleFilt = actx.createBiquadFilter();
    rumbleFilt.type = 'lowpass';
    rumbleFilt.frequency.setValueAtTime(2600, now);
    rumbleFilt.frequency.exponentialRampToValueAtTime(110, now + 2.6);
    const rumbleGain = actx.createGain();
    rumbleGain.gain.setValueAtTime(0.0001, now);
    rumbleGain.gain.exponentialRampToValueAtTime(0.6, now + 0.15);
    rumbleGain.gain.exponentialRampToValueAtTime(0.0001, now + 2.8);
    rumbleSrc.connect(rumbleFilt).connect(rumbleGain);
    rumbleGain.connect(outNode);
    rumbleGain.connect(reverbSend);
    rumbleSrc.start(now);
    rumbleSrc.stop(now + 2.9);
  }

  function updateSoundToggleUI() {
    if (!soundToggle) return;
    soundToggle.textContent = isMuted ? '🔇' : '🔊';
    soundToggle.setAttribute('aria-label', isMuted ? 'Unmute sound' : 'Mute sound');
    soundToggle.setAttribute('aria-pressed', String(!isMuted));
  }

  if (soundToggle) {
    soundToggle.addEventListener('click', () => {
      resumeAudio();
      isMuted = !isMuted;
      saveMuted();
      if (masterGain) masterGain.gain.value = isMuted ? 0 : 1;
      updateSoundToggleUI();
      if (!isMuted) playTick();
    });
    updateSoundToggleUI();
  }

  /* ---------------- Storage ---------------- */

  function loadRestaurants() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')) {
          return parsed;
        }
      }
    } catch (e) {
      // ignore corrupt storage, fall through to starter list
    }
    return [...STARTER_LIST];
  }

  function saveRestaurants() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(restaurants));
    } catch (e) {
      // storage might be full or unavailable — fail silently, app still works in-memory
    }
  }

  /* ---------------- Restaurant list UI ---------------- */

  function renderList() {
    restaurantListEl.innerHTML = '';

    restaurants.forEach((name, index) => {
      const li = document.createElement('li');
      li.className = 'restaurant-item';

      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      swatch.style.background = segmentStyle(index).fill;

      const input = document.createElement('input');
      input.type = 'text';
      input.value = name;
      input.maxLength = 40;
      input.setAttribute('aria-label', `Restaurant name ${index + 1}`);
      input.addEventListener('change', () => {
        const val = input.value.trim();
        if (val) {
          restaurants[index] = val;
        } else {
          input.value = restaurants[index];
        }
        saveRestaurants();
        drawWheel();
      });

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'remove-button';
      removeBtn.innerHTML = '&times;';
      removeBtn.setAttribute('aria-label', `Remove ${name}`);
      removeBtn.addEventListener('click', () => {
        restaurants.splice(index, 1);
        saveRestaurants();
        renderList();
        drawWheel();
      });

      li.appendChild(swatch);
      li.appendChild(input);
      li.appendChild(removeBtn);
      restaurantListEl.appendChild(li);
    });

    emptyMsg.classList.toggle('visible', restaurants.length === 0);
    updateSpinAvailability();
  }

  function updateSpinAvailability() {
    const canSpin = restaurants.length >= 2 && !isSpinning;
    spinBtn.disabled = !canSpin;
    if (restaurants.length === 0) {
      wheelHint.textContent = 'Add some restaurants on the right, then give fate a whirl!';
    } else if (restaurants.length === 1) {
      wheelHint.textContent = 'Add at least one more contestant — even destiny needs options.';
    } else {
      wheelHint.textContent = 'Add some restaurants on the right, then give fate a whirl!';
    }
  }

  addForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const val = restaurantInput.value.trim();
    if (!val) return;
    if (val.length > 40) return;
    restaurants.push(val);
    restaurantInput.value = '';
    saveRestaurants();
    renderList();
    drawWheel();
  });

  resetBtn.addEventListener('click', () => {
    if (isSpinning) return;
    restaurants = [...STARTER_LIST];
    saveRestaurants();
    renderList();
    drawWheel();
  });

  clearBtn.addEventListener('click', () => {
    if (isSpinning) return;
    restaurants = [];
    saveRestaurants();
    renderList();
    drawWheel();
  });

  /* ---------------- Wheel drawing ---------------- */

  function drawWheel() {
    const w = wheelCanvas.width;
    const h = wheelCanvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(w, h) / 2;

    wheelCtx.clearRect(0, 0, w, h);

    if (restaurants.length === 0) {
      wheelCtx.fillStyle = '#3d0910';
      wheelCtx.beginPath();
      wheelCtx.arc(cx, cy, radius, 0, Math.PI * 2);
      wheelCtx.fill();
      wheelCtx.fillStyle = '#ffd447';
      wheelCtx.font = "600 20px 'Baloo 2', sans-serif";
      wheelCtx.textAlign = 'center';
      wheelCtx.textBaseline = 'middle';
      wheelCtx.fillText('Add contestants \u2192', cx, cy);
      return;
    }

    const n = restaurants.length;
    const segAngle = (Math.PI * 2) / n;

    for (let i = 0; i < n; i++) {
      const start = -Math.PI / 2 + i * segAngle;
      const end = start + segAngle;

      const style = segmentStyle(i);

      wheelCtx.beginPath();
      wheelCtx.moveTo(cx, cy);
      wheelCtx.arc(cx, cy, radius, start, end);
      wheelCtx.closePath();
      wheelCtx.fillStyle = style.fill;
      wheelCtx.fill();
      wheelCtx.lineWidth = 3;
      wheelCtx.strokeStyle = 'rgba(61, 9, 16, 0.6)';
      wheelCtx.stroke();

      // label
      wheelCtx.save();
      wheelCtx.translate(cx, cy);
      wheelCtx.rotate(start + segAngle / 2);
      wheelCtx.textAlign = 'right';
      wheelCtx.textBaseline = 'middle';
      wheelCtx.fillStyle = style.textColor;
      const fontSize = n > 10 ? 14 : n > 6 ? 17 : 20;
      wheelCtx.font = `800 ${fontSize}px 'Baloo 2', sans-serif`;

      let label = restaurants[i];
      const maxChars = n > 10 ? 16 : 22;
      if (label.length > maxChars) {
        label = label.slice(0, maxChars - 1) + '\u2026';
      }
      wheelCtx.fillText(label, radius - 22, 0);
      wheelCtx.restore();
    }
  }

  /* ---------------- Spin logic ---------------- */

  function pickWinningIndex() {
    return Math.floor(Math.random() * restaurants.length);
  }

  function spin() {
    if (isSpinning || restaurants.length < 2) return;
    isSpinning = true;
    updateSpinAvailability();
    wheelHint.textContent = 'Spinning\u2026 the suspense is unbearable.';

    // resume the (already-created) audio context inside this user-gesture
    // call stack, so the ticks scheduled below via setTimeout are allowed
    // to actually produce sound on strict mobile browsers
    resumeAudio();

    const n = restaurants.length;
    const segAngleDeg = 360 / n;
    const winningIndex = pickWinningIndex();

    // land somewhere within the middle 70% of the segment, not right on the edge
    const jitter = (0.15 + Math.random() * 0.7) * segAngleDeg;
    const pointerAngleOnWheel = winningIndex * segAngleDeg + jitter;
    const normalizedTarget = ((360 - pointerAngleOnWheel) % 360 + 360) % 360;

    const currentMod = ((currentRotation % 360) + 360) % 360;
    let diff = normalizedTarget - currentMod;
    diff = ((diff % 360) + 360) % 360;

    const extraSpins = 6 + Math.floor(Math.random() * 3); // 6-8 full spins
    const totalDelta = diff + extraSpins * 360;
    const finalRotation = currentRotation + totalDelta;

    wheelCanvas.style.transition = `transform ${SPIN_DURATION_MS / 1000}s cubic-bezier(0.15, 0.85, 0.15, 1)`;
    wheelCanvas.style.transform = `rotate(${finalRotation}deg)`;
    currentRotation = finalRotation;

    // schedule a "tick" each time a segment boundary passes the pointer, timed to
    // roughly match the CSS ease-out curve so the clicks slow down like a real wheel
    const totalTicks = Math.max(10, Math.round(totalDelta / segAngleDeg));
    for (let k = 1; k <= totalTicks; k++) {
      const p = k / totalTicks;
      const t = 1 - Math.pow(1 - p, 1 / 3); // inverse of the ease-out cubic used visually
      window.setTimeout(playTick, t * SPIN_DURATION_MS);
    }

    window.setTimeout(() => {
      isSpinning = false;
      updateSpinAvailability();
      launchConfetti();
      playTada();
      triggerNukes();
      // let the explosion play out on-screen for a beat before the result
      // card (with its dimming backdrop) covers the show
      window.setTimeout(() => showResult(restaurants[winningIndex]), 950);
    }, SPIN_DURATION_MS + 100);
  }

  spinBtn.addEventListener('click', spin);

  /* ---------------- Result overlay ---------------- */

  function showResult(name) {
    resultName.textContent = name;
    const tagline = RESULT_TAGLINES[Math.floor(Math.random() * RESULT_TAGLINES.length)];
    document.querySelector('.result-tagline').textContent = tagline;
    resultOverlay.hidden = false;
  }

  closeResult.addEventListener('click', () => {
    resultOverlay.hidden = true;
  });

  resultOverlay.addEventListener('click', (e) => {
    if (e.target === resultOverlay) {
      resultOverlay.hidden = true;
    }
  });

  /* ---------------- Confetti + nuclear explosion effects ---------------- */

  const CONFETTI_COLORS = ['#ffd447', '#ff4d97', '#14c9b7', '#7b3fe4', '#ff8a3d', '#3dd4ff', '#ff3d3d', '#7cff5e', '#ff9ee8', '#ffffff'];

  let confettiParticles = [];
  let explosionParticles = [];
  let shockwaves = [];
  let screenFlash = null;
  let effectsAnimId = null;

  function resizeConfettiCanvas() {
    confettiCanvas.width = window.innerWidth;
    confettiCanvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resizeConfettiCanvas);
  resizeConfettiCanvas();

  function launchConfetti() {
    spawnConfettiBurst(confettiCanvas.width / 2, confettiCanvas.height * 0.35, 420, 200);
    // two side cannons for extra coverage, staggered right after the main burst
    window.setTimeout(() => spawnConfettiBurst(confettiCanvas.width * 0.08, confettiCanvas.height * 0.55, 180, 60, 1), 120);
    window.setTimeout(() => spawnConfettiBurst(confettiCanvas.width * 0.92, confettiCanvas.height * 0.55, 180, 60, -1), 120);
    // a delayed second wave from the top so the shower keeps going
    window.setTimeout(() => spawnConfettiBurst(confettiCanvas.width / 2, confettiCanvas.height * 0.1, 260, confettiCanvas.width * 0.6), 500);
    startEffectsLoop();
  }

  function spawnConfettiBurst(originX, originY, count, spreadX, xBias) {
    const bias = xBias || 0;
    for (let i = 0; i < count; i++) {
      confettiParticles.push({
        x: originX + (Math.random() - 0.5) * spreadX,
        y: originY,
        vx: bias * (4 + Math.random() * 8) + (Math.random() - 0.5) * 9,
        vy: Math.random() * -11 - 4,
        size: 6 + Math.random() * 7,
        color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
        rotation: Math.random() * 360,
        rotationSpeed: (Math.random() - 0.5) * 14,
        shape: Math.random() > 0.5 ? 'rect' : 'circle',
        gravity: 0.26 + Math.random() * 0.14,
        life: 0,
        maxLife: 140 + Math.random() * 50
      });
    }
  }

  /* ----- nuclear explosion: two blasts, shockwaves, mushroom-cloud smoke, screen flash + shake ----- */

  function triggerNukes() {
    const w = confettiCanvas.width;
    const h = confettiCanvas.height;

    const blasts = [
      { x: w * 0.22, y: h * 0.42, scale: 1.1, pan: -0.8, delay: 0, shakeMag: 20, shakeDur: 900 },
      { x: w * 0.78, y: h * 0.42, scale: 0.95, pan: 0.8, delay: 200, shakeMag: 16, shakeDur: 750 },
      { x: w * 0.5, y: h * 0.28, scale: 0.75, pan: 0, delay: 380, shakeMag: 12, shakeDur: 600 },
      { x: w * 0.35, y: h * 0.62, scale: 0.65, pan: -0.4, delay: 520, shakeMag: 10, shakeDur: 550 },
      { x: w * 0.65, y: h * 0.6, scale: 0.65, pan: 0.4, delay: 640, shakeMag: 10, shakeDur: 550 },
      { x: w * 0.5, y: h * 0.42, scale: 1.4, pan: 0, delay: 820, shakeMag: 26, shakeDur: 1100 }
    ];

    blasts.forEach((b) => {
      window.setTimeout(() => {
        triggerScreenFlash(Math.min(1, b.scale));
        spawnExplosionAt(b.x, b.y, b.scale);
        playExplosion(b.pan, 0);
        shake(b.shakeMag, b.shakeDur);
      }, b.delay);
    });

    startEffectsLoop();
  }

  function triggerScreenFlash(strength) {
    screenFlash = { start: performance.now(), duration: 380, strength: strength == null ? 1 : strength };
  }

  function spawnExplosionAt(x, y, scale) {
    const now = performance.now();

    // two concentric shockwave rings
    shockwaves.push({ x, y, start: now, duration: 850, maxRadius: 340 * scale, width: 14 });
    shockwaves.push({ x, y, start: now + 90, duration: 950, maxRadius: 280 * scale, width: 8 });

    // bright fireball core particles
    for (let i = 0; i < 42; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 9;
      explosionParticles.push({
        kind: 'fire',
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: (18 + Math.random() * 30) * scale,
        life: 0,
        maxLife: 26 + Math.random() * 16,
        hue: 40 + Math.random() * 20
      });
    }

    // a handful of sparks that shoot further and linger, like fireworks
    for (let i = 0; i < 18; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 6 + Math.random() * 10;
      explosionParticles.push({
        kind: 'fire',
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: (6 + Math.random() * 8) * scale,
        life: 0,
        maxLife: 40 + Math.random() * 20,
        hue: 20 + Math.random() * 40
      });
    }

    // rising mushroom-cloud smoke: a stem plus a billowing cap
    for (let i = 0; i < 100; i++) {
      const capBias = Math.random();
      explosionParticles.push({
        kind: 'smoke',
        x: x + (Math.random() - 0.5) * 26 * scale,
        y: y + (Math.random() - 0.5) * 10,
        vx: (Math.random() - 0.5) * (1.2 + capBias * 2.2),
        vy: -(1.4 + Math.random() * 2.6),
        drift: (Math.random() - 0.5) * 0.05,
        size: (14 + Math.random() * 16) * scale,
        growth: 0.55 + Math.random() * 0.5,
        life: 0,
        maxLife: 90 + Math.random() * 70,
        shade: Math.random()
      });
    }
  }

  function startEffectsLoop() {
    if (!effectsAnimId) {
      effectsAnimId = requestAnimationFrame(animateEffects);
    }
  }

  function animateEffects() {
    const ctx = confettiCtx;
    const w = confettiCanvas.width;
    const h = confettiCanvas.height;
    ctx.clearRect(0, 0, w, h);

    let alive = false;
    const now = performance.now();

    // --- shockwave rings ---
    shockwaves = shockwaves.filter((s) => now - s.start < s.duration);
    for (const s of shockwaves) {
      const t = (now - s.start) / s.duration;
      if (t < 0) continue;
      alive = true;
      const radius = s.maxRadius * (1 - Math.pow(1 - t, 2));
      const alpha = 1 - t;
      ctx.save();
      ctx.globalAlpha = Math.max(0, alpha * 0.8);
      ctx.strokeStyle = '#fff6df';
      ctx.lineWidth = s.width * (1 - t * 0.7);
      ctx.beginPath();
      ctx.arc(s.x, s.y, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = '#ff8a3d';
      ctx.globalAlpha = Math.max(0, alpha * 0.5);
      ctx.lineWidth = s.width * 0.5;
      ctx.beginPath();
      ctx.arc(s.x, s.y, radius * 0.94, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // --- explosion particles: smoke first (background), fire on top ---
    const smoke = [];
    const fire = [];
    explosionParticles = explosionParticles.filter((p) => p.life < p.maxLife);
    for (const p of explosionParticles) {
      p.life++;
      if (p.life >= p.maxLife) continue;
      alive = true;

      if (p.kind === 'smoke') {
        p.vy *= 0.985;
        p.vx += p.drift;
        p.x += p.vx;
        p.y += p.vy;
        p.size += p.growth;
        smoke.push(p);
      } else {
        p.vx *= 0.94;
        p.vy = p.vy * 0.94 + 0.15;
        p.x += p.vx;
        p.y += p.vy;
        fire.push(p);
      }
    }

    for (const p of smoke) {
      const t = p.life / p.maxLife;
      const alpha = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
      const lightness = 22 + p.shade * 30 + t * 25;
      const hue = 24 - t * 24;
      const sat = Math.max(0, 55 - t * 55);
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha * 0.55));
      const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
      grad.addColorStop(0, `hsl(${hue}, ${sat}%, ${lightness + 12}%)`);
      grad.addColorStop(1, `hsl(${hue}, ${sat}%, ${lightness}%)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    for (const p of fire) {
      const t = p.life / p.maxLife;
      const alpha = 1 - t;
      ctx.save();
      ctx.globalAlpha = Math.max(0, alpha);
      const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * (1 - t * 0.5));
      grad.addColorStop(0, '#fffdf0');
      grad.addColorStop(0.35, `hsl(${p.hue}, 100%, 62%)`);
      grad.addColorStop(1, `hsl(${p.hue - 15}, 100%, 45%)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (1 - t * 0.5), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // --- confetti (drawn on top of everything) ---
    confettiParticles = confettiParticles.filter((p) => p.life < p.maxLife);
    for (const p of confettiParticles) {
      p.life++;
      if (p.life >= p.maxLife) continue;
      alive = true;

      p.vy += p.gravity;
      p.x += p.vx;
      p.y += p.vy;
      p.rotation += p.rotationSpeed;

      const fade = 1 - Math.max(0, (p.life - p.maxLife * 0.7) / (p.maxLife * 0.3));

      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, fade));
      ctx.translate(p.x, p.y);
      ctx.rotate((p.rotation * Math.PI) / 180);
      ctx.fillStyle = p.color;

      if (p.shape === 'rect') {
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // --- screen flash (drawn last, full-viewport) ---
    if (screenFlash) {
      const t = (now - screenFlash.start) / screenFlash.duration;
      if (t < 1) {
        alive = true;
        const alpha = (1 - t) * 0.85 * screenFlash.strength;
        ctx.save();
        ctx.globalAlpha = Math.max(0, alpha);
        ctx.fillStyle = '#fff6df';
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
      } else {
        screenFlash = null;
      }
    }

    if (alive) {
      effectsAnimId = requestAnimationFrame(animateEffects);
    } else {
      ctx.clearRect(0, 0, w, h);
      effectsAnimId = null;
    }
  }

  /* ----- screen shake ----- */

  let shakeAnimId = null;
  function shake(intensity, durationMs) {
    const start = performance.now();
    const existingIntensity = shake._intensity || 0;
    shake._intensity = Math.max(existingIntensity, intensity);
    shake._end = Math.max(shake._end || 0, start + durationMs);

    if (shakeAnimId) return;

    function tick() {
      const now = performance.now();
      const remaining = shake._end - now;
      if (remaining <= 0) {
        document.body.style.transform = '';
        shakeAnimId = null;
        shake._intensity = 0;
        return;
      }
      const decay = Math.min(1, remaining / durationMs);
      const mag = shake._intensity * decay;
      const dx = (Math.random() - 0.5) * mag;
      const dy = (Math.random() - 0.5) * mag;
      document.body.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
      shakeAnimId = requestAnimationFrame(tick);
    }
    shakeAnimId = requestAnimationFrame(tick);
  }

  /* ---------------- Init ---------------- */

  renderList();
  drawWheel();
})();
