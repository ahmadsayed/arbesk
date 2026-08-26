# Arbesk Live Side Viewer (dynamic Cordis Plugin)

A DeepSeek Harness **dynamic Cordis Plugin** that docks a live side panel into the
harness GUI for this workspace. It embeds the running Arbesk Studio
(`http://localhost:9090/`), auto-reloads it on build output changes, runs the
dev/testnet stack, and shows a split console (Node + the app's forwarded
browser logs).

> **Important:** this is a *dynamic* plugin. It is defined with `cordis_define`
> and activated with `cordis_run`, and it exists **only in the running DSH
> process** — it is **not** a file that DSH auto-loads, and it does **not**
> survive a DSH restart. This file preserves the source so it can be re-defined.

## How to see it now

It is already running in the current session. In the DeepSeek Harness GUI
(`http://127.0.0.1:3080`) it is the **"Arbesk Live"** panel docked on the right
edge. If it looks gone, it is collapsed — click the slim vertical **"Arbesk Live"**
tab on the far right edge to expand it.

## Prerequisites (Arbesk-side files it depends on)

The plugin's **App** console tab reads the app's browser console, which is
forwarded by these repo files:

- `src/api/routes/dev-console.ts` — `POST /api/v1/dev/console` echoes entries to
  stdout as `[BROWSER] <level> <text>`.
- `src/api/index.ts` — mounts the route under `/api/v1/dev`.
- `frontend/src/pug/includes/head.pug` — the console bridge shim.

