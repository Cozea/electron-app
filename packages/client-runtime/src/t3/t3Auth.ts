const OAUTH_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:token-exchange";
const OAUTH_BOOTSTRAP_TOKEN_TYPE = "urn:t3:params:oauth:token-type:environment-bootstrap";
const OAUTH_ACCESS_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:access_token";
const DEFAULT_SCOPES =
  "orchestration:read orchestration:operate terminal:operate review:write relay:read access:read access:write relay:write";

export function extractPairingToken(logText: string): string {
  const match = logText.match(/Token: ([A-Z0-9]+)/);
  if (!match) {
    throw new Error("T3 pairing token not found in server output");
  }
  return match[1];
}

export async function exchangeBootstrapAccessToken(
  baseUrl: string,
  pairingToken: string,
): Promise<string> {
  const body = new URLSearchParams({
    grant_type: OAUTH_GRANT_TYPE,
    subject_token: pairingToken,
    subject_token_type: OAUTH_BOOTSTRAP_TOKEN_TYPE,
    requested_token_type: OAUTH_ACCESS_TOKEN_TYPE,
    scope: DEFAULT_SCOPES,
  });
  const response = await fetch(`${baseUrl}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await response.json()) as { access_token?: string };
  if (!response.ok || !json.access_token) {
    throw new Error(`T3 oauth/token failed: ${response.status}`);
  }
  return json.access_token;
}

export async function issueWebSocketTicket(baseUrl: string, accessToken: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/auth/websocket-ticket`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const json = (await response.json()) as { ticket?: string };
  if (!response.ok || !json.ticket) {
    throw new Error(`T3 websocket-ticket failed: ${response.status}`);
  }
  return json.ticket;
}

export async function authenticateT3Server(baseUrl: string, pairingToken: string): Promise<string> {
  const accessToken = await exchangeBootstrapAccessToken(baseUrl, pairingToken);
  return issueWebSocketTicket(baseUrl, accessToken);
}
