// Stockfish worker controller. One search at a time; every search is a "job".
// A stopped search still prints one bestmove, which is swallowed (pendingStops),
// and nothing new is sent until it arrives: the single-threaded build drops a `go`
// that arrives while a stop is still being processed.

export function parseInfo(line) {
  const t = line.split(/\s+/);
  const o = {};
  for (let i = 1; i < t.length; i++) {
    const k = t[i];
    if (k === 'depth' || k === 'seldepth' || k === 'multipv' || k === 'nodes' || k === 'nps' || k === 'time') o[k] = +t[++i];
    else if (k === 'score') {
      const kind = t[++i];
      const v = +t[++i];
      o.score = kind === 'mate' ? { mate: v } : { cp: v };
      if (t[i + 1] === 'lowerbound' || t[i + 1] === 'upperbound') { o.bound = true; i++; }
    } else if (k === 'pv') { o.pv = t.slice(i + 1); break; }
  }
  return o;
}

function loadWorker(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    let w;
    try { w = new Worker(url); } catch (e) { reject(e); return; }
    let done = false;
    const fail = (err) => {
      if (done) return;
      done = true; clearTimeout(timer);
      try { w.terminate(); } catch {}
      reject(err);
    };
    const timer = setTimeout(() => fail(new Error('timeout')), timeoutMs);
    w.onerror = (e) => { e.preventDefault?.(); fail(e); };
    w.onmessage = (e) => {
      const text = String(e.data);
      if (/Aborted\(|failed|CompileError/i.test(text)) { fail(new Error(text)); return; }
      if (text.includes('uciok')) { done = true; clearTimeout(timer); w.onerror = null; resolve(w); }
    };
    w.postMessage('uci');
  });
}

export class Engine {
  constructor() {
    this.worker = null;
    this.ready = false;
    this.status = 'loading';
    this.flavor = '';
    this.job = null;
    this.next = null;
    this.pendingStops = 0;
    this.onIdle = null;
    this.onStatus = null;
    this.limited = null; // last UCI_LimitStrength state sent
  }

  async boot(hashMb, threads = 1) {
    let w = null;
    this.threads = 1;
    // Several threads need SharedArrayBuffer, which browsers only allow on cross-origin isolated pages
    // (COOP/COEP headers, see vercel.json). Anywhere else the single-threaded build is used.
    const isolated = self.crossOriginIsolated === true && typeof SharedArrayBuffer !== 'undefined';
    if (isolated && threads > 1) {
      try {
        const mtWasm = new URL('engine/stockfish-mt.wasm', document.baseURI).href;
        w = await loadWorker('engine/stockfish-mt.js#' + encodeURIComponent(mtWasm), 90000);
        this.threads = threads;
        this.flavor = `Stockfish 17.1 · ${threads} luồng`;
      } catch { w = null; }
    }
    if (!w) {
      const wasmUrl = new URL('engine/stockfish.wasm', document.baseURI).href;
      try {
        w = await loadWorker('engine/stockfish.js#' + encodeURIComponent(wasmUrl), 90000);
        this.flavor = 'Stockfish 17.1';
      } catch {
        this._setStatus('fallback');
        try {
          w = await loadWorker('engine/stockfish-asm.js', 120000);
          this.flavor = 'Stockfish 17.1 (asm.js)';
        } catch {
          this._setStatus('error');
          return false;
        }
      }
    }
    this.worker = w;
    w.onmessage = (e) => { for (const line of String(e.data).split('\n')) this._line(line.trim()); };
    w.onerror = () => { this.ready = false; this._setStatus('error'); };
    if (this.threads > 1) this.send('setoption name Threads value ' + this.threads);
    this.send('setoption name Hash value ' + hashMb);
    this.send('ucinewgame');
    this.send('isready');
    return true;
  }

  _setStatus(s) { this.status = s; this.onStatus && this.onStatus(s); }
  send(cmd) { this.worker && this.worker.postMessage(cmd); }
  get busy() { return !!this.job || this.pendingStops > 0; }
  is(kind) { return !!this.job && this.job.kind === kind; }

  /* Replace whatever is running (or queued) with this job. */
  run(job) {
    this.cancel();
    this.next = job;
    this._pump();
  }

  cancel() {
    this.next = null;
    const j = this.job;
    if (!j) return;
    if (j.timer) clearTimeout(j.timer);
    j.cancelled = true;
    this.job = null;
    this.pendingStops++;
    this.send('stop');
    j.onCancel && j.onCancel();
  }

  /* Ask a running infinite/timed search to finish now and report its bestmove normally. */
  finish() { if (this.job) this.send('stop'); }

  _pump() {
    if (!this.ready || this.job || this.pendingStops > 0) return;
    const j = this.next;
    this.next = null;
    if (j) this._start(j);
    else if (this.onIdle) this.onIdle();
  }

  _start(j) {
    this.job = j;
    j.startedAt = performance.now();
    const limited = !!j.limited;
    if (this.limited !== limited) {
      this.send('setoption name UCI_LimitStrength value ' + limited);
      this.limited = limited;
    }
    if (limited && j.elo) this.send('setoption name UCI_Elo value ' + j.elo);
    if (j.fresh) this.send('ucinewgame');
    this.send('setoption name MultiPV value ' + (j.multipv || 1));
    this.send(j.position);
    this.send(j.go);
    if (j.stopAfter) j.timer = setTimeout(() => { if (this.job === j) this.send('stop'); }, j.stopAfter);
    j.onStart && j.onStart();
  }

  _line(l) {
    if (!l) return;
    if (l === 'readyok' && !this.ready) {
      this.ready = true;
      this._setStatus('ready');
      this._pump();
      return;
    }
    if (l.startsWith('info ')) {
      if (this.pendingStops > 0 || !this.job) return;
      const info = parseInfo(l);
      if (info.depth && this.job.onInfo) this.job.onInfo(info);
      return;
    }
    if (l.startsWith('bestmove')) {
      if (this.pendingStops > 0) { this.pendingStops--; this._pump(); return; }
      const j = this.job;
      this.job = null;
      if (j && j.timer) clearTimeout(j.timer);
      const parts = l.split(/\s+/);
      const mv = parts[1];
      const ponder = parts[2] === 'ponder' ? parts[3] : null;
      if (j && j.onBest) j.onBest(mv && mv !== '(none)' ? mv : null, ponder);
      this._pump();
    }
  }
}
