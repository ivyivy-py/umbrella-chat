import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';

dotenv.config();

const MCP_ENDPOINT = 'https://mcp_weather_server--isdaniel.run.tools';

let mcpSessionId = null;
let mcpInitialized = false;
let mcpToolsList = [];

/**
 * Send a JSON-RPC 2.0 request to the remote MCP server.
 * Handles both plain JSON and Server-Sent Events (SSE) streaming responses.
 */
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

/**
 * Executes MCP connection steps in sequence:
 * 1. POST "initialize"
 * 2. POST "notifications/initialized"
 * 3. POST "tools/list"
 */
async function ensureMcpConnected() {
  if (mcpInitialized && mcpToolsList.length > 0) {
    return { connected: true, tools: mcpToolsList };
  }

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

  mcpToolsList = tools.length > 0 ? tools : [
    'get_current_weather',
    'get_weather_by_datetime_range',
    'get_air_quality',
    'get_current_datetime'
  ];
  mcpInitialized = true;
  return { connected: true, tools: mcpToolsList };
}

/**
 * Execute an MCP tool call (Step 4)
 */
async function executeMcpToolCall(name, args) {
  // Ensure connection first
  await ensureMcpConnected();

  const callResult = await sendMcpRequest('tools/call', {
    name,
    arguments: args || {}
  });

  let text = '';
  if (callResult?.result && Array.isArray(callResult.result.content)) {
    text = callResult.result.content
      .filter(item => item && item.type === 'text')
      .map(item => item.text)
      .join('\n');
    if (!text && callResult.result.content.length > 0) {
      text = JSON.stringify(callResult.result.content);
    }
  } else if (typeof callResult?.result === 'string') {
    text = callResult.result;
  } else {
    text = JSON.stringify(callResult?.result || {});
  }

  return text;
}

const geminiFunctionDeclarations = [
  {
    name: 'get_current_weather',
    description: 'Get current weather conditions for a specified city. City name must be in English.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        city: {
          type: Type.STRING,
          description: 'The city name in English (e.g. "Singapore", "London", "Tokyo", "New York").'
        }
      },
      required: ['city']
    }
  },
  {
    name: 'get_weather_by_datetime_range',
    description: 'Get weather forecast or data for a specified city over a date range. City name must be in English.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        city: {
          type: Type.STRING,
          description: 'The city name in English (e.g. "Singapore", "London", "Paris").'
        },
        start_date: {
          type: Type.STRING,
          description: 'Start date in YYYY-MM-DD format.'
        },
        end_date: {
          type: Type.STRING,
          description: 'End date in YYYY-MM-DD format.'
        }
      },
      required: ['city', 'start_date', 'end_date']
    }
  },
  {
    name: 'get_air_quality',
    description: 'Get current air quality index and pollution data for a specified city. City name must be in English.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        city: {
          type: Type.STRING,
          description: 'The city name in English (e.g. "Singapore", "Paris", "Beijing").'
        }
      },
      required: ['city']
    }
  },
  {
    name: 'get_current_datetime',
    description: 'Get current date and time for a given timezone name.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        timezone_name: {
          type: Type.STRING,
          description: 'The IANA timezone name (e.g. "Asia/Singapore", "Europe/Paris", "America/New_York", "Asia/Tokyo").'
        }
      },
      required: ['timezone_name']
    }
  }
];

/**
 * Generate content with automatic retry across models on temporary 503 high demand spikes.
 */
