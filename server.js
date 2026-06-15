const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const jsnes = require('jsnes');
const https = require('https');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 5 * 1024 * 1024,
});

app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const LOBBY_ID = 'lobby';

const rooms = new Map();
const users = new Map();

const GUESS_WORDS = [
  '苹果', '香蕉', '猫', '狗', '房子', '汽车', '太阳', '月亮', '星星', '树',
  '花', '鱼', '鸟', '飞机', '船', '火车', '机器人', '火箭', '恐龙', '城堡',
  '彩虹', '雨伞', '冰淇淋', '蛋糕', '足球', '篮球', '自行车', '手机', '电脑', '书',
  '椅子', '桌子', '电视', '冰箱', '洗衣机', '吉他', '钢琴', '鼓', '小提琴', '帽子',
  '眼镜', '手表', '鞋子', '书包', '铅笔', '橡皮', '尺子', '剪刀', '胶水', '灯泡'
];

const FC_CONTRA_FILE = 'Contra (U) [!].nes';
const FC_CHIP_FILE = "Chip 'n Dale Rescue Rangers (U) [!].nes";
const FC_ROMS_DIR = path.join(__dirname, 'public', 'roms');
let fcAllRoms = [];

rooms.set(LOBBY_ID, {
  id: LOBBY_ID,
  name: '中央大厅',
  type: 'lobby',
  users: [],
  maxUsers: 100,
  messages: [],
  data: {},
});

