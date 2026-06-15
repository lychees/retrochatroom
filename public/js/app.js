(() => {
  const socket = io();

  let me = null;
  let currentRoom = null;
  let selectedType = 'chat';

  // ==================== DOM refs ====================
  const screens = {
    login: document.getElementById('login-screen'),
    lobby: document.getElementById('lobby-screen'),
    room: document.getElementById('room-screen'),
  };

  const loginInput = document.getElementById('nickname-input');
  const loginBtn = document.getElementById('login-btn');
  const roomListEl = document.getElementById('room-list');
  const lobbyMessages = document.getElementById('lobby-messages');
  const lobbyInput = document.getElementById('lobby-message-input');
  const lobbySend = document.getElementById('lobby-send-btn');
  const createRoomBtn = document.getElementById('create-room-btn');
  const createModal = document.getElementById('create-room-modal');
  const newRoomName = document.getElementById('new-room-name');
  const confirmCreate = document.getElementById('confirm-create-btn');
  const cancelCreate = document.getElementById('cancel-create-btn');
  const typeOptions = document.querySelectorAll('.type-option');
  const roomTitle = document.getElementById('room-title');
  const roomBadge = document.getElementById('room-type-badge');
  const roomUsersCount = document.getElementById('room-users-count');
  const roomCanvasArea = document.getElementById('room-canvas-area');
  const roomUsersEl = document.getElementById('room-users');
  const onlineCount = document.getElementById('online-count');
  const roomMessages = document.getElementById('room-messages');
  const roomInput = document.getElementById('room-message-input');
  const roomSend = document.getElementById('room-send-btn');
  const leaveRoomBtn = document.getElementById('leave-room-btn');

  // ==================== Starfield ====================
  const starCanvas = document.getElementById('starfield');
  const starCtx = starCanvas.getContext('2d');
  let stars = [];

  function resizeStars() {
    starCanvas.width = window.innerWidth;
    starCanvas.height = window.innerHeight;
    stars = [];
    for (let i = 0; i < 220; i++) {
      stars.push({
        x: Math.random() * starCanvas.width,
        y: Math.random() * starCanvas.height,
        size: Math.random() * 2 + 0.3,
        speed: Math.random() * 0.4 + 0.05,
        alpha: Math.random(),
        twinkle: Math.random() * 0.03 + 0.005,
      });
    }
  }

  function drawStars() {
    starCtx.clearRect(0, 0, starCanvas.width, starCanvas.height);
    starCtx.fillStyle = '#050510';
    starCtx.fillRect(0, 0, starCanvas.width, starCanvas.height);
    for (const s of stars) {
      s.y += s.speed;
      s.alpha += s.twinkle;
      if (s.y > starCanvas.height) { s.y = 0; s.x = Math.random() * starCanvas.width; }
      const a = 0.3 + Math.abs(Math.sin(s.alpha)) * 0.7;
      starCtx.fillStyle = `rgba(200, 230, 255, ${a})`;
      starCtx.beginPath();
      starCtx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
      starCtx.fill();
    }
    requestAnimationFrame(drawStars);
  }

  window.addEventListener('resize', resizeStars);
  resizeStars();
  drawStars();

  // ==================== Navigation ====================
  function showScreen(name) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[name].classList.add('active');
  }

  // ==================== Login ====================
  function doLogin() {
    const nick = loginInput.value.trim() || '星际旅人';
    socket.emit('user:join', { nickname: nick }, () => {
      me = { nickname: nick };
      document.getElementById('user-name').textContent = nick;
      showScreen('lobby');
    });
  }

  loginBtn.addEventListener('click', doLogin);
  loginInput.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  loginInput.focus();

  // ==================== Helpers ====================
  function typeLabel(type) {
    return { chat: '聊天', paint: '茶绘', guess: '你画我猜', fc: 'FC模拟器' }[type] || type;
  }

  function typeColor(type) {
    return { chat: '#00f3ff', paint: '#00ff88', guess: '#ffee00', fc: '#ff00aa' }[type] || '#fff';
  }

  function appendMessage(container, msg) {
    const div = document.createElement('div');
    div.className = `message ${msg.type}`;
    if (msg.type === 'system') {
      div.innerHTML = `<span class="time">${msg.time}</span><span class="text">${escapeHtml(msg.text)}</span>`;
    } else {
      div.innerHTML = `<span class="time">${msg.time}</span><span class="nick">${escapeHtml(msg.nickname)}:</span><span class="text">${escapeHtml(msg.text)}</span>`;
    }
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  }

  function escapeHtml(t) {
    return t.replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
  }

  function sendChat(containerInput, roomId) {
    const text = containerInput.value.trim();
    if (!text) return;
    socket.emit('room:message', { text });
    containerInput.value = '';
  }

  lobbySend.addEventListener('click', () => sendChat(lobbyInput, LOBBY_ID));
  lobbyInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(lobbyInput, LOBBY_ID); });

  roomSend.addEventListener('click', () => sendChat(roomInput, currentRoom?.id));
  roomInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(roomInput, currentRoom?.id); });

  leaveRoomBtn.addEventListener('click', () => socket.emit('room:leave'));

  // ==================== Create room ====================
  createRoomBtn.addEventListener('click', () => {
    createModal.classList.remove('hidden');
    newRoomName.focus();
  });
  cancelCreate.addEventListener('click', () => createModal.classList.add('hidden'));
  confirmCreate.addEventListener('click', () => {
    const name = newRoomName.value.trim() || '未命名房间';
    socket.emit('room:create', { name, type: selectedType });
    createModal.classList.add('hidden');
    newRoomName.value = '';
  });

  typeOptions.forEach(btn => {
    btn.addEventListener('click', () => {
      typeOptions.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedType = btn.dataset.type;
    });
  });

  // ==================== Room list ====================
  function renderRoomList(list) {
    roomListEl.innerHTML = '';
    if (list.length === 0) {
      roomListEl.innerHTML = '<div class="meta" style="padding:1rem;text-align:center;">暂无房间，快来创建一个吧！</div>';
      return;
    }
    for (const r of list) {
      const card = document.createElement('div');
      card.className = 'room-card';
      card.innerHTML = `
        <div class="info">
          <div class="name">${escapeHtml(r.name)}</div>
          <div class="meta">${typeLabel(r.type)} · ${r.userCount}/${r.maxUsers}</div>
        </div>
        <div class="badge" style="border-color:${typeColor(r.type)};color:${typeColor(r.type)}">${typeLabel(r.type)}</div>
      `;
      card.addEventListener('click', () => socket.emit('room:join', { roomId: r.id }));
      roomListEl.appendChild(card);
    }
  }

  socket.on('room:list', renderRoomList);

  // ==================== Join room ====================
  socket.on('room:joined', ({ room, me: m }) => {
    currentRoom = room;
    me = m;
    showScreen('room');
    roomTitle.textContent = room.name;
    roomBadge.textContent = typeLabel(room.type);
    roomBadge.style.borderColor = typeColor(room.type);
    roomBadge.style.color = typeColor(room.type);
    roomMessages.innerHTML = '';
    (room.messages || []).forEach(msg => appendMessage(roomMessages, msg));
    renderRoomUsers([]);
    setupRoomCanvas(room);
  });

  socket.on('room:users', users => {
    renderRoomUsers(users);
  });

  socket.on('room:message', msg => {
    const target = currentRoom && currentRoom.id === msg.roomId ? roomMessages : lobbyMessages;
    appendMessage(target, msg);
  });

  function renderRoomUsers(users) {
    roomUsersEl.innerHTML = '';
    onlineCount.textContent = users.length;
    roomUsersCount.textContent = `${users.length} 人在线`;
    for (const u of users) {
      const chip = document.createElement('div');
      chip.className = 'user-chip';
      chip.textContent = u.nickname;
      roomUsersEl.appendChild(chip);
    }
  }

  // ==================== Room canvas by type ====================
  let paintCanvas, guessCanvas, fcScreen;
  let isDrawing = false;
  let currentStroke = [];
  let currentColor = '#00f3ff';
  let currentWidth = 3;

  function setupRoomCanvas(room) {
    roomCanvasArea.innerHTML = '';
    if (room.type === 'chat') {
      roomCanvasArea.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-dim);">这是一个普通的聊天房间，在右侧和大家聊天吧。</div>`;
      return;
    }
    if (room.type === 'paint') {
      setupPaintRoom(room);
      return;
    }
    if (room.type === 'guess') {
      setupGuessRoom(room);
      return;
    }
    if (room.type === 'fc') {
      setupFCRoom(room);
      return;
    }
  }

  function makeToolbar(container, opts = {}) {
    const bar = document.createElement('div');
    bar.className = 'paint-toolbar';
    const colors = ['#00f3ff', '#ff00aa', '#00ff88', '#ffee00', '#ffffff', '#9d00ff', '#ff4400', '#000000'];
    colors.forEach(c => {
      const d = document.createElement('div');
      d.className = 'color-preset';
      d.style.background = c;
      d.addEventListener('click', () => { currentColor = c; if (opts.onColorChange) opts.onColorChange(c); });
      bar.appendChild(d);
    });
    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = currentColor;
    colorInput.addEventListener('input', e => { currentColor = e.target.value; if (opts.onColorChange) opts.onColorChange(e.target.value); });
    bar.appendChild(colorInput);

    const widthLabel = document.createElement('label');
    widthLabel.textContent = '粗细';
    bar.appendChild(widthLabel);
    const widthRange = document.createElement('input');
    widthRange.type = 'range';
    widthRange.min = 1;
    widthRange.max = 20;
    widthRange.value = currentWidth;
    widthRange.addEventListener('input', e => { currentWidth = parseInt(e.target.value, 10); if (opts.onWidthChange) opts.onWidthChange(currentWidth); });
    bar.appendChild(widthRange);

    if (opts.clearText) {
      const clearBtn = document.createElement('button');
      clearBtn.className = 'retro-btn small';
      clearBtn.textContent = opts.clearText;
      clearBtn.addEventListener('click', () => opts.onClear && opts.onClear());
      bar.appendChild(clearBtn);
    }
    container.appendChild(bar);
    return bar;
  }

  function setupCanvasDrawing(canvas, onStroke, opts = {}) {
    const ctx = canvas.getContext('2d');
    let drawing = false;
    let last = null;

    function getPos(e) {
      const rect = canvas.getBoundingClientRect();
      const evt = e.touches ? e.touches[0] : e;
      return {
        x: (evt.clientX - rect.left) * (canvas.width / rect.width),
        y: (evt.clientY - rect.top) * (canvas.height / rect.height),
      };
    }

    function start(e) {
      if (opts.readonly) return;
      drawing = true;
      last = getPos(e);
      currentStroke = [{ x: last.x, y: last.y }];
      e.preventDefault();
    }

    function move(e) {
      if (!drawing || opts.readonly) return;
      const p = getPos(e);
      ctx.strokeStyle = currentColor;
      ctx.lineWidth = currentWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      last = p;
      currentStroke.push({ x: p.x, y: p.y });
      e.preventDefault();
    }

    function end() {
      if (!drawing) return;
      drawing = false;
      if (currentStroke.length > 1 && onStroke) {
        onStroke([...currentStroke]);
      }
      currentStroke = [];
    }

    canvas.addEventListener('mousedown', start);
    canvas.addEventListener('mousemove', move);
    window.addEventListener('mouseup', end);
    canvas.addEventListener('touchstart', start, { passive: false });
    canvas.addEventListener('touchmove', move, { passive: false });
    canvas.addEventListener('touchend', end);

    return ctx;
  }

  function drawStrokeToCanvas(ctx, stroke) {
    if (!stroke.points || stroke.points.length < 2) return;
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
    for (let i = 1; i < stroke.points.length; i++) {
      ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
    }
    ctx.stroke();
  }

  // ==================== Paint room ====================
  function setupPaintRoom(room) {
    roomCanvasArea.innerHTML = '';
    const bar = makeToolbar(roomCanvasArea, {
      clearText: '清空画布',
      onClear: () => socket.emit('paint:clear'),
    });
    paintCanvas = document.createElement('canvas');
    paintCanvas.className = 'paint-canvas';
    paintCanvas.width = 1280;
    paintCanvas.height = 720;
    roomCanvasArea.appendChild(paintCanvas);

    const ctx = setupCanvasDrawing(paintCanvas, points => {
      socket.emit('paint:stroke', { points, color: currentColor, width: currentWidth });
    });

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, paintCanvas.width, paintCanvas.height);

    if (room.data && room.data.strokes) {
      room.data.strokes.forEach(s => drawStrokeToCanvas(ctx, s));
    }
  }

  socket.on('paint:stroke', stroke => {
    if (!paintCanvas) return;
    const ctx = paintCanvas.getContext('2d');
    drawStrokeToCanvas(ctx, stroke);
  });

  socket.on('paint:clear', () => {
    if (!paintCanvas) return;
    const ctx = paintCanvas.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, paintCanvas.width, paintCanvas.height);
  });

  // ==================== Guess room ====================
  let guessCtx;
  function setupGuessRoom(room) {
    roomCanvasArea.innerHTML = '';

    const statusBar = document.createElement('div');
    statusBar.className = 'guess-status';
    statusBar.innerHTML = `
      <div class="word" id="guess-word">等待开始...</div>
      <div class="timer" id="guess-timer">--</div>
    `;
    roomCanvasArea.appendChild(statusBar);

    const startBtn = document.createElement('button');
    startBtn.className = 'retro-btn primary guess-start-btn';
    startBtn.textContent = '开始游戏';
    startBtn.addEventListener('click', () => socket.emit('guess:start'));
    roomCanvasArea.appendChild(startBtn);

    const bar = makeToolbar(roomCanvasArea, {
      clearText: '清空',
      onClear: () => socket.emit('guess:clear'),
    });

    guessCanvas = document.createElement('canvas');
    guessCanvas.className = 'guess-canvas';
    guessCanvas.width = 1280;
    guessCanvas.height = 680;
    roomCanvasArea.appendChild(guessCanvas);

    const readonly = room.data && room.data.currentDrawer !== me.id;
    guessCtx = setupCanvasDrawing(guessCanvas, points => {
      socket.emit('guess:stroke', { points, color: currentColor, width: currentWidth });
    }, { readonly });

    guessCtx.fillStyle = '#0a0a18';
    guessCtx.fillRect(0, 0, guessCanvas.width, guessCanvas.height);

    if (room.data && room.data.canvasData) {
      room.data.canvasData.forEach(s => drawStrokeToCanvas(guessCtx, s));
    }

    updateGuessState(room.data || {});
  }

  function updateGuessState(data) {
    const wordEl = document.getElementById('guess-word');
    const timerEl = document.getElementById('guess-timer');
    if (!wordEl || !timerEl) return;

    if (data.status === 'drawing') {
      timerEl.textContent = data.timeLeft || 80;
      if (data.currentDrawer === me.id && data.currentWord) {
        wordEl.textContent = data.currentWord;
      } else if (data.wordHint) {
        wordEl.textContent = data.wordHint;
      } else if (data.currentWord) {
        wordEl.textContent = data.currentWord.replace(/./g, ' _');
      }
      if (guessCanvas) {
        const readonly = data.currentDrawer !== me.id;
        // We don't rebind events, just show overlay hint
      }
    } else {
      wordEl.textContent = '等待开始...';
      timerEl.textContent = '--';
    }
  }

  socket.on('guess:state', data => {
    if (currentRoom && currentRoom.type === 'guess') {
      Object.assign(currentRoom.data, data);
      updateGuessState(data);
    }
  });

  socket.on('guess:tick', ({ timeLeft }) => {
    const timerEl = document.getElementById('guess-timer');
    if (timerEl) timerEl.textContent = timeLeft;
  });

  socket.on('guess:word', ({ word }) => {
    const wordEl = document.getElementById('guess-word');
    if (wordEl) wordEl.textContent = word;
  });

  socket.on('guess:correct', ({ word }) => {
    addToast(`你猜对了！答案是：${word}`);
  });

  socket.on('guess:stroke', stroke => {
    if (!guessCtx) return;
    drawStrokeToCanvas(guessCtx, stroke);
  });

  socket.on('guess:clear', () => {
    if (!guessCtx) return;
    guessCtx.fillStyle = '#0a0a18';
    guessCtx.fillRect(0, 0, guessCanvas.width, guessCanvas.height);
  });

  // ==================== FC room (client-side emulation) ====================
  const FC_BUTTON = {
    BUTTON_A: 0,
    BUTTON_B: 1,
    BUTTON_SELECT: 2,
    BUTTON_START: 3,
    BUTTON_UP: 4,
    BUTTON_DOWN: 5,
    BUTTON_LEFT: 6,
    BUTTON_RIGHT: 7,
  };

  const FC_KEYS = {
    'ArrowUp': FC_BUTTON.BUTTON_UP,
    'ArrowDown': FC_BUTTON.BUTTON_DOWN,
    'ArrowLeft': FC_BUTTON.BUTTON_LEFT,
    'ArrowRight': FC_BUTTON.BUTTON_RIGHT,
    'z': FC_BUTTON.BUTTON_A,
    'x': FC_BUTTON.BUTTON_B,
    'Enter': FC_BUTTON.BUTTON_START,
    'Shift': FC_BUTTON.BUTTON_SELECT,
  };

  let fcPlayerSlot = 0;
  let fcKeysPressed = new Set();
  let fcNes = null;
  let fcCanvas = null;
  let fcCtx = null;
  let fcFrame = 0;
  let fcControllers = { 1: {}, 2: {} };
  let fcRunning = false;
  let fcLastFrameTime = 0;
  let fcAudioCtx = null;
  let fcAudioNode = null;
  let fcAudioQueue = [];
  let fcCurrentAudioChunk = new Float32Array(4096);
  let fcCurrentAudioIndex = 0;

  function initFCAudio() {
    if (fcAudioCtx) {
      if (fcAudioCtx.state === 'suspended') fcAudioCtx.resume();
      return;
    }
    try {
      fcAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const bufferSize = 2048;
      fcAudioNode = fcAudioCtx.createScriptProcessor(bufferSize, 0, 1);
      fcAudioNode.onaudioprocess = e => {
        const out = e.outputBuffer.getChannelData(0);
        let pos = 0;
        while (pos < out.length && fcAudioQueue.length > 0) {
          const chunk = fcAudioQueue[0];
          const avail = chunk.length - chunk.pos;
          const take = Math.min(avail, out.length - pos);
          out.set(chunk.data.subarray(chunk.pos, chunk.pos + take), pos);
          chunk.pos += take;
          pos += take;
          if (chunk.pos >= chunk.length) fcAudioQueue.shift();
        }
        while (pos < out.length) out[pos++] = 0;
      };
      fcAudioNode.connect(fcAudioCtx.destination);
    } catch (err) {
      console.error('init audio failed', err);
    }
  }

  function fcAudioWrite(sample) {
    if (!fcAudioNode) return;
    if (fcAudioCtx.state === 'suspended') fcAudioCtx.resume();
    fcCurrentAudioChunk[fcCurrentAudioIndex++] = sample;
    if (fcCurrentAudioIndex >= fcCurrentAudioChunk.length) {
      fcAudioQueue.push({ data: fcCurrentAudioChunk, pos: 0, length: fcCurrentAudioIndex });
      fcCurrentAudioChunk = new Float32Array(4096);
      fcCurrentAudioIndex = 0;
    }
  }

  function flushFCAudio() {
    if (fcCurrentAudioIndex > 0) {
      fcAudioQueue.push({ data: fcCurrentAudioChunk.subarray(0, fcCurrentAudioIndex), pos: 0, length: fcCurrentAudioIndex });
      fcCurrentAudioChunk = new Float32Array(4096);
      fcCurrentAudioIndex = 0;
    }
  }

  function setupFCRoom(room) {
    roomCanvasArea.innerHTML = '';
    const container = document.createElement('div');
    container.className = 'fc-container';

    fcCanvas = document.createElement('canvas');
    fcCanvas.className = 'fc-screen';
    fcCanvas.width = 256;
    fcCanvas.height = 240;
    container.appendChild(fcCanvas);

    const controls = document.createElement('div');
    controls.className = 'fc-controls';
    controls.innerHTML = `
      <div id="fc-slot1" class="slot inactive">玩家 1</div>
      <div id="fc-slot2" class="slot inactive">玩家 2</div>
      <select id="fc-rom-select" class="retro-btn small">
        <option value="">选择游戏...</option>
      </select>
      <button id="fc-load-btn" class="retro-btn small">随机加载</button>
      <button id="fc-reset-btn" class="retro-btn small">重置</button>
    `;
    container.appendChild(controls);

    const keymap = document.createElement('div');
    keymap.className = 'fc-keymap';
    keymap.innerHTML = '方向键移动 · Z=A · X=B · Enter=Start · Shift=Select · 仅房间前两名用户可操作 · 点击画面开启声音';
    container.appendChild(keymap);

    roomCanvasArea.appendChild(container);

    fcCtx = fcCanvas.getContext('2d');
    fcCtx.imageSmoothingEnabled = false;
    fcCtx.fillStyle = '#000';
    fcCtx.fillRect(0, 0, 256, 240);

    const romSelect = document.getElementById('fc-rom-select');
    function populateRomList(romList) {
      if (!romList || !romList.length) return;
      romSelect.innerHTML = '<option value="">选择游戏...</option>';
      romList.forEach(rom => {
        const opt = document.createElement('option');
        opt.value = rom.path;
        opt.textContent = rom.name;
        romSelect.appendChild(opt);
      });
    }

    romSelect.addEventListener('change', () => {
      const path = romSelect.value;
      if (path) socket.emit('fc:load', { romPath: path });
    });

    document.getElementById('fc-load-btn').addEventListener('click', () => {
      socket.emit('fc:load', { romPath: '' });
    });
    document.getElementById('fc-reset-btn').addEventListener('click', () => {
      socket.emit('fc:reset');
    });
    fcCanvas.addEventListener('click', () => initFCAudio());

    updateFCSlots(room.data?.playerSlots || []);
    populateRomList(room.data?.romList);

    container._populateRomList = populateRomList;
  }

  function renderFCFrame(frameBuffer) {
    if (!fcCtx) return;
    const imgData = fcCtx.createImageData(256, 240);
    const dst = imgData.data;
    for (let i = 0; i < frameBuffer.length; i++) {
      const pixel = frameBuffer[i];
      dst[i * 4 + 0] = (pixel >> 16) & 0xff;     // R
      dst[i * 4 + 1] = (pixel >> 8) & 0xff;      // G
      dst[i * 4 + 2] = pixel & 0xff;             // B
      dst[i * 4 + 3] = 255;                      // A
    }
    fcCtx.putImageData(imgData, 0, 0);
  }

  function updateFCSlots(slots) {
    const s1 = document.getElementById('fc-slot1');
    const s2 = document.getElementById('fc-slot2');
    if (!s1 || !s2) return;
    fcPlayerSlot = 0;
    s1.className = 'slot ' + (slots[0] ? 'active' : 'inactive');
    s2.className = 'slot ' + (slots[1] ? 'active' : 'inactive');
    if (slots[0] === me.id) { fcPlayerSlot = 1; s1.textContent = '玩家 1 (你)'; }
    else { s1.textContent = slots[0] ? '玩家 1' : '玩家 1 (空闲)'; }
    if (slots[1] === me.id) { fcPlayerSlot = 2; s2.textContent = '玩家 2 (你)'; }
    else { s2.textContent = slots[1] ? '玩家 2' : '玩家 2 (空闲)'; }
  }

  function applyFCControllers(controllers) {
    if (!fcNes) return;
    for (let c = 1; c <= 2; c++) {
      const state = controllers[c] || {};
      for (let btn = 0; btn < 8; btn++) {
        if (state[btn]) fcNes.buttonDown(c, btn);
        else fcNes.buttonUp(c, btn);
      }
    }
  }

  const FC_FRAME_TIME = 1000 / 60;

  function startFCLoop() {
    if (fcRunning) return;
    fcRunning = true;

    function loop(now) {
      if (!fcRunning) return;
      if (!fcNes) {
        requestAnimationFrame(loop);
        return;
      }

      if (fcLastFrameTime === 0) fcLastFrameTime = now;
      let elapsed = now - fcLastFrameTime;
      let frames = 0;
      while (elapsed >= FC_FRAME_TIME && frames < 5) {
        applyFCControllers(fcControllers);
        fcNes.frame();
        fcFrame++;
        elapsed -= FC_FRAME_TIME;
        fcLastFrameTime += FC_FRAME_TIME;
        frames++;
      }
      flushFCAudio();
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  }

  function stopFCGame() {
    fcRunning = false;
    fcNes = null;
    fcFrame = 0;
    fcControllers = { 1: {}, 2: {} };
    fcLastFrameTime = 0;
    if (fcCtx) {
      fcCtx.fillStyle = '#000';
      fcCtx.fillRect(0, 0, 256, 240);
    }
  }

  function loadFCGame({ romData, frame, state, controllers, romName }) {
    stopFCGame();
    if (!romData) return;

    try {
      initFCAudio();

      fcNes = new jsnes.NES({
        onFrame: renderFCFrame,
        onAudioSample: (left, right) => fcAudioWrite(left),
        emulateSound: true,
        sampleRate: 44100,
      });

      const romString = atob(romData);
      fcNes.loadROM(romString);

      // 使用默认调色板，颜色比 NTSC 更自然
      try {
        if (fcNes.ppu && fcNes.ppu.palTable && fcNes.ppu.palTable.loadDefaultPalette) {
          fcNes.ppu.palTable.loadDefaultPalette();
        }
      } catch (e) {
        console.error('load default palette failed', e);
      }

      if (state) {
        fcNes.fromJSON(state);
        fcFrame = frame || 0;
      } else {
        fcFrame = 0;
      }

      fcControllers = controllers || { 1: {}, 2: {} };
      fcLastFrameTime = 0;
      startFCLoop();
      addToast(`已加载 ROM：${romName}`);
    } catch (e) {
      console.error('loadFCGame error', e);
      addToast('ROM 加载失败：' + e.message);
    }
  }

  window.addEventListener('keydown', e => {
    if (!currentRoom || currentRoom.type !== 'fc') return;
    if (fcPlayerSlot === 0) return;
    const key = e.key;
    if (FC_KEYS[key] === undefined) return;
    if (fcKeysPressed.has(key)) return;
    fcKeysPressed.add(key);
    socket.emit('fc:button', { button: FC_KEYS[key], pressed: true });
    e.preventDefault();
  });

  window.addEventListener('keyup', e => {
    if (!currentRoom || currentRoom.type !== 'fc') return;
    if (fcPlayerSlot === 0) return;
    const key = e.key;
    if (FC_KEYS[key] === undefined) return;
    fcKeysPressed.delete(key);
    socket.emit('fc:button', { button: FC_KEYS[key], pressed: false });
    e.preventDefault();
  });

  socket.on('fc:init', (data) => {
    updateFCSlots(data.playerSlots || []);
    loadFCGame(data);
    const container = document.querySelector('.fc-container');
    if (container && container._populateRomList && data.romList) {
      container._populateRomList(data.romList);
    }
  });

  socket.on('fc:controllers', ({ controllers, playerSlots }) => {
    fcControllers = controllers || { 1: {}, 2: {} };
    updateFCSlots(playerSlots);
  });

  socket.on('fc:state', ({ frame, state, controllers, playerSlots, romList }) => {
    fcControllers = controllers || { 1: {}, 2: {} };
    updateFCSlots(playerSlots);
    if (state && fcNes) {
      try {
        fcNes.fromJSON(state);
        fcFrame = frame || 0;
        fcLastFrameTime = 0;
      } catch (e) {
        console.error('state load error', e);
      }
    }
    const container = document.querySelector('.fc-container');
    if (container && container._populateRomList && romList) {
      container._populateRomList(romList);
    }
  });

  socket.on('fc:error', ({ text }) => addToast(text));

  // ==================== Toast ====================
  function addToast(text) {
    const toast = document.createElement('div');
    toast.style.cssText = 'position:fixed;bottom:1.5rem;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.8);border:1px solid var(--neon-pink);color:var(--neon-pink);padding:0.6rem 1.2rem;border-radius:6px;z-index:200;';
    toast.textContent = text;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  socket.on('error', ({ text }) => addToast(text));
})();
