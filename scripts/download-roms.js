const https = require('https');
const fs = require('fs');
const path = require('path');

const ROMS_DIR = path.join(__dirname, '..', 'public', 'roms');
const REPO_OWNER = 'zdg-kinlon';
const REPO_NAME = 'FC_ROMS';
const BRANCH = 'main';

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
      fs.unlinkSync(dest);
      reject(err);
    });
  });
}

async function main() {
  if (!fs.existsSync(ROMS_DIR)) fs.mkdirSync(ROMS_DIR, { recursive: true });

  console.log('正在获取 ROM 列表...');
  const treeUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/git/trees/${BRANCH}?recursive=1`;
  const tree = await fetchJson(treeUrl);
  const allNes = tree.tree.filter(item => item.type === 'blob' && item.path.endsWith('.nes')).map(item => item.path);

  const requiredPaths = REQUIRED_ROMS.map(r => r.path);
  const others = allNes.filter(p => !requiredPaths.includes(p));
  const shuffled = others.sort(() => Math.random() - 0.5);
  const random8 = shuffled.slice(0, 8);
  const toDownload = [...REQUIRED_ROMS.map(r => r.path), ...random8];

  console.log(`将下载 ${toDownload.length} 个 ROM:`);
  for (const romPath of toDownload) {
    const filename = path.basename(romPath);
    const dest = path.join(ROMS_DIR, filename);
    if (fs.existsSync(dest)) {
      console.log(`  已存在: ${filename}`);
      continue;
    }
    console.log(`  下载: ${filename}`);
    await downloadRaw(romPath, dest);
  }

  console.log('下载完成');
}

main().catch(err => {
  console.error('下载失败:', err.message);
  process.exit(1);
});