async function generateWithRetry(ai, payload) {
  const models = ['gemini-3.8-flash', 'gemini-3.1-flash-lite'];
  let lastError = null;

  for (const model of models) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        return await ai.models.generateContent({
          ...payload,
          model
        });
      } catch (err) {
        lastError = err;
        const msg = String(err?.message || '');
        const isTransient = err?.status === 503 || err?.status === 429 || msg.includes('503') || msg.includes('high demand');
        if (isTransient) {
          await new Promise(r => setTimeout(r, 1200 * attempt));
          continue;
        }
        break;
      }
    }
  }
  throw lastError;
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  // Handle GET request to check tools and connection
  if (req.method === 'GET') {
    try {
      const conn = await ensureMcpConnected();
      return res.status(200).json({
        connected: true,
        tools: conn.tools,
        error: null
      });
    } catch (err) {
      return res.status(200).json({
        connected: false,
        tools: [],
        error: err.message
      });
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (_) {}
  }
  body = body || {};

  const { message, history = [] } = body;

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid "message" parameter' });
  }

  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({
      error: 'GEMINI_API_KEY is not configured on the server. Please check Settings > Secrets.',
      reply: 'Server configuration error: GEMINI_API_KEY is missing.',
      toolCalls: []
    });
  }

  // Check MCP connectivity
  let mcpTools = [];
  let mcpConnectError = null;
  try {
    const conn = await ensureMcpConnected();
    mcpTools = conn.tools;
  } catch (err) {
    mcpConnectError = err.message || 'MCP connection failed';
  }

  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build'
      }
    }
  });

  const now = new Date();
  const currentDateStr = now.toISOString().split('T')[0];
  const currentTimeStr = now.toTimeString().split(' ')[0];

  const systemInstruction = `You are Umbrella, an accurate, friendly, and precise weather assistant.
Current date: ${currentDateStr}. Current local time: ${currentTimeStr}.
You have access to tools that fetch live weather data via a remote Model Context Protocol (MCP) server.

CRITICAL RULES:
1. Always call the appropriate tool to get real weather data.
2. DO NOT invent, fabricate, or hallucinate weather data under any circumstances. If the tool call fails or the weather server is unreachable, report the exact error and status code truthfully.
3. City names passed to tools MUST always be in English (e.g. 'Singapore', 'London', 'Tokyo', 'New York').
4. If a user asks about a specific street, landmark, road, or district (for example: 'Stamford Road', 'Times Square', 'Shinjuku'), identify its English city (e.g. 'Singapore') to call the tool, but address their specific requested location in your answer.
5. If you need the current local datetime for a timezone, you can call get_current_datetime.
6. If the user asks whether it will rain (such as "<location> will it rain?" or "Will it rain at <location> at <time>"):
   Your response MUST follow this exact format:
   <yes or no> <weather condition> at <time> at <location>
   Example 1: "No, partly cloudy at 10:21 PM at Stamford Road"
   Example 2: "Yes, heavy rain with thunderstorms at 3:00 PM at Orchard Road"
7. For other weather queries, be concise, helpful, and directly answer their question with temperature, conditions, and humidity/wind if relevant.`;

  // Build message history for Gemini
  const geminiContents = [];
  if (Array.isArray(history)) {
    for (const h of history) {
      if (h && h.text && (h.role === 'user' || h.role === 'model')) {
        geminiContents.push({
          role: h.role,
          parts: [{ text: h.text }]
        });
      }
    }
  }
  geminiContents.push({
    role: 'user',
    parts: [{ text: message }]
  });

  const executedToolCalls = [];

  try {
    const firstCall = await generateWithRetry(ai, {
      contents: geminiContents,
      config: {
        systemInstruction,
        tools: [{ functionDeclarations: geminiFunctionDeclarations }]
      }
    });

    const functionCalls = firstCall.functionCalls;

    if (functionCalls && functionCalls.length > 0) {
      // Execute each function call against MCP server
      const functionResponseParts = [];

      for (const call of functionCalls) {
        let rawResultText = null;
        let isError = false;
        let errorMessage = null;

        try {
          rawResultText = await executeMcpToolCall(call.name, call.args);
        } catch (mcpErr) {
          isError = true;
          errorMessage = mcpErr.message || 'MCP tool call failed';
        }

        executedToolCalls.push({
          tool: call.name,
          args: call.args,
          rawResult: rawResultText,
          isError,
          error: errorMessage
        });

        functionResponseParts.push({
          functionResponse: {
            name: call.name,
            response: {
              result: isError
                ? `Error calling MCP tool ${call.name}: ${errorMessage}. Do not fabricate data.`
                : rawResultText
            }
          }
        });
      }

      // Check if any tool call had an MCP HTTP error
      const hasMcpError = executedToolCalls.some(t => t.isError);

      // Pass tool results back to Gemini for final user reply
      const secondCall = await generateWithRetry(ai, {
        contents: [
          ...geminiContents,
          firstCall.candidates[0].content,
          {
            role: 'user',
            parts: functionResponseParts
          }
        ],
        config: {
          systemInstruction
        }
      });

      let finalReply = secondCall.text || '';

      // If MCP request failed, ensure the HTTP status and error are clearly visible
      if (hasMcpError) {
        const errorTool = executedToolCalls.find(t => t.isError);
        const errBanner = `[MCP Server Error: ${errorTool.error}]`;
        if (!finalReply.includes(errorTool.error)) {
          finalReply = `${finalReply ? finalReply + '\n\n' : ''}${errBanner}`;
        }
      }

      return res.status(200).json({
        reply: finalReply,
        toolCalls: executedToolCalls,
        tools: mcpToolsList,
        error: hasMcpError ? executedToolCalls.find(t => t.isError)?.error : null
      });
    }

    // No tool call was requested
    const reply = firstCall.text || '';
    return res.status(200).json({
      reply,
      toolCalls: [],
      tools: mcpToolsList,
      error: mcpConnectError
    });
  } catch (err) {
    let cleanMessage = err.message || 'Unknown error occurred';
    try {
      const parsed = JSON.parse(cleanMessage);
      cleanMessage = parsed?.error?.message || cleanMessage;
    } catch (_) {}

    return res.status(200).json({
      error: cleanMessage,
      reply: `Unable to process request: ${cleanMessage}`,
      toolCalls: executedToolCalls,
      tools: mcpToolsList
    });
  }
}