For the shim to be active, rebuild the frontend and restart the backend
(the panel's **Start** does both).

## Re-loading the plugin after a DSH restart

Use the host and client source below with the `cordis_define` tool (existing
plugin `arbesk-1`, or a new one), then `cordis_run` with `update`/`run`.

### Host half

```js
return {
  apply(ctx) {
    const shell = ctx.get('shell')
    const policy = ctx.get('sandboxPolicy')
    const root = (policy && policy.workspaceRoot) || '/home/ahmedh/Projects/arbesk'
    const watched = ['frontend/dist', 'src', 'packages/asset-core/dist']
    const findNL = String.fromCharCode(92) + 'n'
    const NL = String.fromCharCode(10)

    let proc = null
    let mode = null
    let logText = ''
    let browserText = ''
    let pending = ''

    function pushLog(s) {
      logText = (logText + String(s)).slice(-8000)
    }

    function pushLine(line) {
      if (line.indexOf('[BROWSER]') === 0) {
        browserText = (browserText + line + NL).slice(-8000)
      } else {
        logText = (logText + line + NL).slice(-8000)
      }
    }

    function drain() {
      if (!proc) return
      try {
        const r = proc.readOutput()
        if (!r || !r.delta) return
        pending += r.delta
        const idx = pending.lastIndexOf(NL)
        if (idx === -1) return
        const complete = pending.slice(0, idx + 1)
        pending = pending.slice(idx + 1)
        const parts = complete.split(NL)
        for (let i = 0; i < parts.length; i++) {
          const line = parts[i]
          if (line) pushLine(line)
        }
      } catch (e) {}
    }

    async function snapshot() {
      if (shell === undefined) return { mtime: 0, file: '', error: 'shell service unavailable' }
      const cmd = 'find ' + watched.join(' ') + " -type f -printf '%T@ %p" + findNL + "' 2>/dev/null | sort -n | tail -n 1"
      try {
        const spec = shell.resolve({ command: cmd, workdir: root, timeoutMs: 3000, stdoutMaxBytes: 8192 })
        const res = await shell.run(spec)
        const text = (res && res.stdout && res.stdout.text) || ''
        const line = String(text).trim()
        if (!line) return { mtime: 0, file: '', error: 'no watched files yet' }
        const sp = line.indexOf(' ')
        const mtimeStr = sp === -1 ? line : line.slice(0, sp)
        const file = sp === -1 ? '' : line.slice(sp + 1)
        const mtime = Number(mtimeStr)
        return { mtime: Number.isFinite(mtime) ? mtime : 0, file }
      } catch (err) {
        return { mtime: 0, file: '', error: String((err && err.message) || err) }
      }
    }

    async function start(args) {
      if (shell === undefined) return { ok: false, error: 'shell service unavailable' }
      const targetMode = args && args.mode
      if (targetMode !== 'local' && targetMode !== 'testnet') {
        return { ok: false, error: 'unknown mode: ' + targetMode }
      }
      if (proc) {
        try { proc.kill() } catch (e) {}
        pushLog('[stopped previous process]' + NL)
        proc = null
      }
      mode = targetMode
      logText = ''
      browserText = ''
      pending = ''
      const cmd = targetMode === 'testnet' ? './scripts/start-dev.sh --testnet' : './scripts/start-dev.sh'
      pushLog('[start] ' + cmd + NL)
      try {
        const spec = shell.resolve({ command: cmd, workdir: root })
        proc = shell.start(spec)
        return { ok: true }
      } catch (err) {
        const msg = String((err && err.message) || err)
        pushLog('[start error] ' + msg + NL)
        return { ok: false, error: msg }
      }
    }

    async function stop() {
      if (!proc) return { ok: true, stopped: false }
      try { proc.kill() } catch (e) {}
      pushLog('[stopped]' + NL)
      proc = null
      return { ok: true, stopped: true }
    }

    async function clearLog(args) {
      const target = args && args.target
      if (target === 'app') { browserText = ''; return { ok: true } }
      logText = ''
      return { ok: true }
    }

    async function forceStop(args) {
      if (shell === undefined) return { ok: false, error: 'shell service unavailable' }
      const isLocal = (args && args.local === true) || mode === 'local'
      // danger-full-access runs the kill outside the sandbox PID namespace so
      // fuser/lsof/pkill can see and kill the host backend on :9090.
      const fullAccess = { mode: 'danger-full-access', workspaceRoot: root }
      const steps = []
      if (proc) {
        try { proc.kill() } catch (e) {}
        proc = null
        pushLog('[force] stopped tracked launcher' + NL)
        steps.push('launcher')
      }
      try {
        const cmd = "fuser -k -9 9090/tcp 2>/dev/null; lsof -ti tcp:9090 2>/dev/null | xargs -r kill -9 2>/dev/null; pkill -9 -f '[s]rc/index.ts' 2>/dev/null; echo done"
        const spec = shell.resolve({ command: cmd, workdir: root, timeoutMs: 8000, sandboxPolicy: fullAccess })
        const res = await shell.run(spec)
        const out = String((res && res.stdout && res.stdout.text) || '').trim()
        pushLog('[force] port 9090 + node backend: ' + out + NL)
        steps.push('port9090')
      } catch (e) {
        pushLog('[force] port kill error: ' + String((e && e.message) || e) + NL)
      }
      if (isLocal) {
        try {
          const ps = shell.resolve({ command: './scripts/start-dev.sh --print-project', workdir: root, timeoutMs: 5000, sandboxPolicy: fullAccess })
          const pr = await shell.run(ps)
          const proj = String((pr && pr.stdout && pr.stdout.text) || '').trim()
          const downCmd = proj ? ('docker compose -p ' + proj + ' down --remove-orphans 2>&1 | tail -n 5') : 'docker compose down --remove-orphans 2>&1 | tail -n 5'
          const ds = shell.resolve({ command: downCmd, workdir: root, timeoutMs: 30000, sandboxPolicy: fullAccess })
          await shell.run(ds)
          pushLog('[force] docker down (' + (proj || 'default') + ')' + NL)
          steps.push('docker')
        } catch (e) {
          pushLog('[force] docker down error: ' + String((e && e.message) || e) + NL)
        }
      }
      return { ok: true, steps: steps }
    }

    async function status() {
      drain()
      const p = proc
      return {
        running: !!(p && p.status === 'running'),
        mode: mode,
        procStatus: p ? p.status : null,
        exitCode: p ? p.exitCode : null,
        log: logText.slice(-4000),
        browserLog: browserText.slice(-4000),
      }
    }

    harness.handle('snapshot', snapshot)
    harness.handle('start', start)
    harness.handle('stop', stop)
    harness.handle('clearLog', clearLog)
    harness.handle('forceStop', forceStop)
    harness.handle('status', status)
  },
}
```

### Client half

```js
return {
  inject: ['timer'],
  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return

    const APP_URL = 'http://localhost:9090/'
    const NL = String.fromCharCode(10)
    let consoleEl = null

    styles.insert(
      '.arbesk-live-panel{position:fixed;top:0;right:0;bottom:0;display:flex;flex-direction:column;background:#1f2430;border-left:1px solid #3a4152;box-shadow:-8px 0 30px rgba(0,0,0,0.4);font-family:system-ui,sans-serif;color:#e6e9f0;pointer-events:auto;}' +
      '.arbesk-live-resize{position:absolute;left:0;top:0;bottom:0;width:5px;cursor:col-resize;z-index:6;}' +
      '.arbesk-live-resize:hover,.arbesk-live-resize.active{background:rgba(255,255,255,0.18);}' +
      '.arbesk-live-header{display:flex;align-items:center;gap:8px;padding:8px 10px;background:#262c3a;border-bottom:1px solid #3a4152;user-select:none;}' +
      '.arbesk-live-title{font-weight:600;font-size:13px;white-space:nowrap;}' +
      '.arbesk-live-status{font-size:11px;opacity:0.75;margin-left:auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:150px;}' +
      '.arbesk-live-btn{border:1px solid #3a4152;background:transparent;color:inherit;border-radius:6px;padding:2px 8px;font-size:12px;cursor:pointer;white-space:nowrap;}' +
      '.arbesk-live-btn:hover{background:rgba(255,255,255,0.08);}' +
      '.arbesk-live-btn:disabled{opacity:0.45;cursor:default;}' +
      '.arbesk-live-btn.danger{border-color:#7f1d1d;color:#fca5a5;}' +
      '.arbesk-live-btn.danger:hover{background:rgba(239,68,68,0.15);}' +
      '.arbesk-live-toolbar{display:flex;align-items:center;gap:6px;padding:6px 8px;background:#232936;border-bottom:1px solid #3a4152;flex-wrap:wrap;}' +
      '.arbesk-live-seg{display:flex;border:1px solid #3a4152;border-radius:6px;overflow:hidden;}' +
      '.arbesk-live-seg-btn{border:0;background:transparent;color:inherit;padding:3px 10px;font-size:12px;cursor:pointer;}' +
      '.arbesk-live-seg-btn.active{background:#3b82f6;color:#fff;}' +
      '.arbesk-live-runlabel{font-size:11px;opacity:0.75;margin-left:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1 1 auto;min-width:40px;}' +
      '.arbesk-live-frame{flex:1 1 auto;border:0;width:100%;background:#fff;}' +
      '.arbesk-live-footer{display:flex;align-items:center;gap:8px;padding:4px 10px;font-size:11px;opacity:0.7;border-top:1px solid #3a4152;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
      '.arbesk-live-console{display:flex;flex-direction:column;border-top:1px solid #3a4152;background:#15181f;max-height:200px;}' +
      '.arbesk-live-console-head{display:flex;align-items:center;gap:8px;padding:4px 8px;border-bottom:1px solid #3a4152;font-size:11px;color:#c9d1d9;}' +
      '.arbesk-live-console-title{font-weight:600;margin-right:auto;}' +
      '.arbesk-live-console-body{margin:0;padding:8px;font-size:10px;line-height:1.4;font-family:ui-monospace,Menlo,Consolas,monospace;color:#c9d1d9;flex:1 1 auto;overflow:auto;white-space:pre-wrap;word-break:break-word;min-height:0;}' +
      '.arbesk-live-tab{position:fixed;top:0;right:0;bottom:0;width:30px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;background:#1f2430;border-left:1px solid #3a4152;color:#e6e9f0;cursor:pointer;pointer-events:auto;}' +
      '.arbesk-live-tab:hover{background:#262c3a;}' +
      '.arbesk-live-tab-label{writing-mode:vertical-rl;font-size:11px;letter-spacing:1px;font-weight:600;}' +
      '.arbesk-live-tab-chev{font-size:12px;}'
    )

    function timeNow() { return new Date().toLocaleTimeString() }

    function LiveViewer() {
      const [frameKey, setFrameKey] = React.useState(0)
      const [status, setStatus] = React.useState('starting…')
      const [lastFile, setLastFile] = React.useState('')
      const [lastReload, setLastReload] = React.useState(null)
      const [modeSel, setModeSel] = React.useState('local')
      const [run, setRun] = React.useState(null)
      const [showConsole, setShowConsole] = React.useState(false)
      const [consoleTab, setConsoleTab] = React.useState('node')
      const [busy, setBusy] = React.useState(false)
      const [width, setWidth] = React.useState(460)
      const [collapsed, setCollapsed] = React.useState(false)
      const [resizing, setResizing] = React.useState(null)
      const [maximized, setMaximized] = React.useState(false)
      const [savedWidth, setSavedWidth] = React.useState(460)

      React.useEffect(() => {
        const reserve = collapsed ? 30 : width
        const dispose = styles.insert('.pI_x6G_centerCol{padding-right:' + reserve + 'px !important;}')
        return dispose
      }, [width, collapsed])

      React.useEffect(() => {
        let alive = true
        let baseline = 0
        async function poll() {
          try {
            const snap = await host.call('snapshot')
            if (alive && snap && !snap.error) {
              const mtime = Number(snap.mtime) || 0
              if (mtime) {
                if (!baseline) { baseline = mtime; setStatus('watching') }
                else if (mtime > baseline) {
                  baseline = mtime
                  setLastFile(snap.file || '')
                  setFrameKey(k => k + 1)
                  setLastReload(timeNow())
                  setStatus('updated')
                }
              }
            }
          } catch (e) {}
          try {
            const s = await host.call('status')
            if (alive && s) setRun(s)
          } catch (e) {}
        }
        poll()
        const stop = ctx.interval(poll, 1000)
        return () => { alive = false; stop() }
      }, [])

      React.useEffect(() => {
        if (consoleEl) consoleEl.scrollTop = consoleEl.scrollHeight
      })

      function reload() {
        setFrameKey(k => k + 1)
        setLastReload(timeNow())
        setStatus('manual reload')
      }

      async function startRun() {
        setBusy(true)
        try { await host.call('start', { mode: modeSel }) } catch (e) {}
        setBusy(false)
      }
      async function stopRun() {
        setBusy(true)
        try { await host.call('stop') } catch (e) {}
        setBusy(false)
      }
      async function forceStop() {
        setBusy(true)
        try { await host.call('forceStop', { local: modeSel === 'local' }) } catch (e) {}
        setBusy(false)
      }
      function clearConsole() {
        try { host.call('clearLog', { target: consoleTab }) } catch (e) {}
      }

      function toggleMaximize(e) {
        const win = e && e.currentTarget && e.currentTarget.ownerDocument ? e.currentTarget.ownerDocument.defaultView : null
        const vw = (win && win.innerWidth) ? win.innerWidth : 1400
        if (maximized) {
          setWidth(savedWidth)
          setMaximized(false)
        } else {
          setSavedWidth(width)
          setWidth(vw)
          setMaximized(true)
        }
      }

      function onResizeDown(e) {
        const win = e.currentTarget.ownerDocument && e.currentTarget.ownerDocument.defaultView
        const vw = (win && win.innerWidth) ? win.innerWidth : 1400
        e.currentTarget.setPointerCapture(e.pointerId)
        setMaximized(false)
        setResizing({ startX: e.clientX, startW: width, maxW: vw })
      }
      function onResizeMove(e) {
        if (!resizing) return
        let w = resizing.startW + (resizing.startX - e.clientX)
        if (w < 280) w = 280
        if (w > resizing.maxW) w = resizing.maxW
        setWidth(w)
      }
      function onResizeUp() { setResizing(null) }

      const running = !!(run && run.running)
      const runMode = run && run.mode
      let runLabel = 'idle'
      if (running) runLabel = 'running ' + (runMode === 'testnet' ? 'testnet' : 'local')
      else if (run && run.procStatus === 'completed') runLabel = 'exited' + (run.exitCode != null ? ' (' + run.exitCode + ')' : '')
      else if (run && run.procStatus === 'killed') runLabel = 'stopped'

      const tab = React.createElement('div', {
        className: 'arbesk-live-tab',
        style: { display: collapsed ? 'flex' : 'none' },
        onClick: () => setCollapsed(false),
        title: 'Expand Arbesk Live',
      },
        React.createElement('span', { className: 'arbesk-live-tab-label' }, 'Arbesk Live'),
        React.createElement('span', { className: 'arbesk-live-tab-chev' }, '❮'),
      )

      const consoleBody = showConsole ? React.createElement('div', { className: 'arbesk-live-console' },
        React.createElement('div', { className: 'arbesk-live-console-head' },
          React.createElement('span', { className: 'arbesk-live-console-title' }, 'Console'),
          React.createElement('div', { className: 'arbesk-live-seg' },
            React.createElement('button', { className: 'arbesk-live-seg-btn' + (consoleTab === 'node' ? ' active' : ''), onClick: () => setConsoleTab('node') }, 'Node'),
            React.createElement('button', { className: 'arbesk-live-seg-btn' + (consoleTab === 'app' ? ' active' : ''), onClick: () => setConsoleTab('app') }, 'App'),
          ),
          React.createElement('button', { className: 'arbesk-live-btn', onClick: clearConsole, title: 'Clear console' }, 'Clear'),
        ),
        React.createElement('pre', { className: 'arbesk-live-console-body', ref: function (el) { consoleEl = el } },
          consoleTab === 'app'
            ? ((run && run.browserLog) || '(no app browser logs — start the stack via the panel after the shim build)')
            : ((run && run.log) || ''),
        ),
      ) : null

      const panel = React.createElement('div', {
        className: 'arbesk-live-panel',
        style: { width: width + 'px', display: collapsed ? 'none' : 'flex' },
      },
        React.createElement('div', {
          className: 'arbesk-live-resize' + (resizing ? ' active' : ''),
          onPointerDown: onResizeDown, onPointerMove: onResizeMove, onPointerUp: onResizeUp, onPointerCancel: onResizeUp,
        }),
        React.createElement('div', { className: 'arbesk-live-header' },
          React.createElement('span', { className: 'arbesk-live-title' }, 'Arbesk Live'),
          React.createElement('span', { className: 'arbesk-live-status' }, status),
          React.createElement('button', { className: 'arbesk-live-btn', onClick: toggleMaximize, title: maximized ? 'Restore size' : 'Maximize' }, maximized ? '⤡' : '⤢'),
          React.createElement('button', { className: 'arbesk-live-btn', onClick: reload, title: 'Reload now' }, '↻'),
          React.createElement('button', { className: 'arbesk-live-btn', onClick: () => setCollapsed(true), title: 'Collapse' }, '❯'),
        ),
        React.createElement('div', { className: 'arbesk-live-toolbar' },
          React.createElement('div', { className: 'arbesk-live-seg' },
            React.createElement('button', { className: 'arbesk-live-seg-btn' + (modeSel === 'local' ? ' active' : ''), onClick: () => setModeSel('local') }, 'Local'),
            React.createElement('button', { className: 'arbesk-live-seg-btn' + (modeSel === 'testnet' ? ' active' : ''), onClick: () => setModeSel('testnet') }, 'Testnet'),
          ),
          React.createElement('button', { className: 'arbesk-live-btn', onClick: startRun, disabled: busy || running }, running ? 'Running…' : 'Start'),
          React.createElement('button', { className: 'arbesk-live-btn', onClick: stopRun, disabled: !running }, 'Stop'),
          React.createElement('button', { className: 'arbesk-live-btn danger', onClick: forceStop, disabled: busy, title: 'Kill anything on port 9090 (+ docker in Local mode)' }, 'Force stop'),
          React.createElement('span', { className: 'arbesk-live-runlabel' }, runLabel),
          React.createElement('button', { className: 'arbesk-live-btn', onClick: () => setShowConsole(v => !v) }, showConsole ? 'Console ▾' : 'Console ▸'),
        ),
        React.createElement('iframe', { className: 'arbesk-live-frame', key: frameKey, src: APP_URL }),
        React.createElement('div', { className: 'arbesk-live-footer' },
          lastReload ? ('reloaded ' + lastReload) : 'auto-reloads on build',
          lastFile ? ' · ' + lastFile : '',
        ),
        consoleBody,
      )

      return React.createElement('div', {
        style: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'none' },
      }, tab, panel)
    }

    slots.inject('shell.overlay', () => slots.register(
      { name: 'shell.overlay', id: 'arbesk-live-viewer', order: 100, label: 'Arbesk Live Viewer' },
      () => React.createElement(LiveViewer),
    ))
  },
}
```
