interface LegacyLocalMcpConnection {
  baseUrl: string;
  endpointUrl: string;
  token: string;
  port: number;
  path: string;
}

export interface AgentConnectionDetails {
  url: string;
  bearerToken: string;
}

export function toAgentConnectionDetails(
  connection: LegacyLocalMcpConnection,
): AgentConnectionDetails {
  return {
    url: connection.endpointUrl,
    bearerToken: connection.token,
  };
}

export function formatAgentConnection(
  details: AgentConnectionDetails,
): string {
  return `${JSON.stringify(details, null, 2)}\n`;
}
