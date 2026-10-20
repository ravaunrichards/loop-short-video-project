import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Integration test starts an isolated copy with a temporary working directory.
test('health, registration, login and protected profile routes', async t => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'loop-test-'));
  const project = path.resolve(new URL('..', import.meta.url).pathname);
  const port = 34000 + Math.floor(Math.random() * 15000);
  const child = spawn(process.execPath, [path.join(project, 'server.js')], { cwd: temp, env: { ...process.env, PORT: String(port), DATA_DIR: path.join(temp, 'data'), UPLOAD_DIR: path.join(temp, 'uploads'), APP_SECRET: 'test-secret-at-least-32-characters-long' }, stdio: 'ignore' });
  t.after(async () => { child.kill('SIGTERM'); await rm(temp, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i=0; i<80; i++) { try { const r=await fetch(base+'/api/health'); if(r.ok){ready=true;break;} } catch {} await new Promise(r=>setTimeout(r,100)); }
  assert.equal(ready, true, 'server should start');
  const health=await (await fetch(base+'/api/health')).json(); assert.equal(health.ok,true);
  const reg=await fetch(base+'/api/auth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'test_creator',displayName:'Test Creator',password:'correct-horse-battery'})});
  assert.equal(reg.status,201); const account=await reg.json(); assert.ok(account.token); assert.equal(account.user.username,'test_creator');
  const me=await fetch(base+'/api/me',{headers:{authorization:`Bearer ${account.token}`}}); assert.equal(me.status,200); assert.equal((await me.json()).user.displayName,'Test Creator');
  const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'test_creator',password:'correct-horse-battery'})}); assert.equal(login.status,200);
  const bad=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'test_creator',password:'wrong-password'})}); assert.equal(bad.status,401);
});
