(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  let W, H, DPR;
  function resize(){
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * DPR; canvas.height = H * DPR;
    canvas.style.width = W+'px'; canvas.style.height = H+'px';
    ctx.setTransform(DPR,0,0,DPR,0,0);
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- AUDIO (synthesized, no external files) ----------
  const AC = new (window.AudioContext || window.webkitAudioContext)();
  function envGain(startVal, atk, dec, sustain=0){
    const g = AC.createGain();
    const t = AC.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(startVal, t+atk);
    g.gain.exponentialRampToValueAtTime(Math.max(sustain,0.0001), t+atk+dec);
    return g;
  }
  function noiseBuffer(dur){
    const buf = AC.createBuffer(1, AC.sampleRate*dur, AC.sampleRate);
    const d = buf.getChannelData(0);
    for(let i=0;i<d.length;i++) d[i] = (Math.random()*2-1) * (1 - i/d.length);
    return buf;
  }
  function playSwoosh(){
    const src = AC.createBufferSource();
    src.buffer = noiseBuffer(0.18);
    const filt = AC.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.setValueAtTime(1800,AC.currentTime);
    filt.frequency.exponentialRampToValueAtTime(500,AC.currentTime+0.15);
    filt.Q.value = 0.9;
    const g = envGain(0.18,0.01,0.17);
    src.connect(filt).connect(g).connect(AC.destination);
    src.start();
  }
  function playSlice(pitch=1){
    const t = AC.currentTime;
    const o = AC.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(700*pitch, t);
    o.frequency.exponentialRampToValueAtTime(120*pitch, t+0.12);
    const g = envGain(0.25,0.005,0.14);
    o.connect(g).connect(AC.destination);
    o.start(); o.stop(t+0.16);

    const src = AC.createBufferSource();
    src.buffer = noiseBuffer(0.08);
    const g2 = envGain(0.12,0.001,0.07);
    src.connect(g2).connect(AC.destination);
    src.start();
  }
  function playBomb(){
    const t = AC.currentTime;
    const src = AC.createBufferSource();
    src.buffer = noiseBuffer(0.6);
    const filt = AC.createBiquadFilter();
    filt.type='lowpass'; filt.frequency.setValueAtTime(1200,t);
    filt.frequency.exponentialRampToValueAtTime(80,t+0.55);
    const g = envGain(0.6,0.01,0.55);
    src.connect(filt).connect(g).connect(AC.destination);
    src.start();

    const o = AC.createOscillator();
    o.type='sawtooth';
    o.frequency.setValueAtTime(90,t);
    o.frequency.exponentialRampToValueAtTime(30,t+0.4);
    const g2 = envGain(0.3,0.01,0.4);
    o.connect(g2).connect(AC.destination);
    o.start(); o.stop(t+0.4);
  }
  function playMiss(){
    const t = AC.currentTime;
    const o = AC.createOscillator();
    o.type='sine';
    o.frequency.setValueAtTime(300,t);
    o.frequency.exponentialRampToValueAtTime(120,t+0.25);
    const g = envGain(0.15,0.01,0.24);
    o.connect(g).connect(AC.destination);
    o.start(); o.stop(t+0.26);
  }

  // ---------- GAME STATE ----------
  const FRUITS = [
    {emoji:'🍎', r:38, juice:'#ff4d6d'},
    {emoji:'🍊', r:36, juice:'#ff9d2f'},
    {emoji:'🍉', r:46, juice:'#ff5c7a'},
    {emoji:'🍌', r:34, juice:'#f4e04d'},
    {emoji:'🍇', r:36, juice:'#9d5cff'},
    {emoji:'🍍', r:40, juice:'#f4e04d'},
    {emoji:'🥝', r:32, juice:'#c6f22d'},
  ];
  const BOMB = {emoji:'💣', r:38};
  const SPECIAL = {emoji:'⭐', r:34, juice:'#ffd23d', special:true};

  const POINTS_NORMAL = 5;
  const POINTS_SPECIAL = 10;
  const RAMP_MS = 55000; // time to reach full difficulty

  let objects = [];      // flying fruit/bombs
  let halves = [];       // sliced fruit halves (visual only)
  let particles = [];    // juice splash particles
  let trail = [];        // pointer trail points
  let score = 0, lives = 3, combo = 0, comboTimer = 0;
  let spawnTimer = 0;
  let running = false, gameTime = 0;
  let lastPointer = null;
  let swooshCooldown = 0;

  const startScreen = document.getElementById('startScreen');
  const overScreen = document.getElementById('overScreen');
  const scoreEl = document.getElementById('score');
  const comboEl = document.getElementById('combo');
  const livesEl = document.getElementById('lives');
  const finalScoreEl = document.getElementById('finalScore');
  const hudHighEl = document.getElementById('hudHigh');
  const startHighEl = document.getElementById('startHigh');
  const overHighEl = document.getElementById('overHigh');
  const knifeEl = document.getElementById('knife');

  let highScore = parseInt(localStorage.getItem('fruitSlicerHighScore') || '0', 10);
  function refreshHighDisplays(){
    hudHighEl.textContent = 'Best: ' + highScore;
    startHighEl.textContent = 'Best score: ' + highScore;
    overHighEl.textContent = 'Best score: ' + highScore;
  }
  refreshHighDisplays();

  const HEART_SVG = `<svg class="heart" viewBox="0 0 24 24" fill="#ff4d6d"><path d="M12 21s-7.5-4.8-10-9.3C.3 8.4 2 5 5.4 5c2 0 3.4 1 4.6 2.6C11.2 6 12.6 5 14.6 5 18 5 19.7 8.4 22 11.7 19.5 16.2 12 21 12 21z"/></svg>`;
  function renderLives(){
    livesEl.innerHTML = '';
    for(let i=0;i<lives;i++){
      const d = document.createElement('div');
      d.innerHTML = HEART_SVG;
      livesEl.appendChild(d.firstElementChild);
    }
  }

  function rand(a,b){ return a + Math.random()*(b-a); }

  function difficultyT(){
    return Math.min(1, gameTime / RAMP_MS);
  }

  function spawnObject(){
    const t = difficultyT();
    const bombChance = 0.04 + t * 0.14;      // 4% -> 18%
    const specialChance = 0.10;               // steady chance for gold fruit
    const roll = Math.random();
    let type, isBomb=false, isSpecial=false;
    if(roll < bombChance){ type = BOMB; isBomb = true; }
    else if(roll < bombChance + specialChance){ type = SPECIAL; isSpecial = true; }
    else { type = FRUITS[Math.floor(Math.random()*FRUITS.length)]; }

    const x = rand(W*0.15, W*0.85);
    const spawnY = H + 60;

    // Pick a real target apex height (how high it should rise into the screen),
    // then derive the launch velocity from gravity so the arc actually reaches it.
    // Apex sits roughly in the top 10%-40% of the screen for a dramatic, hang-time-rich toss.
    const apexY = rand(H*0.08, H*0.40);
    const riseDist = spawnY - apexY;
    const v0 = Math.sqrt(2 * GRAVITY * riseDist);
    const vy = -v0;

    const horizMul = 0.85 + t * 0.35; // horizontal drift picks up a bit as difficulty rises
    const vx = (rand(-1.6, 1.6) + (x < W/2 ? rand(0.3,1.0) : -rand(0.3,1.0))) * horizMul;

    objects.push({
      type, x, y: spawnY, vx, vy,
      rot: rand(0, Math.PI*2), vrot: rand(-0.08,0.08),
      r: type.r, sliced:false, isBomb, isSpecial, spawnT: gameTime,
      scale: 0
    });
  }

  function addJuice(x,y,color,n=14){
    for(let i=0;i<n;i++){
      const a = Math.random()*Math.PI*2;
      const speed = rand(2,7);
      particles.push({
        x,y, vx:Math.cos(a)*speed, vy:Math.sin(a)*speed - 2,
        r: rand(2,5), color, life:1, decay: rand(0.015,0.03)
      });
    }
  }

  function sliceObject(obj, dirx, diry){
    obj.sliced = true;
    playSlice(obj.isBomb?0.6:rand(0.85,1.25));
    if(obj.isBomb){
      addJuice(obj.x, obj.y, '#333', 26);
      playBomb();
      endGame();
      return;
    }
    addJuice(obj.x, obj.y, obj.type.juice, 16);
    // two halves fly apart
    const ang = Math.atan2(diry,dirx) + Math.PI/2;
    [1,-1].forEach(sign=>{
      halves.push({
        emoji: obj.type.emoji, x:obj.x, y:obj.y,
        vx: Math.cos(ang)*sign*3 + obj.vx*0.4,
        vy: Math.sin(ang)*sign*3 + obj.vy*0.4 - 1,
        rot: obj.rot, vrot: obj.vrot + sign*0.15,
        side: sign, r: obj.r, life:1
      });
    });
    combo++;
    comboTimer = 45;
    const pts = obj.isSpecial ? POINTS_SPECIAL : POINTS_NORMAL;
    score += pts;
    scoreEl.textContent = score;
    if(combo > 1){
      comboEl.textContent = combo + 'x STREAK';
      comboEl.style.opacity = 1;
    }
  }

  function missObject(){
    lives--;
    renderLives();
    playMiss();
    if(lives <= 0) endGame();
  }

  function endGame(){
    running = false;
    knifeEl.style.opacity = 0;
    const isNewHigh = score > highScore;
    if(isNewHigh){
      highScore = score;
      localStorage.setItem('fruitSlicerHighScore', String(highScore));
    }
    refreshHighDisplays();
    setTimeout(()=>{
      finalScoreEl.textContent = 'Score: ' + score;
      finalScoreEl.classList.toggle('new-high', isNewHigh);
      overHighEl.textContent = isNewHigh ? 'New best score!' : ('Best score: ' + highScore);
      overScreen.classList.remove('hidden');
    }, 550);
  }

  function resetGame(){
    objects = []; halves = []; particles = []; trail = [];
    score = 0; lives = 3; combo = 0; comboTimer = 0;
    spawnTimer = 0; gameTime = 0;
    scoreEl.textContent = '0';
    comboEl.style.opacity = 0;
    renderLives();
    running = true;
    lastTime = performance.now();
    requestAnimationFrame(loop);
  }

  // ---------- INPUT ----------
  function getPos(e){
    const rect = canvas.getBoundingClientRect();
    if(e.touches && e.touches[0]) return {x:e.touches[0].clientX-rect.left, y:e.touches[0].clientY-rect.top};
    return {x:e.clientX-rect.left, y:e.clientY-rect.top};
  }
  const isTouchDevice = 'ontouchstart' in window;
  function positionKnife(clientX, clientY, angleDeg){
    if(isTouchDevice) return;
    knifeEl.style.opacity = 1;
    knifeEl.style.transform = `translate(${clientX-16}px, ${clientY-16}px) rotate(${angleDeg}deg)`;
  }
  canvas.addEventListener('mouseenter', ()=>{ if(!isTouchDevice) knifeEl.style.opacity = 1; });
  canvas.addEventListener('mouseleave', ()=>{ knifeEl.style.opacity = 0; });

  function pointerMove(e){
    if(!running) return;
    const p = getPos(e);
    const clientX = e.touches && e.touches[0] ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches && e.touches[0] ? e.touches[0].clientY : e.clientY;
    trail.push({...p, t:performance.now()});
    if(trail.length > 18) trail.shift();

    if(lastPointer){
      const dx = p.x-lastPointer.x, dy = p.y-lastPointer.y;
      const dist = Math.hypot(dx,dy);
      if(dist > 1.5){
        const angle = Math.atan2(dy,dx) * 180/Math.PI;
        positionKnife(clientX, clientY, angle);
      }
      if(dist > 4 && swooshCooldown<=0){ playSwoosh(); swooshCooldown = 8; }
      // check collision against segment lastPointer -> p
      for(const obj of objects){
        if(obj.sliced) continue;
        const d = pointToSegDist(obj.x,obj.y,lastPointer.x,lastPointer.y,p.x,p.y);
        if(d < obj.r) sliceObject(obj, dx, dy);
      }
    } else {
      positionKnife(clientX, clientY, -20);
    }
    lastPointer = p;
  }
  function pointerEnd(){ lastPointer = null; }
  function pointToSegDist(px,py,x1,y1,x2,y2){
    const dx=x2-x1, dy=y2-y1;
    const len2 = dx*dx+dy*dy;
    let t = len2===0?0:((px-x1)*dx+(py-y1)*dy)/len2;
    t = Math.max(0,Math.min(1,t));
    const cx = x1+t*dx, cy = y1+t*dy;
    return Math.hypot(px-cx,py-cy);
  }
  canvas.addEventListener('mousemove', pointerMove);
  canvas.addEventListener('mousedown', pointerMove);
  canvas.addEventListener('mouseup', pointerEnd);
  canvas.addEventListener('mouseleave', pointerEnd);
  canvas.addEventListener('touchstart', e=>{pointerMove(e);}, {passive:true});
  canvas.addEventListener('touchmove', e=>{pointerMove(e);}, {passive:true});
  canvas.addEventListener('touchend', pointerEnd);

  // ---------- UPDATE / DRAW ----------
  let lastTime = performance.now();
  const GRAVITY = 0.16;

  function update(dt){
    const ts = Math.min(dt, 40) / 16.6667; // time scale relative to 60fps, clamped to avoid big jumps on tab-switch

    gameTime += dt;
    spawnTimer += dt;
    const currentInterval = 1350 - difficultyT() * 850; // 1350ms -> 500ms
    if(spawnTimer > currentInterval){
      spawnTimer = 0;
      spawnObject();
    }
    if(swooshCooldown>0) swooshCooldown--;

    if(comboTimer>0){ comboTimer--; if(comboTimer===0) comboEl.style.opacity=0; }

    for(let i=objects.length-1;i>=0;i--){
      const o = objects[i];
      if(o.scale < 1) o.scale = Math.min(1, o.scale + 0.14*ts); // pop-in on spawn
      o.vy += GRAVITY*ts; o.x += o.vx*ts; o.y += o.vy*ts; o.rot += o.vrot*ts;
      if(o.sliced){ objects.splice(i,1); continue; }
      if(o.y > H+100){
        objects.splice(i,1);
        if(!o.isBomb) missObject();
      }
    }
    for(let i=halves.length-1;i>=0;i--){
      const h = halves[i];
      h.vy += GRAVITY*ts; h.x+=h.vx*ts; h.y+=h.vy*ts; h.rot+=h.vrot*ts; h.life -= 0.008*ts;
      if(h.life<=0 || h.y>H+150) halves.splice(i,1);
    }
    for(let i=particles.length-1;i>=0;i--){
      const p = particles[i];
      p.vy += GRAVITY*0.6*ts; p.x+=p.vx*ts; p.y+=p.vy*ts; p.life -= p.decay*ts;
      if(p.life<=0) particles.splice(i,1);
    }
  }

  function drawTrail(){
    if(trail.length<2) return;
    const now = performance.now();
    ctx.lineCap='round'; ctx.lineJoin='round';
    for(let i=1;i<trail.length;i++){
      const a = trail[i-1], b = trail[i];
      const age = 1-Math.min(1,(now-b.t)/260);
      if(age<=0) continue;
      ctx.beginPath();
      ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y);
      ctx.strokeStyle = `rgba(198,242,45,${age*0.9})`;
      ctx.lineWidth = 8*age;
      ctx.shadowColor = 'rgba(61,220,255,0.9)';
      ctx.shadowBlur = 14*age;
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
  }

  function draw(){
    ctx.clearRect(0,0,W,H);

    // objects
    for(const o of objects){
      ctx.save();
      ctx.translate(o.x,o.y);
      ctx.rotate(o.rot);
      ctx.scale(o.scale, o.scale);
      ctx.font = o.r*2+'px serif';
      ctx.textAlign='center'; ctx.textBaseline='middle';
      if(o.isBomb){
        ctx.shadowColor='rgba(255,60,60,0.8)'; ctx.shadowBlur=18;
      } else if(o.isSpecial){
        ctx.shadowColor='rgba(255,210,61,0.95)'; ctx.shadowBlur=26;
      } else {
        ctx.shadowColor='rgba(255,255,255,0.25)'; ctx.shadowBlur=10;
      }
      ctx.fillText(o.type.emoji,0,0);
      ctx.restore();
    }

    // halves
    for(const h of halves){
      ctx.save();
      ctx.globalAlpha = Math.max(0,h.life);
      ctx.translate(h.x,h.y);
      ctx.rotate(h.rot);
      ctx.beginPath();
      ctx.rect(h.side>0?0:-h.r, -h.r, h.r, h.r*2);
      ctx.clip();
      ctx.font = h.r*2+'px serif';
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(h.emoji,0,0);
      ctx.restore();
    }

    // particles
    for(const p of particles){
      ctx.beginPath();
      ctx.globalAlpha = Math.max(0,p.life);
      ctx.fillStyle = p.color;
      ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    drawTrail();
  }

  function loop(now){
    if(!running) return;
    const dt = now - lastTime; lastTime = now;
    update(dt);
    draw();
    requestAnimationFrame(loop);
  }

  document.getElementById('startBtn').addEventListener('click', ()=>{
    AC.resume();
    startScreen.classList.add('hidden');
    resetGame();
  });
  document.getElementById('retryBtn').addEventListener('click', ()=>{
    AC.resume();
    overScreen.classList.add('hidden');
    resetGame();
  });

  renderLives();
})();
