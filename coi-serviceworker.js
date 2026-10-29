if (typeof window === "undefined") {
  self.addEventListener("install", (event) => {
    event.waitUntil(self.skipWaiting());
  });
  self.addEventListener("activate", (event) => {
    event.waitUntil(self.clients.claim());
  });
  self.addEventListener("fetch", (event) => {
    const request = event.request;
    if (request.cache === "only-if-cached" && request.mode !== "same-origin") {
      return;
    }
    event.respondWith(isolate(request));
  });

  async function isolate(request) {
    const response = await fetch(request);
    if (response.status === 0 || response.type === "opaque") {
      return response;
    }
    const headers = new Headers(response.headers);
    headers.set("Cross-Origin-Embedder-Policy", "require-corp");
    headers.set("Cross-Origin-Opener-Policy", "same-origin");
    headers.set("Cross-Origin-Resource-Policy", "same-origin");
    headers.delete("content-length");
    headers.delete("content-encoding");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
} else if (window.crossOriginIsolated) {
  sessionStorage.removeItem("astroid-coi-reload");
} else if (window.isSecureContext && navigator.serviceWorker) {
  const reloadKey = "astroid-coi-reload";
  const script = new URL("coi-serviceworker.js", document.baseURI);
  const scope = new URL("./", document.baseURI).href;
  navigator.serviceWorker.register(script, { scope, updateViaCache: "none" }).then(async () => {
    await navigator.serviceWorker.ready;
    if (window.crossOriginIsolated || sessionStorage.getItem(reloadKey) === "1") {
      return;
    }
    sessionStorage.setItem(reloadKey, "1");
    location.reload();
  });
}
