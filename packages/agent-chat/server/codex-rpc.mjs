import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import readline from 'node:readline';

// Shared stdio JSON-RPC transport. Each host supplies its thread policies and
// event adapter; no document paths, permissions or agent instructions live here.
export class CodexRpc extends EventEmitter {
  constructor({ command = ['codex', 'app-server'], cwd, env = process.env }) {
    super(); this.command = command; this.cwd = cwd; this.env = env; this.seq = 0; this.calls = new Map();
  }
  start() {
    if (this.proc) return this.proc;
    const [file, ...args] = this.command;
    this.proc = spawn(file, args, { cwd: this.cwd, env: this.env, stdio: ['pipe', 'pipe', 'pipe'], shell: false });
    readline.createInterface({ input: this.proc.stdout }).on('line', line => {
      let msg; try { msg = JSON.parse(line); } catch { return; }
      if (msg.id !== undefined && !msg.method) {
        const call = this.calls.get(msg.id); if (!call) return;
        clearTimeout(call.timer); this.calls.delete(msg.id);
        msg.error ? call.reject(new Error(msg.error.message)) : call.resolve(msg.result); return;
      }
      this.emit(msg.id !== undefined ? 'request' : 'notification', msg);
    });
    const failed = error => {
      for (const call of this.calls.values()) { clearTimeout(call.timer); call.reject(error); }
      this.calls.clear(); this.proc = null;
    };
    this.proc.on('error', failed);
    this.proc.on('exit', () => failed(new Error('The agent connection stopped.')));
    this.proc.stdin.on('error', () => {});
    return this.proc;
  }
  call(method, params, timeout = 30000) {
    if (!this.proc) return Promise.reject(new Error('The agent connection is not running.'));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.calls.delete(id); reject(new Error(`Agent request timed out: ${method}`)); }, timeout);
      this.calls.set(id, { resolve, reject, timer }); this.send({ method, id, params });
    });
  }
  send(message) { this.proc?.stdin.write(JSON.stringify(message) + '\n'); }
  notify(method, params) { this.send({ method, params }); }
  reply(id, result) { this.send({ id, result }); }
  close() { this.proc?.kill(); }
}
