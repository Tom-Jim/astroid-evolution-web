// GPU worker: owns the compute device and runs the jobs the evolution worker
// posts. The request and the reply travel through the shared buffer; word 0 of
// the header is the phase (1 request, 2 reply, 3 error), word 1 the byte count.

self.onmessage = async (event) => {
  if (!event.data || event.data.kind !== "start") {
    return;
  }
  const { sab, port } = event.data;
  const header = new Int32Array(sab, 0, 16);
  const data = new Uint8Array(sab, 256);
  try {
    const { default: init, execute_gpu } = await import(event.data.module);
    await init({ module_or_path: event.data.wasm });
    let queue = Promise.resolve();
    const serve = async () => {
      // The caller waits for the reply, so the request bytes stay put while wasm copies them.
      const request = data.subarray(0, Atomics.load(header, 1));
      try {
        const out = new Uint8Array(await execute_gpu(request));
        if (out.length > data.length) {
          throw new Error("gpu response does not fit (" + out.length + " bytes)");
        }
        data.set(out);
        Atomics.store(header, 1, out.length);
        Atomics.store(header, 0, 2);
      } catch (error) {
        const msg = new TextEncoder().encode(String(error && error.stack ? error.stack : error));
        data.set(msg);
        Atomics.store(header, 1, msg.length);
        Atomics.store(header, 0, 3);
      }
      Atomics.notify(header, 0);
    };
    port.onmessage = () => {
      queue = queue.then(serve);
    };
  } catch (error) {
    self.postMessage({ kind: "failed", payload: String(error && error.stack ? error.stack : error) });
  }
};
