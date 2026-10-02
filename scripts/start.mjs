// Launch the built app. Strips ELECTRON_RUN_AS_NODE (set by VS Code terminals),
// which would otherwise make Electron start as plain Node.js.
import { spawn } from 'node:child_process';
import electronPath from 'electron';

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electronPath, ['.'], { stdio: 'inherit', env });
child.on('exit', (code) => process.exit(code ?? 0));
