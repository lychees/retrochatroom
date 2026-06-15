const puppeteer = require('puppeteer-core');
const path = require('path');

const CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE_URL = 'http://localhost:3000';
const OUT_DIR = path.join(__dirname, '..', 'screenshots');

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function takeScreenshots() {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    defaultViewport: { width: 1280, height: 800 },
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();

  // 1. Login / homepage
  await page.goto(BASE_URL, { waitUntil: 'networkidle2' });
  await sleep(1500);
  await page.screenshot({ path: path.join(OUT_DIR, '01-home.png') });

  // Enter nickname and login
  await page.type('#nickname-input', '星际旅人');
  await page.evaluate(() => document.getElementById('login-btn').click());
  await sleep(1200);

  // 2. Lobby
  await page.screenshot({ path: path.join(OUT_DIR, '02-lobby.png') });

  // 3. Create room modal
  await page.evaluate(() => document.getElementById('create-room-btn').click());
  await sleep(700);
  await page.screenshot({ path: path.join(OUT_DIR, '03-create-room.png') });
  await page.evaluate(() => document.getElementById('cancel-create-btn').click());
  await sleep(500);

  // Helper to create a room
  async function createRoom(name, typeIndex) {
    await page.evaluate(() => document.getElementById('create-room-btn').click());
    await sleep(600);
    await page.evaluate((index) => {
      document.querySelectorAll('.type-option')[index].click();
    }, typeIndex);
    await page.type('#new-room-name', name);
    await page.evaluate(() => document.getElementById('confirm-create-btn').click());
    await sleep(1000);
  }

  // 4. Chat room
  await createRoom('深夜聊天室', 0);
  await page.type('#room-message-input', '大家好！');
  await page.evaluate(() => document.getElementById('room-send-btn').click());
  await sleep(700);
  await page.screenshot({ path: path.join(OUT_DIR, '04-chat.png') });

  // 5. Tea painting room
  await page.evaluate(() => document.getElementById('leave-room-btn').click());
  await sleep(700);
  await createRoom('茶绘房间', 1);
  // Draw a few strokes
  const paintCanvas = await page.$('.paint-canvas');
  const box = await paintCanvas.boundingBox();
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 150, { steps: 20 });
  await page.mouse.move(box.x + 150, box.y + 250, { steps: 20 });
  await page.mouse.up();
  await sleep(700);
  await page.screenshot({ path: path.join(OUT_DIR, '05-paint.png') });

  // 6. Draw-and-guess room
  await page.evaluate(() => document.getElementById('leave-room-btn').click());
  await sleep(700);
  await createRoom('你画我猜', 2);
  await page.screenshot({ path: path.join(OUT_DIR, '06-guess.png') });

  // 7. FC emulator room
  await page.evaluate(() => document.getElementById('leave-room-btn').click());
  await sleep(700);
  await createRoom('FC 模拟器', 3);
  // Select Contra
  await page.select('#fc-rom-select', 'Contra (U) [!].nes');
  await sleep(2500);
  // Click canvas to unlock audio
  const fcCanvas = await page.$('.fc-screen');
  const fcBox = await fcCanvas.boundingBox();
  await page.mouse.click(fcBox.x + fcBox.width / 2, fcBox.y + fcBox.height / 2);
  await sleep(4000);
  await page.screenshot({ path: path.join(OUT_DIR, '07-fc.png') });

  await browser.close();
  console.log('Screenshots saved to', OUT_DIR);
}

takeScreenshots().catch(err => {
  console.error('Screenshot failed:', err);
  process.exit(1);
});
