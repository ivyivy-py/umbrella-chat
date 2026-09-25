import React, { useState, useEffect, useRef } from 'react';
import {
  Umbrella,
  CloudRain,
  Send,
  RefreshCw,
  Terminal,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Copy,
  Check,
  Sparkles,
  Info,
  Server,
  CloudSun,
  Wind
} from 'lucide-react';

interface ToolCallLog {
  tool: string;
  args: Record<string, any>;
  rawResult: string | null;
  isError?: boolean;
  error?: string | null;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  toolCalls?: ToolCallLog[];
  error?: string | null;
}

interface HealthResponse {
  status: string;
  geminiConfigured: boolean;
  mcpConfigured: boolean;
  mcp: {
    connected: boolean;
    tools: string[];
    error: string | null;
  };
}

const SAMPLE_QUERIES = [
  'will it rain at Stamford Road in 1 hour?',
  'Will it rain at Orchard Road at 3 PM?',
  'Tokyo will it rain?',
  'What is the air quality in Beijing?',
  'What is the current datetime in Europe/Paris?'
];

export default function App() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: 'Hello! I am Umbrella, your real-time weather assistant. Ask me whether it will rain anywhere, e.g. "will it rain at Stamford Road in 1 hour?"',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [isCheckingHealth, setIsCheckingHealth] = useState(false);
  const [showToolsPanel, setShowToolsPanel] = useState(true);
  const [expandedLogs, setExpandedLogs] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  const checkHealth = async () => {
    setIsCheckingHealth(true);
    try {
      const res = await fetch('/api/health');
      if (res.ok) {
        const data: HealthResponse = await res.json();
        setHealth(data);
      } else {
        const errText = await res.text().catch(() => '');
        setHealth({
          status: 'error',
          geminiConfigured: false,
          mcpConfigured: false,
          mcp: {
            connected: false,
            tools: [],
            error: `HTTP ${res.status}: ${errText || res.statusText}`
          }
        });
      }
    } catch (err: any) {
      setHealth({
        status: 'error',
        geminiConfigured: false,
        mcpConfigured: false,
        mcp: {
          connected: false,
          tools: [],
          error: err.message || 'Failed to check server health'
        }
      });
    } finally {
      setIsCheckingHealth(false);
    }
  };

  useEffect(() => {
    checkHealth();
  }, []);

  const toggleLog = (msgId: string) => {
    setExpandedLogs((prev) => ({
      ...prev,
      [msgId]: !prev[msgId]
    }));
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleSend = async (queryText?: string) => {
    const textToSend = (queryText || input).trim();
    if (!textToSend || isLoading) return;

    setInput('');

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: textToSend,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);

    try {
      // Build history for backend
      const history = messages
        .filter((m) => m.id !== 'welcome')
        .map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          text: m.content
        }));

      const res = await fetch('/api/weather', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: textToSend,
          history
        })
      });

      const data = await res.json();

      const assistantMessage: Message = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: data.reply || (data.error ? `Error: ${data.error}` : 'No response generated.'),
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        toolCalls: data.toolCalls || [],
        error: data.error || (res.ok ? null : `HTTP ${res.status}`)
      };

      setMessages((prev) => [...prev, assistantMessage]);

      // If backend returned tool execution, auto-expand the log so user sees the tool use happening
      if (assistantMessage.toolCalls && assistantMessage.toolCalls.length > 0) {
        setExpandedLogs((prev) => ({
          ...prev,
          [assistantMessage.id]: true
        }));
      }

      // Update connected tools list if updated
      if (data.tools && Array.isArray(data.tools) && data.tools.length > 0) {
        setHealth((prev) => prev ? {
          ...prev,
          mcp: {
            ...prev.mcp,
            connected: true,
            tools: data.tools,
            error: null
          }
        } : null);
      }
    } catch (err: any) {
      const errorMessage: Message = {
        id: `err-${Date.now()}`,
        role: 'assistant',
        content: `Connection error: ${err.message || 'Failed to reach weather service'}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        error: err.message
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const connectedToolsList = health?.mcp?.tools && health.mcp.tools.length > 0
    ? health.mcp.tools
    : ['get_current_weather', 'get_weather_by_datetime_range', 'get_air_quality', 'get_current_datetime'];

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-100 font-sans selection:bg-cyan-500 selection:text-white">
      {/* Top Header */}
      <header className="flex-none border-b border-slate-800 bg-slate-900/90 backdrop-blur px-4 py-3 z-20">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-600 via-sky-500 to-indigo-500 flex items-center justify-center shadow-lg shadow-cyan-500/20 text-white">
              <Umbrella className="w-5 h-5 stroke-[2.2]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold tracking-tight text-white flex items-center gap-1.5">
                  Umbrella
                  <span className="text-[10px] uppercase font-semibold tracking-wider px-1.5 py-0.5 rounded bg-cyan-950 border border-cyan-700/60 text-cyan-400">
                    MCP + Gemini
                  </span>
                </h1>
              </div>
              <p className="text-xs text-slate-400">
                Weather assistant powered by live MCP JSON-RPC & function calling
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowToolsPanel(!showToolsPanel)}
              className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg border border-slate-700 hover:border-slate-600 bg-slate-800/80 transition-colors"
              title="Toggle Connected Tools Panel"
            >
              <Server className="w-3.5 h-3.5 text-cyan-400" />
              <span className="hidden sm:inline font-medium">Tools</span>
              <span className={`inline-block w-2 h-2 rounded-full ${health?.mcp?.connected ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]' : 'bg-amber-400'}`} />
            </button>

            <button
              onClick={checkHealth}
              disabled={isCheckingHealth}
              className="p-1.5 rounded-lg border border-slate-700 hover:border-slate-600 bg-slate-800/80 text-slate-300 hover:text-white transition-colors disabled:opacity-50"
              title="Refresh MCP Connection"
            >
              <RefreshCw className={`w-4 h-4 ${isCheckingHealth ? 'animate-spin text-cyan-400' : ''}`} />
            </button>
          </div>
        </div>
      </header>

      {/* Connected Tools Panel */}
      {showToolsPanel && (
        <div className="flex-none bg-slate-900 border-b border-slate-800 px-4 py-2.5 text-xs text-slate-300">
          <div className="max-w-4xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-slate-400 flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5 text-cyan-400" />
                Connected tools:
              </span>
              <div className="flex items-center gap-1.5 flex-wrap">
                {connectedToolsList.map((tool) => (
                  <span
                    key={tool}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded font-mono text-[11px] bg-slate-800 border border-slate-700 text-cyan-300"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400"></span>
                    {tool}
                  </span>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2 text-[11px] text-slate-400 font-mono">
              <span className="truncate max-w-[240px] text-slate-500">
                https://mcp_weather_server--isdaniel.run.tools
              </span>
              {health?.mcp?.connected ? (
                <span className="inline-flex items-center gap-1 text-emerald-400 font-medium">
                  <CheckCircle2 className="w-3 h-3" /> Live
                </span>
              ) : (
                <span
                  className="inline-flex items-center gap-1 text-amber-400 font-medium cursor-help"
                  title={health?.mcp?.error || 'Awaiting MCP_SERVER_KEY'}
                >
                  <AlertCircle className="w-3 h-3" />
                  {health?.mcp?.error ? health.mcp.error.slice(0, 22) + '...' : 'Awaiting Key'}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Main Chat Area */}
      <main className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-3xl mx-auto space-y-5">
          {messages.map((message) => {
            const isUser = message.role === 'user';
            const isExpanded = !!expandedLogs[message.id];
            const hasToolCalls = message.toolCalls && message.toolCalls.length > 0;

            return (
              <div
                key={message.id}
                className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}
              >
                {!isUser && (
                  <div className="flex-none w-8 h-8 rounded-lg bg-gradient-to-tr from-cyan-600 to-sky-500 flex items-center justify-center text-white shadow-md shadow-cyan-500/10 mt-0.5">
                    <Umbrella className="w-4 h-4" />
                  </div>
                )}

                <div className={`flex flex-col max-w-[85%] sm:max-w-[75%] ${isUser ? 'items-end' : 'items-start'}`}>
                  {/* Message Bubble */}
                  <div
                    className={`rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm ${
                      isUser
                        ? 'bg-cyan-600 text-white rounded-tr-none'
                        : message.error && !message.content.includes('<yes or no>')
                        ? 'bg-slate-900 border border-rose-900/60 text-slate-200 rounded-tl-none'
                        : 'bg-slate-900 border border-slate-800 text-slate-200 rounded-tl-none'
                    }`}
                  >
                    {/* Error Banner if MCP request failed */}
                    {message.error && (
                      <div className="mb-2 p-2 rounded-lg bg-rose-950/70 border border-rose-800/60 text-rose-300 text-xs flex items-start gap-2">
                        <XCircle className="w-4 h-4 text-rose-400 flex-none mt-0.5" />
                        <div>
                          <p className="font-semibold text-rose-200">MCP Request Error</p>
                          <p className="font-mono text-[11px] text-rose-300/90">{message.error}</p>
                          <p className="text-[10px] text-rose-400 mt-1">
                            Live weather server did not return valid data. Weather data cannot be invented.
                          </p>
                        </div>
                      </div>
                    )}

                    <div className="whitespace-pre-wrap font-sans break-words">{message.content}</div>

                    <div
                      className={`text-[10px] mt-1.5 flex items-center justify-end gap-1 ${
                        isUser ? 'text-cyan-200/80' : 'text-slate-500'
                      }`}
                    >
                      <span>{message.timestamp}</span>
                    </div>
                  </div>

                  {/* Collapsible MCP Tool Use Log */}
                  {!isUser && (hasToolCalls || message.error) && (
                    <div className="w-full mt-2 rounded-xl border border-slate-800 bg-slate-950/80 overflow-hidden text-xs">
                      <button
                        onClick={() => toggleLog(message.id)}
                        className="w-full px-3 py-2 flex items-center justify-between text-slate-400 hover:text-slate-200 hover:bg-slate-900/60 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <Terminal className="w-3.5 h-3.5 text-cyan-400" />
                          <span className="font-semibold text-slate-300">
                            MCP Tool Execution Log
                          </span>
                          {hasToolCalls && (
                            <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-cyan-950 border border-cyan-800 text-cyan-300">
                              {message.toolCalls!.length} call{message.toolCalls!.length > 1 ? 's' : ''}
                            </span>
                          )}
                          {message.toolCalls?.some((t) => t.isError) && (
                            <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-rose-950 border border-rose-800 text-rose-300">
                              error
                            </span>
                          )}
                        </div>
                        {isExpanded ? (
                          <ChevronUp className="w-4 h-4 text-slate-400" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-slate-400" />
                        )}
                      </button>

                      {isExpanded && (
                        <div className="border-t border-slate-800 p-3 space-y-3 bg-slate-900/40">
                          {hasToolCalls ? (
                            message.toolCalls!.map((call, idx) => (
                              <div
                                key={idx}
                                className="space-y-2 p-2.5 rounded-lg bg-slate-950 border border-slate-800 font-mono text-[11px]"
                              >
                                <div className="flex items-center justify-between border-b border-slate-800/80 pb-1.5">
                                  <div className="flex items-center gap-2">
                                    <span className="text-cyan-400 font-bold">
                                      POST tools/call
                                    </span>
                                    <span className="text-slate-300">
                                      &rarr; <span className="text-amber-300">{call.tool}</span>
                                    </span>
                                  </div>
                                  <span
                                    className={`px-1.5 py-0.5 rounded text-[10px] ${
                                      call.isError
                                        ? 'bg-rose-950 text-rose-300 border border-rose-800'
                                        : 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                                    }`}
                                  >
                                    {call.isError ? 'Failed' : 'Success'}
                                  </span>
                                </div>

                                {/* Arguments */}
                                <div>
                                  <span className="text-slate-500 block text-[10px] uppercase font-semibold">
                                    Arguments
                                  </span>
                                  <pre className="mt-0.5 p-1.5 rounded bg-slate-900 text-cyan-200 overflow-x-auto text-[11px]">
                                    {JSON.stringify(call.args, null, 2)}
                                  </pre>
                                </div>

                                {/* Raw Result */}
                                <div>
                                  <div className="flex items-center justify-between">
                                    <span className="text-slate-500 block text-[10px] uppercase font-semibold">
                                      Raw Result (result.content[].text)
                                    </span>
                                    {call.rawResult && (
                                      <button
                                        onClick={() => copyToClipboard(call.rawResult || '', `copy-${message.id}-${idx}`)}
                                        className="text-[10px] text-slate-400 hover:text-white flex items-center gap-1"
                                      >
                                        {copiedId === `copy-${message.id}-${idx}` ? (
                                          <Check className="w-3 h-3 text-emerald-400" />
                                        ) : (
                                          <Copy className="w-3 h-3" />
                                        )}
                                        {copiedId === `copy-${message.id}-${idx}` ? 'Copied' : 'Copy'}
                                      </button>
                                    )}
                                  </div>
                                  <pre className="mt-0.5 p-1.5 rounded bg-slate-900 text-slate-200 overflow-x-auto whitespace-pre-wrap max-h-48 text-[11px]">
                                    {call.isError
                                      ? `Error: ${call.error || 'Unknown failure'}`
                                      : call.rawResult || '(empty text result)'}
                                  </pre>
                                </div>
                              </div>
                            ))
                          ) : (
                            <div className="text-slate-400 text-xs italic">
                              No tools were invoked for this query.
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* Loading indicator */}
          {isLoading && (
            <div className="flex gap-3 justify-start items-center">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-cyan-600 to-sky-500 flex items-center justify-center text-white shadow-md animate-pulse">
                <Umbrella className="w-4 h-4" />
              </div>
              <div className="rounded-2xl rounded-tl-none px-4 py-3 bg-slate-900 border border-slate-800 text-sm text-slate-300 flex items-center gap-3">
                <div className="flex space-x-1.5">
                  <div className="w-2 h-2 rounded-full bg-cyan-400 animate-bounce [animation-delay:-0.3s]"></div>
                  <div className="w-2 h-2 rounded-full bg-cyan-400 animate-bounce [animation-delay:-0.15s]"></div>
                  <div className="w-2 h-2 rounded-full bg-cyan-400 animate-bounce"></div>
                </div>
                <span className="text-xs text-slate-400">
                  Calling MCP weather server & reasoning...
                </span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </main>

      {/* Suggested Queries Pill Bar */}
      <div className="flex-none px-4 py-2 bg-slate-900/60 border-t border-slate-800/60">
        <div className="max-w-3xl mx-auto flex items-center gap-2 overflow-x-auto no-scrollbar py-0.5">
          <span className="text-[11px] font-semibold text-slate-400 flex items-center gap-1 flex-none">
            <Sparkles className="w-3 h-3 text-cyan-400" />
            Try:
          </span>
          {SAMPLE_QUERIES.map((query, index) => (
            <button
              key={index}
              onClick={() => handleSend(query)}
              disabled={isLoading}
              className="flex-none text-xs px-2.5 py-1 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/80 transition-colors disabled:opacity-50"
            >
              {query}
            </button>
          ))}
        </div>
      </div>

      {/* Bottom Input Area */}
      <footer className="flex-none p-4 bg-slate-900 border-t border-slate-800">
        <div className="max-w-3xl mx-auto">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="flex items-center gap-2"
          >
            <div className="relative flex-1">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask e.g. &quot;will it rain at Stamford Road in 1 hour?&quot;"
                disabled={isLoading}
                className="w-full bg-slate-950 border border-slate-800 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 rounded-xl px-4 py-3 text-sm text-slate-100 placeholder-slate-500 outline-none transition disabled:opacity-50 pr-10"
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-600 text-xs hidden sm:block">
                Press Enter ↵
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="p-3 rounded-xl bg-gradient-to-r from-cyan-500 to-sky-600 hover:from-cyan-400 hover:to-sky-500 text-white font-medium shadow-md shadow-cyan-500/20 disabled:opacity-40 disabled:pointer-events-none transition-all flex items-center justify-center"
              title="Send message"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>

          <div className="mt-2 text-center text-[10px] text-slate-400">
            Output format: &lt;yes or no&gt; &lt;weather condition&gt; at &lt;time&gt; at &lt;location&gt;. Weather data retrieved via remote MCP server.
          </div>
        </div>
      </footer>
    </div>
  );
}
