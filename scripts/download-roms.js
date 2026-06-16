const https = require('https');
const fs = require('fs');
const path = require('path');
const jsnes = require('jsnes');

const ROMS_DIR = path.join(__dirname, '..', 'public', 'roms');
const REPO_OWNER = 'zdg-kinlon';
const REPO_NAME = 'FC_ROMS';
const BRANCH = 'main';
const TARGET_COUNT = 10;

const REQUIRED_ROMS = [
  { path: 'ROM/0420/Contra (U) [!].nes', label: '魂斗罗' },
  { path: "ROM/0823/Chip 'n Dale Rescue Rangers (U) [!].nes", label: '松鼠大作战' },
];

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'retroblog3' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchJson(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}: ${url}`));
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function downloadRaw(rawPath, dest) {
  const rawUrl = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BRANCH}/${encodeURIComponent(rawPath)}`;
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(rawUrl, { headers: { 'User-Agent': 'retroblog3' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlinkSync(dest);
        return downloadRaw(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlinkSync(dest);
        return reject(new Error(`HTTP ${res.statusCode}: ${rawUrl}`));
      }
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      try { fs.unlinkSync(dest); } catch {}
      reject(err);
    });
  });
}

function validateRom(filePath) {
  try {
    const data = fs.readFileSync(filePath);
    const nes = new jsnes.NES({
      onFrame: () => {},
      onAudioSample: () => {},
      emulateSound: false,
    });
    nes.loadROM(data.toString('binary'));
    return true;
  } catch (e) {
    return false;
  }
}

function listRoms() {
  if (!fs.existsSync(ROMS_DIR)) return [];
  return fs.readdirSync(ROMS_DIR).filter(f => f.toLowerCase().endsWith('.nes'));
}

async function main() {
  if (!fs.existsSync(ROMS_DIR)) fs.mkdirSync(ROMS_DIR, { recursive: true });

  console.log('校验已有 ROM...');
  for (const name of listRoms()) {
    const dest = path.join(ROMS_DIR, name);
    const valid = validateRom(dest);
    console.log(`  ${valid ? '✓' : '✗'} ${name}`);
    if (!valid) {
      console.log(`    删除不支持的 ROM`);
      fs.unlinkSync(dest);
    }
  }

  console.log('下载必需 ROM...');
  for (const rom of REQUIRED_ROMS) {
    const filename = path.basename(rom.path);
    const dest = path.join(ROMS_DIR, filename);
    if (fs.existsSync(dest)) continue;
    console.log(`  下载: ${filename}`);
    await downloadRaw(rom.path, dest);
    if (!validateRom(dest)) {
      console.error(`  必需 ROM 验证失败: ${filename}`);
      process.exit(1);
    }
    console.log(`  ✓ 验证通过`);
  }

  console.log('随机挑选可用 ROM...');
  const treeUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/git/trees/${BRANCH}?recursive=1`;
  const tree = await fetchJson(treeUrl);
  const allNes = tree.tree
    .filter(item => item.type === 'blob' && item.path.endsWith('.nes'))
    .map(item => item.path);
  const requiredPaths = REQUIRED_ROMS.map(r => r.path);
  const candidates = allNes.filter(p => !requiredPaths.includes(p)).sort(() => Math.random() - 0.5);

  let count = listRoms().length;
  for (const romPath of candidates) {
    if (count >= TARGET_COUNT) break;
    const filename = path.basename(romPath);
    const dest = path.join(ROMS_DIR, filename);
    if (fs.existsSync(dest)) continue;
    console.log(`  尝试: ${filename}`);
    await downloadRaw(romPath, dest);
    if (validateRom(dest)) {
      console.log(`    ✓ 验证通过`);
      count++;
    } else {
      console.log(`    ✗ 不支持，删除`);
      fs.unlinkSync(dest);
    }
  }

  console.log(`完成，共 ${count} 个可用 ROM`);
  if (count < TARGET_COUNT) {
    console.warn(`警告：可用 ROM 数量不足 ${TARGET_COUNT} 个`);
  }
}

main().catch(err => {
  console.error('下载失败:', err.message);
  process.exit(1);
});
