let sab = null;
let port = null;
// The first failure wins: a Rust panic logs its message, then aborts with a bare
// `RuntimeError: unreachable` that must not replace it.
let failed = false;

function fail(text) {
  if (failed) {
    return;
  }
  failed = true;
  try {
    self.postMessage({ kind: "failed", payload: text });
  } catch (_err) {
    // The page may already be gone.
  }
}

const reportError = console.error.bind(console);
console.error = (...args) => {
  fail(args.map((item) => String(item && item.stack ? item.stack : item)).join("\n"));
  reportError(...args);
};

function header() {
  return new Int32Array(sab, 0, 16);
}

function dataBytes() {
  return new Uint8Array(sab, 256);
}

function installBridge() {
  globalThis.asteroid = {
    gpuCall(payload) {
      const src = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
      const dst = dataBytes();
      if (src.length > dst.length) {
        throw new Error("gpu request does not fit (" + src.length + " bytes)");
      }
      dst.set(src);
      const words = header();
      Atomics.store(words, 1, src.length);
      Atomics.store(words, 0, 1);
      port.postMessage(null);
      while (Atomics.load(words, 0) === 1) {
        Atomics.wait(words, 0, 1);
      }
      const phase = Atomics.load(words, 0);
      const len = Atomics.load(words, 1);
      Atomics.store(words, 0, 0);
      if (phase === 3) {
        throw new Error(new TextDecoder().decode(dst.slice(0, len)));
      }
      // A view, not a copy: wasm copies it into its memory before the next request
      // can reach the buffer (this worker is the only caller and waits for each reply).
      return dst.subarray(0, len);
    },
    emit(kind, payload) {
      self.postMessage({ kind, payload });
    },
    startWorker() {},
    setFlag() {},
    waitGate() {
      const words = header();
      while (Atomics.load(words, 2) === 1 && Atomics.load(words, 3) === 0) {
        Atomics.wait(words, 2, 1, 250);
      }
      return Atomics.load(words, 3) === 0 ? 0 : 1;
    },
  };
}

self.onmessage = async (event) => {
  if (!event.data || event.data.kind !== "start") {
    return;
  }
  sab = event.data.sab;
  port = event.data.port;
  installBridge();
  try {
    const pkg = await import(event.data.module);
    const { default: init, install_asset, worker_main, enable_timing } = pkg;
    await init({ module_or_path: event.data.wasm });
    // Rayon threads for this worker's CPU work (a threaded build exports the pool). The
    // page and the GPU worker keep one thread each.
    if (pkg.initThreadPool) {
      await pkg.initThreadPool(Math.max(1, (navigator.hardwareConcurrency || 2) - 1));
    }
    if (event.data.timing) {
      enable_timing();
    }
    for (const file of event.data.files) {
      install_asset(file.path, new Uint8Array(file.bytes));
    }
    worker_main(event.data.config);
  } catch (error) {
    fail(String(error && error.stack ? error.stack : error));
  }
};
