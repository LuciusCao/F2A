#!/usr/bin/env node

/**
 * F2A CLI Postinstall Script
 * 首次安装时显示引导信息
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

const f2aDir = path.join(os.homedir(), '.f2a');
const isFirstInstall = !fs.existsSync(f2aDir);

// 只在首次安装时显示引导
if (isFirstInstall) {
  console.log(`
╔════════════════════════════════════════════════════╗
║       🎉 F2A CLI - Friend-to-Agent Network         ║
╠════════════════════════════════════════════════════╣
║                                                    ║
║  First time? Initialize your node:                 ║
║                                                    ║
║    f2a init                                        ║
║                                                    ║
║  Then create your agent:                           ║
║                                                    ║
║    f2a agent init --name <name>                    ║
║                                                    ║
║  Documentation:                                    ║
║    https://github.com/LuciusCao/F2A                ║
║                                                    ║
╚════════════════════════════════════════════════════╝
`);
}