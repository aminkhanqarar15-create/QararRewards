export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Test API
    if (url.pathname === "/api/test") {
      return Response.json({
        success: true,
        message: "QararRewards API is working",
        database: !!env.DB
      });
    }

    // Existing website files
    return env.ASSETS.fetch(request);
  }
};