function nowTime() {
  const d = new Date();
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function makeId(prefix = 'id') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function sanitize(str) {
  return String(str || '').trim().slice(0, 50);
}

function createRoomData(type) {
  if (type === 'paint') {
    return {
      strokes: [],
      currentStrokes: new Map(),
    };
  }
  if (type === 'guess') {
    return {
      status: 'waiting',
      round: 0,
      scores: {},
      drawerIndex: 0,
      currentDrawer: null,
      currentWord: '',
      guessedUsers: new Set(),
      timer: null,
      timeLeft: 0,
      canvasData: [],
    };
  }
  if (type === 'fc') {
    return {
      romPath: '',
      romName: '',
      romData: null,
      nes: null,
      running: false,
      frameTimer: null,
      stateTimer: null,
      frameCount: 0,
      lastState: null,
      controllers: { 1: {}, 2: {} },
      playerSlots: [null, null],
      romList: pickRomList(),
    };
  }
  return {};
}

function createRoom(name, type, hostId) {
  const maxUsers = type === 'fc' ? 4 : (type === 'guess' ? 8 : 20);
  const room = {
    id: makeId('room'),
    name: sanitize(name) || '未命名房间',
    type,
    hostId,
    users: [],
    maxUsers,
    messages: [],
    createdAt: Date.now(),
    data: createRoomData(type),
  };
  rooms.set(room.id, room);
  return room;
}

function broadcastRoomList() {
  const list = Array.from(rooms.values())
    .filter(r => r.id !== LOBBY_ID)
    .map(r => ({
      id: r.id,
      name: r.name,
      type: r.type,
      userCount: r.users.length,
      maxUsers: r.maxUsers,
      hostId: r.hostId,
    }));
  io.emit('room:list', list);
}

function broadcastRoomUsers(room) {
  io.to(room.id).emit('room:users', room.users.map(u => ({ id: u.id, nickname: u.nickname })));
}

function addMessage(room, msg) {
  const message = { ...msg, id: makeId('msg'), roomId: room.id, time: nowTime() };
  room.messages.push(message);
  if (room.messages.length > 200) room.messages.shift();
  io.to(room.id).emit('room:message', message);
}

function leaveAllRooms(socket) {
  const user = users.get(socket.id);
  if (!user) return;
  for (const room of rooms.values()) {
    const idx = room.users.findIndex(u => u.id === socket.id);
    if (idx !== -1) {
      room.users.splice(idx, 1);
      socket.leave(room.id);
      if (room.type === 'fc') {
        if (room.data.playerSlots[0] === socket.id) {
          room.data.playerSlots[0] = null;
          room.data.controllers[1] = {};
        }
        if (room.data.playerSlots[1] === socket.id) {
          room.data.playerSlots[1] = null;
          room.data.controllers[2] = {};
        }
        io.to(room.id).emit('fc:controllers', { controllers: room.data.controllers, playerSlots: room.data.playerSlots });
      }
      addMessage(room, {
        type: 'system',
        text: `${user.nickname} 离开了房间`,
      });
      broadcastRoomUsers(room);
      cleanupRoom(room);
    }
  }
}

function cleanupRoom(room) {
  if (room.id === LOBBY_ID) return;
  if (room.users.length === 0) {
    stopFCRoom(room);
    clearGuessTimer(room);
    rooms.delete(room.id);
    broadcastRoomList();
  } else if (room.hostId && !room.users.find(u => u.id === room.hostId)) {
    room.hostId = room.users[0].id;
    addMessage(room, { type: 'system', text: `${room.users[0].nickname} 成为了新房主` });
  }
}

function joinRoom(socket, roomId) {
  const user = users.get(socket.id);
  if (!user) return;
  const room = rooms.get(roomId);
  if (!room) return socket.emit('error', { text: '房间不存在' });
  if (room.users.length >= room.maxUsers) return socket.emit('error', { text: '房间已满' });

  leaveAllRooms(socket);

  room.users.push({ id: user.id, nickname: user.nickname });
  socket.join(room.id);
  user.roomId = room.id;

  if (room.type === 'fc') {
    const slot = getFCPlayerSlot(room, socket.id);
    if (slot > 0) {
      io.to(room.id).emit('fc:controllers', { controllers: room.data.controllers, playerSlots: room.data.playerSlots });
    }
  }

  socket.emit('room:joined', {
    room: {
      id: room.id,
      name: room.name,
      type: room.type,
      hostId: room.hostId,
      maxUsers: room.maxUsers,
      messages: room.messages.slice(-50),
      data: serializeRoomData(room),
    },
    me: { id: user.id, nickname: user.nickname },
  });

  addMessage(room, { type: 'system', text: `${user.nickname} 进入了房间` });
  broadcastRoomUsers(room);
  broadcastRoomList();

  if (room.type === 'fc') {
    syncFCUser(socket, room);
  }
}

function serializeRoomData(room) {
  if (room.type === 'paint') {
    return { strokes: room.data.strokes };
  }
  if (room.type === 'guess') {
    return {
      status: room.data.status,
      round: room.data.round,
      scores: room.data.scores,
      currentDrawer: room.data.currentDrawer,
      timeLeft: room.data.timeLeft,
      canvasData: room.data.canvasData,
    };
  }
  if (room.type === 'fc') {
    return {
      romName: room.data.romName,
      romPath: room.data.romPath,
      running: room.data.running,
      playerSlots: room.data.playerSlots,
      romList: room.data.romList,
    };
  }
  return {};
}

// ==================== 你画我猜 ====================

function clearGuessTimer(room) {
  if (room.data.timer) {
    clearInterval(room.data.timer);
    room.data.timer = null;
  }
}

function startGuessRound(room) {
  const data = room.data;
  if (room.users.length < 2) {
    data.status = 'waiting';
    io.to(room.id).emit('guess:state', serializeRoomData(room));
    return;
  }

  clearGuessTimer(room);
  data.guessedUsers = new Set();
  data.drawerIndex = data.drawerIndex % room.users.length;
  data.currentDrawer = room.users[data.drawerIndex].id;
  data.currentWord = GUESS_WORDS[Math.floor(Math.random() * GUESS_WORDS.length)];
  data.status = 'drawing';
  data.timeLeft = 80;
  data.canvasData = [];

  io.to(room.id).emit('guess:state', {
    ...serializeRoomData(room),
    wordHint: data.currentWord.replace(/./g, ' _'),
  });

  io.to(data.currentDrawer).emit('guess:word', { word: data.currentWord });
  addMessage(room, { type: 'system', text: `轮到 ${room.users[data.drawerIndex].nickname} 作画，大家快来猜！` });

  data.timer = setInterval(() => {
    data.timeLeft -= 1;
    io.to(room.id).emit('guess:tick', { timeLeft: data.timeLeft });
    if (data.timeLeft <= 0) {
      endGuessRound(room, false);
    }
  }, 1000);
}

function endGuessRound(room, guessed) {
  clearGuessTimer(room);
  const data = room.data;
  if (guessed) {
    addMessage(room, { type: 'system', text: `答案就是：${data.currentWord}！` });
  } else {
    addMessage(room, { type: 'system', text: `时间到！答案是：${data.currentWord}` });
  }

  data.drawerIndex = (data.drawerIndex + 1) % room.users.length;
  data.status = 'waiting';
  data.currentDrawer = null;
  data.currentWord = '';
  io.to(room.id).emit('guess:state', serializeRoomData(room));

  setTimeout(() => {
    if (room.users.length >= 2) startGuessRound(room);
  }, 3000);
}

function handleGuessAnswer(socket, text) {
  const user = users.get(socket.id);
  if (!user) return false;
  const room = rooms.get(user.roomId);
  if (!room || room.type !== 'guess' || room.data.status !== 'drawing') return false;
  if (socket.id === room.data.currentDrawer) return false;
  if (room.data.guessedUsers.has(socket.id)) return false;

  const answer = text.trim();
  if (answer === room.data.currentWord) {
    room.data.guessedUsers.add(socket.id);
    room.data.scores[socket.id] = (room.data.scores[socket.id] || 0) + 10 + room.data.timeLeft;
    if (room.data.currentDrawer) {
      room.data.scores[room.data.currentDrawer] = (room.data.scores[room.data.currentDrawer] || 0) + 5;
    }
    socket.emit('guess:correct', { word: answer });
    io.to(room.id).emit('guess:state', serializeRoomData(room));
    addMessage(room, { type: 'system', text: `${user.nickname} 猜对了！` });
    if (room.data.guessedUsers.size >= room.users.length - 1) {
      endGuessRound(room, true);
    }
    return true;
  }
  return false;
}

// ==================== FC 模拟器 ====================

function loadFCRomLibrary() {
  try {
    if (!fs.existsSync(FC_ROMS_DIR)) fs.mkdirSync(FC_ROMS_DIR, { recursive: true });
    fcAllRoms = fs.readdirSync(FC_ROMS_DIR).filter(f => f.toLowerCase().endsWith('.nes'));
    console.log(`FC ROM 库加载完成，共 ${fcAllRoms.length} 个`);
  } catch (e) {
    console.error('加载 ROM 列表失败', e.message);
    fcAllRoms = [FC_CONTRA_FILE, FC_CHIP_FILE];
  }
}

function pickRomList() {
  const required = [FC_CONTRA_FILE, FC_CHIP_FILE];
  const others = fcAllRoms.filter(p => !required.includes(p));
  const shuffled = others.sort(() => Math.random() - 0.5);
  const picked = shuffled.slice(0, 8);
  const list = [...required, ...picked].sort(() => Math.random() - 0.5);
  return list.map(filename => ({
    path: filename,
    name: filename.replace(/\.nes$/i, ''),
    url: `/roms/${encodeURIComponent(filename)}`,
  }));
}

async function loadFCROM(room, filename) {
  stopFCEmulator(room);

  let romInfo = null;
  if (filename) {
    try {
      const filePath = path.join(FC_ROMS_DIR, filename);
      const data = fs.readFileSync(filePath);
      romInfo = { name: filename, data };
      room.data.romPath = filename;
    } catch (e) {
      console.error('loadFCROM file error', e.message);
    }
  }
  if (!romInfo) {
    romInfo = pickRandomLocalROM();
    room.data.romPath = romInfo.name;
  }
  if (!romInfo) {
    io.to(room.id).emit('fc:error', { text: '无法加载 ROM，请检查 public/roms 目录' });
    return;
  }

  room.data.romName = romInfo.name;
  room.data.romData = romInfo.data;
  startFCEmulator(room);
  io.to(room.id).emit('fc:init', {
    romName: room.data.romName,
    romData: room.data.romData.toString('base64'),
    frame: room.data.frameCount,
    state: room.data.lastState,
    controllers: room.data.controllers,
    playerSlots: room.data.playerSlots,
    romList: room.data.romList,
  });
  addMessage(room, { type: 'system', text: `已加载 ROM：${romInfo.name}` });
}

function pickRandomLocalROM() {
  if (fcAllRoms.length === 0) return null;
  const name = fcAllRoms[Math.floor(Math.random() * fcAllRoms.length)];
  try {
    return { name, data: fs.readFileSync(path.join(FC_ROMS_DIR, name)) };
  } catch (e) {
    return null;
  }
}

function startFCEmulator(room) {
  const data = room.data;
  if (data.nes) return;
  if (!data.romData) return;

  data.nes = new jsnes.NES({
    onFrame: () => {},
    onAudioSample: () => {},
    emulateSound: true,
    sampleRate: 44100,
  });

  try {
    data.nes.loadROM(data.romData.toString('binary'));
  } catch (e) {
    console.error('loadROM error', e);
    io.to(room.id).emit('fc:error', { text: 'ROM 加载失败：' + e.message });
    data.nes = null;
    return;
  }

  data.running = true;
  data.frameCount = 0;

  //  authoritative frame loop: 60 fps, broadcast controller state each frame
  data.frameTimer = setInterval(() => {
    if (!data.nes || !data.running) return;

    for (let c = 1; c <= 2; c++) {
      const state = data.controllers[c] || {};
      for (const [btn, pressed] of Object.entries(state)) {
        const b = parseInt(btn, 10);
        if (pressed) data.nes.buttonDown(c, b);
        else data.nes.buttonUp(c, b);
      }
    }

    data.nes.frame();
    data.frameCount++;

    io.to(room.id).emit('fc:controllers', {
      frame: data.frameCount,
      controllers: data.controllers,
      playerSlots: data.playerSlots,
    });
  }, 1000 / 60);

  // save state every 2 seconds for late joiners / resync
  data.stateTimer = setInterval(() => {
    if (!data.nes || !data.running) return;
    try {
      data.lastState = data.nes.toJSON();
      io.to(room.id).emit('fc:state', {
        frame: data.frameCount,
        state: data.lastState,
        controllers: data.controllers,
        playerSlots: data.playerSlots,
        romName: data.romName,
      });
    } catch (e) {
      console.error('save state error', e);
    }
  }, 2000);
}

function stopFCEmulator(room) {
  if (room.type !== 'fc') return;
  const data = room.data;
  data.running = false;
  if (data.frameTimer) {
    clearInterval(data.frameTimer);
    data.frameTimer = null;
  }
  if (data.stateTimer) {
    clearInterval(data.stateTimer);
    data.stateTimer = null;
  }
  data.nes = null;
  data.frameCount = 0;
  data.lastState = null;
}

function stopFCRoom(room) {
  if (room.type !== 'fc') return;
  stopFCEmulator(room);
  room.data.controllers = { 1: {}, 2: {} };
  room.data.playerSlots = [null, null];
}

function syncFCUser(socket, room) {
  socket.emit('fc:init', {
    romName: room.data.romName,
    romData: room.data.romData ? room.data.romData.toString('base64') : null,
    frame: room.data.frameCount,
    state: room.data.lastState,
    controllers: room.data.controllers,
    playerSlots: room.data.playerSlots,
    romList: room.data.romList,
  });
}

function getFCPlayerSlot(room, socketId) {
  if (room.data.playerSlots[0] === socketId) return 1;
  if (room.data.playerSlots[1] === socketId) return 2;
  if (!room.data.playerSlots[0]) {
    room.data.playerSlots[0] = socketId;
    return 1;
  }
  if (!room.data.playerSlots[1]) {
    room.data.playerSlots[1] = socketId;
    return 2;
  }
  return 0;
}

function handleFCButton(socket, payload) {
  const user = users.get(socket.id);
  if (!user) return;
  const room = rooms.get(user.roomId);
  if (!room || room.type !== 'fc') return;

  const slot = getFCPlayerSlot(room, socket.id);
  if (slot === 0) return;

  const { button, pressed } = payload;
  room.data.controllers[slot][button] = pressed;
  io.to(room.id).emit('fc:controllers', { controllers: room.data.controllers, playerSlots: room.data.playerSlots });
}

// ==================== Socket.IO ====================

io.on('connection', (socket) => {
  socket.emit('room:list', Array.from(rooms.values())
    .filter(r => r.id !== LOBBY_ID)
    .map(r => ({
      id: r.id,
      name: r.name,
      type: r.type,
      userCount: r.users.length,
      maxUsers: r.maxUsers,
      hostId: r.hostId,
    })));

  socket.on('user:join', (payload, cb) => {
    const nickname = sanitize(payload.nickname) || '游客';
    const user = { id: socket.id, nickname, roomId: LOBBY_ID };
    users.set(socket.id, user);
    const lobby = rooms.get(LOBBY_ID);
    lobby.users.push(user);
    socket.join(LOBBY_ID);
    socket.emit('room:joined', {
      room: {
        id: lobby.id,
        name: lobby.name,
        type: lobby.type,
        messages: lobby.messages.slice(-50),
        data: {},
      },
      me: { id: user.id, nickname: user.nickname },
    });
    addMessage(lobby, { type: 'system', text: `${nickname} 连接到了大厅` });
    broadcastRoomUsers(lobby);
    if (cb) cb({ ok: true });
  });

  socket.on('room:create', (payload, cb) => {
    const user = users.get(socket.id);
    if (!user) return cb && cb({ ok: false, text: '请先登录' });
    const type = ['chat', 'paint', 'guess', 'fc'].includes(payload.type) ? payload.type : 'chat';
    const room = createRoom(payload.name, type, socket.id);
    joinRoom(socket, room.id);
    if (cb) cb({ ok: true, roomId: room.id });
  });

  socket.on('room:join', (payload, cb) => {
    joinRoom(socket, payload.roomId);
    if (cb) cb({ ok: true });
  });

  socket.on('room:leave', () => {
    const user = users.get(socket.id);
    if (!user) return;
    leaveAllRooms(socket);
    const lobby = rooms.get(LOBBY_ID);
    lobby.users.push({ id: user.id, nickname: user.nickname });
    socket.join(LOBBY_ID);
    user.roomId = LOBBY_ID;
    socket.emit('room:joined', {
      room: {
        id: lobby.id,
        name: lobby.name,
        type: lobby.type,
        messages: lobby.messages.slice(-50),
        data: {},
      },
      me: { id: user.id, nickname: user.nickname },
    });
    broadcastRoomUsers(lobby);
    broadcastRoomList();
  });

  socket.on('room:message', (payload) => {
    const user = users.get(socket.id);
    if (!user) return;
    const room = rooms.get(user.roomId);
    if (!room) return;
    const text = sanitize(payload.text);
    if (!text) return;

    if (room.type === 'guess' && room.data.status === 'drawing') {
      const guessed = handleGuessAnswer(socket, text);
      if (guessed) return;
    }

    addMessage(room, {
      type: 'chat',
      nickname: user.nickname,
      userId: user.id,
      text: text,
    });
  });

  // 茶绘
  socket.on('paint:stroke', (payload) => {
    const user = users.get(socket.id);
    if (!user) return;
    const room = rooms.get(user.roomId);
    if (!room || room.type !== 'paint') return;
    const stroke = {
      id: makeId('stroke'),
      userId: socket.id,
      points: payload.points || [],
      color: payload.color || '#ffffff',
      width: payload.width || 2,
    };
    room.data.strokes.push(stroke);
    if (room.data.strokes.length > 500) room.data.strokes.shift();
    socket.to(room.id).emit('paint:stroke', stroke);
  });

  socket.on('paint:clear', () => {
    const user = users.get(socket.id);
    if (!user) return;
    const room = rooms.get(user.roomId);
    if (!room || room.type !== 'paint') return;
    room.data.strokes = [];
    io.to(room.id).emit('paint:clear');
    addMessage(room, { type: 'system', text: `${user.nickname} 清空了画布` });
  });

  // 你画我猜绘画
  socket.on('guess:stroke', (payload) => {
    const user = users.get(socket.id);
    if (!user) return;
    const room = rooms.get(user.roomId);
    if (!room || room.type !== 'guess') return;
    if (room.data.status !== 'drawing' || room.data.currentDrawer !== socket.id) return;
    const stroke = {
      id: makeId('stroke'),
      userId: socket.id,
      points: payload.points || [],
      color: payload.color || '#ffffff',
      width: payload.width || 4,
    };
    room.data.canvasData.push(stroke);
    if (room.data.canvasData.length > 200) room.data.canvasData.shift();
    socket.to(room.id).emit('guess:stroke', stroke);
  });

  socket.on('guess:clear', () => {
    const user = users.get(socket.id);
    if (!user) return;
    const room = rooms.get(user.roomId);
    if (!room || room.type !== 'guess') return;
    if (room.data.status !== 'drawing' || room.data.currentDrawer !== socket.id) return;
    room.data.canvasData = [];
    io.to(room.id).emit('guess:clear');
  });

  socket.on('guess:start', () => {
    const user = users.get(socket.id);
    if (!user) return;
    const room = rooms.get(user.roomId);
    if (!room || room.type !== 'guess') return;
    if (room.data.status !== 'waiting') return;
    if (room.users.length < 2) {
      return socket.emit('error', { text: '至少需要 2 人才能开始' });
    }
    startGuessRound(room);
  });

  // FC
  socket.on('fc:load', async (payload) => {
    const user = users.get(socket.id);
    if (!user) return;
    const room = rooms.get(user.roomId);
    if (!room || room.type !== 'fc') return;
    await loadFCROM(room, payload.romPath || '');
    broadcastRoomList();
  });

  socket.on('fc:button', (payload) => {
    handleFCButton(socket, payload);
  });

  socket.on('fc:reset', () => {
    const user = users.get(socket.id);
    if (!user) return;
    const room = rooms.get(user.roomId);
    if (!room || room.type !== 'fc') return;
    if (room.data.nes) {
      room.data.frameCount = 0;
      try {
        room.data.nes.loadROM(room.data.romData.toString('binary'));
      } catch (e) {
        console.error('reset error', e);
      }
    }
  });

  socket.on('disconnect', () => {
    leaveAllRooms(socket);
    users.delete(socket.id);
  });
});

loadFCRomLibrary();
server.listen(PORT, () => {
  console.log(`星空主页已启动: http://localhost:${PORT}`);
});
