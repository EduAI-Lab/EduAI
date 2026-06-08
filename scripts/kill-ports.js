'use strict';
const { execSync } = require('node:child_process');

const PORTS = [3000, 3001, 3002, 3003, 4000, 5173, 8000];

if (process.platform === 'win32') {
  let netstat = '';
  try {
    netstat = execSync('netstat -ano', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {}

  for (const port of PORTS) {
    const pids = new Set();
    for (const line of netstat.split('\n')) {
      // Match ":PORT " (local-address column) or ":PORT\r" (end of line)
      if (line.includes(`:${port} `) || line.includes(`:${port}\r`)) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && /^\d+$/.test(pid) && pid !== '0') pids.add(pid);
      }
    }
    for (const pid of pids) {
      try {
        execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
      } catch {}
    }
  }
} else {
  for (const port of PORTS) {
    try {
      execSync(`lsof -ti :${port} 2>/dev/null | xargs kill -9 2>/dev/null`, {
        shell: true,
        stdio: 'ignore',
      });
    } catch {}
  }
}
