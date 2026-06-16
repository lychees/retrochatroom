#!/usr/bin/env node
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PROJECT_DIR = path.join(__dirname, '..');
const ROMS_DIR = path.join(PROJECT_DIR, 'public', 'roms');

function run(cmd, cwd = PROJECT_DIR) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit' });
}

function checkNode() {
  const version = process.version;
  const major = parseInt(version.slice(1).split('.')[0], 10);
  if (major < 18) {
    console.error('需要 Node.js 18 或更高版本');
    process.exit(1);
  }
  console.log(`Node.js: ${version}`);
}

function ensureRoms() {
  if (!fs.existsSync(ROMS_DIR)) fs.mkdirSync(ROMS_DIR, { recursive: true });
  const roms = fs.readdirSync(ROMS_DIR).filter(f => f.toLowerCase().endsWith('.nes'));
  if (roms.length === 0) {
    console.log('ROM 目录为空，正在下载...');
    run('node scripts/download-roms.js');
  } else {
    console.log(`检测到 ${roms.length} 个 ROM`);
  }
}

function main() {
  checkNode();
  run('npm install');
  ensureRoms();

  console.log('\n启动服务器，访问 http://localhost:3000');
  const server = spawn('npm start', {
    cwd: PROJECT_DIR,
    stdio: 'inherit',
    shell: true,
  });

  server.on('error', err => {
    console.error('启动失败:', err);
    process.exit(1);
  });
}

main();
