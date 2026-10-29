const status = document.getElementById("status");

function fail(error) {
  const text = String(error && error.stack ? error.stack : error);
  status.textContent = text;
  console.error(text);
}

function normalize(path) {
  const out = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") {
      continue;
    }
    if (part === "..") {
      out.pop();
    } else {
      out.push(part);
    }
  }
  return out.join("/");
}

function filesFor(project, text, spin) {
  const files = [project];
  const mesh = text.match(/^\s*mesh\s*=\s*"([^"]+)"/m);
  if (mesh) {
    const base = project.split("/").slice(0, -1).join("/");
    files.push(normalize(`${base}/${mesh[1]}`));
  }
  const prefix = "table-file:";
  if (spin.startsWith(prefix)) {
    files.push(spin.slice(prefix.length).trim());
  }
  return files;
}

function trunkAsset(pattern, scriptPattern) {
  const hits = performance
    .getEntriesByType("resource")
    .map((entry) => entry.name)
    .filter((name) => pattern.test(name));
  if (hits.length > 0) {
    return hits.at(-1);
  }
  for (const script of document.scripts) {
    const match = script.textContent.match(scriptPattern);
    if (match) {
      return new URL(match[1], document.baseURI).href;
    }
  }
  return "";
}

function viewerModuleUrl() {
  const url = trunkAsset(
    /\/astroid_evolution[^/]*\.js(?:\?|$)/,
    /from '([^']*astroid_evolution[^']*\.js)'/,
  );
  if (!url) {
    throw new Error("Trunk did not load the viewer module");
  }
  return url;
}

function viewerWasmUrl() {
  const url = trunkAsset(
    /\/astroid_evolution[^/]*_bg\.wasm(?:\?|$)/,
    /module_or_path:\s*'([^']*_bg\.wasm)'/,
  );
  if (!url) {
    throw new Error("Trunk did not load the viewer wasm");
  }
  return url;
}

addEventListener("TrunkApplicationStarted", () => {
  start().catch(fail);
});

