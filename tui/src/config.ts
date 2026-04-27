/** Environment-driven config. Never commit API keys. */

export function getConfig() {
  const fireworksApiKey = process.env.FIREWORKS_API_KEY ?? "";
  /** OpenAI-compatible endpoint — see https://docs.fireworks.ai/tools-sdks/openai-compatibility */
  const fireworksBaseUrl =
    process.env.FIREWORKS_BASE_URL ?? "https://api.fireworks.ai/inference/v1";
  const fireworksModel =
    process.env.FIREWORKS_MODEL ?? "accounts/fireworks/models/minimax-m2p7";
  const alderApiKey = process.env.ALDER_API_KEY ?? "";
  const alderMcpUrl = process.env.ALDER_MCP_URL ?? "https://api.alder.so/mcp";

  return {
    fireworksApiKey,
    fireworksBaseUrl,
    fireworksModel,
    alderApiKey,
    alderMcpUrl,
    isConfigured: Boolean(fireworksApiKey && alderApiKey),
  };
}
