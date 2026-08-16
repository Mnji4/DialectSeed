export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      if (!env.API_HOST) {
        return new Response("API_HOST is not configured", { status: 503 });
      }

      url.protocol = "https:";
      url.hostname = env.API_HOST;
      return fetch(new Request(url.toString(), request));
    }

    const assetResponse = await env.ASSETS.fetch(request);
    if (assetResponse.status !== 404) return assetResponse;

    const indexUrl = new URL(request.url);
    indexUrl.pathname = "/index.html";
    indexUrl.search = "";
    return env.ASSETS.fetch(new Request(indexUrl.toString(), request));
  }
};
