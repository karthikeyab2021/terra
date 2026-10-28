(() => {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const wrap = document.getElementById("table");
  const overlay = document.getElementById("overlay");
  const playBtn = document.getElementById("playBtn");
  const title = document.getElementById("modalTitle");
  const modalText = document.getElementById("modalText");
  const toast = document.getElementById("toast");

  let W = 800;
  let H = 430;
  let dpr = 1;
  let running = false;
  let ended = false;
  let sound = true;
  let scoreA = 0;
  let scoreB = 0;
  let last = 0;
  let toastTimer = 0;

  const keys = new Set();
  const goal = 7;

  const mallets = [
    {
      x: 130, y: 215, px: 130, py: 215, vx: 0, vy: 0, r: 22,
      color: "#5af5ff", glow: "rgba(90,245,255,.52)",
      minX: 24, maxX: W / 2 - 18
    },
    {
      x: W - 130, y: 215, px: W - 130, py: 215, vx: 0, vy: 0, r: 22,
      color: "#ff4fc8", glow: "rgba(255,79,200,.52)",
      minX: W / 2 + 18, maxX: W - 24
    }
  ];

  const puck = { x: W / 2, y: H / 2, vx: 0, vy: 0, r: 12 };
  let audioCtx = null;

  function resize() {
    const rect = wrap.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = rect.width;
    H = rect.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    mallets[0].minX = 24;
    mallets[0].maxX = W / 2 - 18;
    mallets[1].minX = W / 2 + 18;
    mallets[1].maxX = W - 24;

    if (!running) resetPositions();
    draw();
  }

  function resetPositions() {
    mallets[0].x = mallets[0].px = Math.max(60, W * .17);
    mallets[0].y = mallets[0].py = H / 2;
    mallets[1].x = mallets[1].px = Math.min(W - 60, W * .83);
    mallets[1].y = mallets[1].py = H / 2;

    puck.x = W / 2;
    puck.y = H / 2;
    puck.vx = 0;
    puck.vy = 0;
  }

  function beep(freq = 420, dur = .055, type = "sine", vol = .035) {
    if (!sound) return;

    try {
      audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();

      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(vol, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(.001, audioCtx.currentTime + dur);

      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + dur);
    } catch {}
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 1100);
  }

  function start() {
    if (ended) {
      scoreA = 0;
      scoreB = 0;
      updateScore();
      ended = false;
    }

    resetPositions();
    running = true;
    overlay.classList.add("hidden");
    last = performance.now();
    requestAnimationFrame(loop);
    beep(660, .1);
  }

  function pause() {
    running = false;
    title.textContent = "PAUSED";
    modalText.textContent = "Take a breather. The table is yours when you are.";
    playBtn.textContent = "RESUME  ▶";
    overlay.classList.remove("hidden");
  }

  function updateScore() {
    document.getElementById("scoreA").textContent = scoreA;
    document.getElementById("scoreB").textContent = scoreB;
  }

  function goalScored(side) {
    if (side === 0) scoreA++;
    else scoreB++;

    updateScore();
    beep(180, .26, "triangle", .07);
    showToast(side === 0 ? "CYAN SCORES!" : "PINK SCORES!");
    resetPositions();

    if (scoreA >= goal || scoreB >= goal) {
      running = false;
      ended = true;
      title.textContent = scoreA > scoreB ? "CYAN TAKES IT!" : "PINK TAKES IT!";
      modalText.innerHTML = `FINAL SCORE &nbsp; ${scoreA} : ${scoreB}<br>One more round?`;
      playBtn.textContent = "PLAY AGAIN  ↻";
      setTimeout(() => overlay.classList.remove("hidden"), 700);
    } else {
      puck.vx = (side === 0 ? 1 : -1) * Math.min(240, W * .38);
      puck.vy = (Math.random() - .5) * 100;
    }
  }

  function clampMallet(m, i) {
    m.x = Math.max(m.minX, Math.min(m.maxX, m.x));
    m.y = Math.max(m.r + 8, Math.min(H - m.r - 8, m.y));

    if (i === 0) m.maxX = W / 2 - 18;
    else m.minX = W / 2 + 18;
  }

  function moveMallet(m, i, dt) {
    const step = dt * 520;

    if (i === 0) {
      if (keys.has("w")) m.y -= step;
      if (keys.has("s")) m.y += step;
      if (keys.has("a")) m.x -= step;
      if (keys.has("d")) m.x += step;
    } else {
      if (keys.has("arrowup")) m.y -= step;
      if (keys.has("arrowdown")) m.y += step;
      if (keys.has("arrowleft")) m.x -= step;
      if (keys.has("arrowright")) m.x += step;
    }

    clampMallet(m, i);
    m.vx = (m.x - m.px) / Math.max(dt, .001);
    m.vy = (m.y - m.py) / Math.max(dt, .001);
    m.px = m.x;
    m.py = m.y;
  }

  function collide(m) {
    const dx = puck.x - m.x;
    const dy = puck.y - m.y;
    const dist = Math.hypot(dx, dy);
    const min = puck.r + m.r;

    if (dist >= min) return;

    const nx = dx / (dist || 1);
    const ny = dy / (dist || 1);
    const overlap = min - dist;

    puck.x += nx * overlap;
    puck.y += ny * overlap;

    const rel = (puck.vx - m.vx) * nx + (puck.vy - m.vy) * ny;

    if (rel < 0) {
      puck.vx -= 1.9 * rel * nx;
      puck.vy -= 1.9 * rel * ny;
    }

    puck.vx += m.vx * .16;
    puck.vy += m.vy * .16;

    const speed = Math.hypot(puck.vx, puck.vy);

    if (speed > 950) {
      puck.vx *= 950 / speed;
      puck.vy *= 950 / speed;
    }

    beep(560 + Math.min(speed, 400), .035, "sine", .02);
  }

  function update(dt) {
    mallets.forEach((m, i) => moveMallet(m, i, dt));

    puck.x += puck.vx * dt;
    puck.y += puck.vy * dt;

    const friction = Math.pow(.992, dt * 60);
    puck.vx *= friction;
    puck.vy *= friction;

    const goalH = Math.min(138, H * .38);
    const top = (H - goalH) / 2;
    const bottom = top + goalH;

    if (puck.y - puck.r < 8) {
      puck.y = 8 + puck.r;
      puck.vy = Math.abs(puck.vy);
      beep(260, .025);
    }

    if (puck.y + puck.r > H - 8) {
      puck.y = H - 8 - puck.r;
      puck.vy = -Math.abs(puck.vy);
      beep(260, .025);
    }

    if (puck.x - puck.r < 9) {
      if (puck.y > top && puck.y < bottom) {
        goalScored(1);
        return;
      }

      puck.x = 9 + puck.r;
      puck.vx = Math.abs(puck.vx);
      beep(260, .025);
    }

    if (puck.x + puck.r > W - 9) {
      if (puck.y > top && puck.y < bottom) {
        goalScored(0);
        return;
      }

      puck.x = W - 9 - puck.r;
      puck.vx = -Math.abs(puck.vx);
      beep(260, .025);
    }

    mallets.forEach(collide);
  }

  function circle(x, y, r, fill, glow) {
    ctx.save();
    ctx.shadowColor = glow;
    ctx.shadowBlur = 20;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.restore();
  }

  function draw() {
    if (!W || !H) return;

    ctx.clearRect(0, 0, W, H);

    const inset = 9;
    const mid = W / 2;
    const goalH = Math.min(138, H * .38);
    const top = (H - goalH) / 2;
    const bottom = top + goalH;

    ctx.save();
    ctx.lineWidth = 2;
    ctx.shadowBlur = 12;
    ctx.strokeStyle = "rgba(90,245,255,.48)";
    ctx.shadowColor = "#5af5ff";
    ctx.beginPath();
    ctx.moveTo(inset, inset);
    ctx.lineTo(W - inset, inset);
    ctx.moveTo(inset, H - inset);
    ctx.lineTo(W - inset, H - inset);
    ctx.moveTo(inset, inset);
    ctx.lineTo(inset, top);
    ctx.moveTo(inset, bottom);
    ctx.lineTo(inset, H - inset);
    ctx.stroke();

    ctx.strokeStyle = "rgba(255,79,200,.48)";
    ctx.shadowColor = "#ff4fc8";
    ctx.beginPath();
    ctx.moveTo(W - inset, inset);
    ctx.lineTo(W - inset, top);
    ctx.moveTo(W - inset, bottom);
    ctx.lineTo(W - inset, H - inset);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.setLineDash([7, 9]);
    ctx.strokeStyle = "#8792b422";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(mid, 10);
    ctx.lineTo(mid, H - 10);
    ctx.stroke();
    ctx.restore();

    ctx.beginPath();
    ctx.arc(mid, H / 2, Math.min(60, H * .15), 0, Math.PI * 2);
    ctx.strokeStyle = "#8590aa24";
    ctx.lineWidth = 1;
    ctx.stroke();

    circle(mid, H / 2, 3, "#9da8c255", "transparent");

    ctx.fillStyle = "rgba(255,79,200,.07)";
    ctx.fillRect(0, top, 12, goalH);
    ctx.fillStyle = "rgba(90,245,255,.07)";
    ctx.fillRect(W - 12, top, 12, goalH);
    ctx.fillStyle = "#69738e";
    ctx.font = "9px DM Mono";
    ctx.textAlign = "center";
    ctx.fillText("GOAL", W / 2, top - 9);

    for (const m of mallets) {
      circle(m.x, m.y, m.r + 5, m.color + "18", m.glow);
      circle(m.x, m.y, m.r, m.color, m.glow);
      circle(m.x, m.y, m.r * .63, "#101629", "transparent");
      circle(m.x, m.y, m.r * .24, m.color, "transparent");

      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r - 2, 0, Math.PI * 2);
      ctx.strokeStyle = "#ffffff90";
      ctx.lineWidth = 1.3;
      ctx.stroke();
    }

    circle(puck.x, puck.y, puck.r + 6, "#ffffff18", "rgba(255,255,255,.7)");
    circle(puck.x, puck.y, puck.r, "#f2f4ff", "#ffffff");
    circle(puck.x - 3, puck.y - 3, 3, "#ffffffa8", "transparent");
  }

  function loop(now) {
    if (!running) return;

    const dt = Math.min((now - last) / 1000, .033);
    last = now;
    update(dt);
    draw();

    if (running) requestAnimationFrame(loop);
  }

  window.addEventListener("keydown", event => {
    const key = event.key.toLowerCase();

    if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(key)) {
      event.preventDefault();
    }

    if (key === " ") {
      if (running) pause();
      else if (!ended) start();
      return;
    }

    keys.add(key);
  });

  window.addEventListener("keyup", event => {
    keys.delete(event.key.toLowerCase());
  });

  playBtn.addEventListener("click", start);

  document.getElementById("resetBtn").addEventListener("click", () => {
    running = false;
    ended = false;
    scoreA = 0;
    scoreB = 0;
    updateScore();

    title.textContent = "READY, PLAYERS?";
    modalText.innerHTML =
      "First to 7 goals wins the match.<br>Grab a side and own the table.";
    playBtn.textContent = "START GAME  ▶";

    overlay.classList.remove("hidden");
    resetPositions();
    draw();
  });

  document.getElementById("soundBtn").addEventListener("click", event => {
    sound = !sound;
    event.currentTarget.textContent = sound ? "♫ SOUND ON" : "♫ SOUND OFF";
  });

  window.addEventListener("resize", resize);
  resize();
})();