async function start() {
  if (!navigator.gpu) {
    fail("This page needs WebGPU. Use a current desktop Chrome or Safari Technology Preview.");
    return;
  }
  if (typeof SharedArrayBuffer === "undefined") {
    fail("This page needs SharedArrayBuffer. Trunk must send COOP and COEP.");
    return;
  }
  const bindings = globalThis.wasmBindings;
  if (!bindings) {
    fail("Trunk did not publish the viewer bindings.");
    return;
  }
  const { boot, install_asset, deliver, prepare_viewer, viewer_defaults, ui_command, cache_name, cache_header, import_cache } =
    bindings;
  const query = new URLSearchParams(location.search);
  // Files installed in this page's memory table; every new worker gets a copy.
  const installed = new Map();
  // The current run: its shared buffer and its two workers. A restart replaces it.
  let run = null;

  async function fetchBytes(path) {
    const response = await fetch(new URL(path, document.baseURI));
    if (!response.ok) {
      throw new Error(path + " " + response.status);
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  async function install(path) {
    if (!installed.has(path)) {
      const bytes = await fetchBytes(path);
      install_asset(path, bytes);
      installed.set(path, bytes);
    }
    return installed.get(path);
  }

  /** The project, its mesh, a table spin file and the start snapshot. */
  async function ensure(project, spin, snapshot) {
    const text = new TextDecoder().decode(await install(project));
    const paths = filesFor(project, text, spin);
    if (snapshot) {
      paths.push(snapshot);
    }
    await Promise.all(paths.map(install));
  }

  // Cache names already looked for; `?live` always computes.
  const looked = new Set();
  const MAGIC = "AECACHE1";

  /** Install the cache file of a run when the site ships one (`src/app/cache.rs`). */
  async function findCache(request) {
    if (query.has("live")) {
      return;
    }
    let name;
    try {
      name = cache_name(JSON.stringify(request));
    } catch (err) {
      console.warn("cache", err);
      return;
    }
    if (looked.has(name)) {
      return;
    }
    looked.add(name);
    const response = await fetch(new URL(name, document.baseURI)).catch(() => null);
    if (!response || !response.ok) {
      return;
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    // A dev server may answer a missing file with the page itself.
    if (new TextDecoder().decode(bytes.subarray(0, MAGIC.length)) === MAGIC) {
      install_asset(name, bytes);
    }
  }

  function onWorker(event) {
    const data = event.data;
    if (!data || !run || (event.target !== run.worker && event.target !== run.gpu)) {
      return;
    }
    if (data.kind === "timing") {
      // `?timing`: module totals of this run, as `asteroid.timing[name] = [calls, seconds]`.
      const totals = globalThis.asteroid.timing;
      for (const [name, calls, seconds] of JSON.parse(data.payload)) {
        const row = totals[name] || (totals[name] = [0, 0]);
        row[0] += calls;
        row[1] += seconds;
      }
      return;
    }
    if (data.kind === "status" || data.kind === "frame" || data.kind === "finished" || data.kind === "failed") {
      deliver(data.kind, data.payload || "");
    }
    if (data.kind === "failed") {
      // A failed run never resumes; its workers would keep their wasm memory (GBs).
      run.worker.terminate();
      run.gpu.terminate();
    }
  }

  globalThis.asteroid = {
    gpuCall() {
      throw new Error("compute runs on the evolution worker");
    },
    emit() {},
    waitGate() {
      return 0;
    },
    setFlag(index, value) {
      if (run) {
        Atomics.store(run.header, index, value);
        Atomics.notify(run.header, index);
      }
    },
    note(text) {
      status.textContent = String(text);
    },
    // Status JSON for the panels (ui/src/host.ts).
    last: "",
    timing: {},
    status(json) {
      globalThis.asteroid.last = json;
      dispatchEvent(new CustomEvent("asteroid-status", { detail: json }));
    },
    command(json) {
      ui_command(json);
    },
    async restart(request) {
      await ensure(request.project, request.spin, request.snapshot);
      await findCache(request);
      ui_command(JSON.stringify({ cmd: "restart", ...request }));
    },
    // Play a cache file the user picked; the run it holds replaces the current one.
    async importCache(bytes) {
      const run = JSON.parse(cache_header(bytes));
      await ensure(run.project, run.spin, run.snapshot);
      import_cache(bytes);
    },
    // An exported cache file, as a download. The bytes are a view of wasm memory.
    download(name, bytes) {
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "application/octet-stream" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    },
    startWorker(config) {
      // A new run gets new workers and a new buffer; the old ones stop mid-step.
      if (run) {
        run.worker.terminate();
        run.gpu.terminate();
      }
      // Compute jobs go from the evolution worker straight to the GPU worker,
      // which owns its own WebGPU device; this thread only renders.
      const sab = new SharedArrayBuffer(256 + 96 * 1024 * 1024);
      const channel = new MessageChannel();
      const module = viewerModuleUrl();
      const gpu = new Worker(new URL("gpu_worker.js", document.baseURI), { type: "module" });
      const worker = new Worker(new URL("worker.js", document.baseURI), { type: "module" });
      const started = { sab, header: new Int32Array(sab, 0, 16), gpu, worker };
      run = started;
      gpu.onmessage = onWorker;
      worker.onmessage = onWorker;
      const files = [...installed].map(([path, bytes]) => ({ path, bytes: bytes.slice().buffer }));
      globalThis.asteroid.timing = {};
      compiledWasm()
        .then((wasm) => {
          if (run !== started) {
            return;
          }
          gpu.postMessage({ kind: "start", sab, module, wasm, port: channel.port2 }, [channel.port2]);
          worker.postMessage(
            { kind: "start", config, sab, module, wasm, files, port: channel.port1, timing: query.has("timing") },
            [channel.port1, ...files.map((file) => file.bytes)],
          );
        })
        .catch(fail);
    },
  };

  // The workers of every run share one compiled module instead of compiling the
  // viewer wasm twice per run; compiling starts while the mesh is decoded.
  let compiled = null;
  function compiledWasm() {
    if (!compiled) {
      const url = viewerWasmUrl();
      compiled = WebAssembly.compileStreaming(fetch(url)).catch(async () =>
        WebAssembly.compile(await (await fetch(url)).arrayBuffer()),
      );
    }
    return compiled;
  }

  // Without a query the page opens the run the desktop shell opens.
  const defaults = JSON.parse(viewer_defaults());
  const project = query.get("project") || defaults.project;
  const spin = query.get("spin") || defaults.spin;
  const snapshot = query.get("snapshot");
  const maxSteps = query.get("max_steps");
  await ensure(project, spin, snapshot);
  const request = { project, spin, snapshot, max_steps: maxSteps ? Number(maxSteps) : null };
  await findCache(request);
  const config = JSON.stringify(request);
  status.textContent = "Decoding the mesh on the GPU…";
  compiledWasm().catch(fail);
  await prepare_viewer(config);
  status.textContent = "";
  dispatchEvent(new Event("asteroid-ready"));
  boot(config);
}
