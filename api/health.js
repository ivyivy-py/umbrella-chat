import dotenv from 'dotenv';
dotenv.config();

const MCP_ENDPOINT = process.env.MCP_ENDPOINT || 'http://localhost:8080/mcp';

let mcpSessionId = null;

async function sendMcpRequest(method, params = {}, isNotification = false) {
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream'
  };

  if (mcpSessionId) {
    headers['Mcp-Session-Id'] = mcpSessionId;
  }

  const rawKey = (process.env.MCP_SERVER_KEY || process.env.MCP_Server_KEY || process.env.mcp_server_key || '').trim();
  if (rawKey) {
    headers['Authorization'] = rawKey.startsWith('Bearer ') ? rawKey : `Bearer ${rawKey}`;
  }

  const reqId = isNotification ? undefined : Math.floor(Math.random() * 1000000) + 1;
  const bodyPayload = {
    jsonrpc: '2.0',
    method,
    params: params || {}
  };
  if (!isNotification) {
    bodyPayload.id = reqId;
  }

  const res = await fetch(MCP_ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify(bodyPayload)
  });

  const sessionHeader = res.headers.get('mcp-session-id') || res.headers.get('Mcp-Session-Id');
  if (sessionHeader) {
    mcpSessionId = sessionHeader;
  }

  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    let parsedMsg = errorText;
    try {
      const parsed = JSON.parse(errorText);
      parsedMsg = parsed.error_description || parsed.error?.message || parsed.error || errorText;
    } catch (_) {}
    const err = new Error(`HTTP ${res.status}: ${parsedMsg || res.statusText}`);
    err.status = res.status;
    err.details = parsedMsg;
    throw err;
  }

  if (isNotification) {
    return { ok: true };
  }

  const rawText = await res.text();
  let jsonRpcResponse = null;

  const trimmed = rawText.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      jsonRpcResponse = JSON.parse(trimmed);
    } catch (_) {}
  }

  if (!jsonRpcResponse) {
    const lines = rawText.split(/\r?\n/);
    for (const line of lines) {
      const trimmedLine = line.trim();
      if (trimmedLine.startsWith('data:')) {
        const payloadStr = trimmedLine.replace(/^data:\s*/, '');
        if (!payloadStr) continue;
        try {
          const parsed = JSON.parse(payloadStr);
          if (parsed && (parsed.id === reqId || String(parsed.id) === String(reqId))) {
            jsonRpcResponse = parsed;
            break;
          } else if (!jsonRpcResponse && (parsed.result !== undefined || parsed.error !== undefined)) {
            jsonRpcResponse = parsed;
          }
        } catch (_) {}
      }
    }
  }

  if (!jsonRpcResponse) {
    throw new Error(`Invalid response format from MCP server: ${rawText.slice(0, 150)}`);
  }

  if (jsonRpcResponse.error) {
    const errObj = jsonRpcResponse.error;
    const msg = typeof errObj === 'string' ? errObj : (errObj.message || JSON.stringify(errObj));
    const err = new Error(`MCP Error: ${msg}`);
    err.code = errObj.code;
    throw err;
  }

  return jsonRpcResponse;
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  const mcpKeyConfigured = Boolean(
    process.env.MCP_SERVER_KEY || process.env.MCP_Server_KEY || process.env.mcp_server_key
  );

  const healthData = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    endpoint: MCP_ENDPOINT,
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
    mcpConfigured: mcpKeyConfigured,
    mcp: {
      connected: false,
      tools: [],
      error: null
    }
  };

  try {
    // 1. Initialize
    await sendMcpRequest('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: {
        name: 'weather-app',
        version: '1.0'
      }
    });

    // 2. Initialized notification
    await sendMcpRequest('notifications/initialized', {}, true);

    // 3. List tools
    const listResult = await sendMcpRequest('tools/list', {});
    const tools = (listResult?.result?.tools || []).map(t => typeof t === 'string' ? t : t.name);

    healthData.mcp.connected = true;
    healthData.mcp.tools = tools.length > 0 ? tools : [
      'get_current_weather',
      'get_weather_by_datetime_range',
      'get_air_quality',
      'get_current_datetime'
    ];
  } catch (err) {
    healthData.mcp.connected = false;
    healthData.mcp.error = err.message || 'Failed to connect to MCP server';
  }

  return res.status(200).json(healthData);
}
