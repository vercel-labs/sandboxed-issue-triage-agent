// Stable harness adapters accept an isolated, flat authentication environment.
// Pass only gateway settings so provider credentials cannot become fallbacks.
export function getGatewayAuthentication(
  environment: Record<string, string | undefined>,
): Record<string, string> {
  const authentication: Record<string, string> = {};
  const apiKey = environment.AI_GATEWAY_API_KEY || environment.VERCEL_OIDC_TOKEN;
  if (apiKey) authentication.AI_GATEWAY_API_KEY = apiKey;
  if (environment.AI_GATEWAY_BASE_URL) {
    authentication.AI_GATEWAY_BASE_URL = environment.AI_GATEWAY_BASE_URL;
  }
  return authentication;
}
