#!/usr/bin/env node
/**
 * DeepChart & Databento Model Context Protocol (MCP) Server
 *
 * Implements the standard MCP JSON-RPC 2.0 protocol over stdio.
 * Allows AI agents (Claude, Cursor, Antigravity, Gemini) to directly query:
 *  - Databento Historical OHLCV Bars (CME Futures, OPRA Options, Equities)
 *  - OPRA Options Chain Definitions, Strikes, and Expirations
 *  - Market Statistics (Settlement, Open Interest, Daily Volume)
 *  - DeepChart Live DOM & Footprint Snapshots
 */

import * as readline from 'readline';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string | null;
  method: string;
  params?: any;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null | undefined;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

const SERVER_NAME = 'deepchart-databento-mcp';
const SERVER_VERSION = '2.0.0';

const HIST_API_BASE = process.env.DATABENTO_HIST_URL || 'https://hist.databento.com/v0';

function getApiKey(): string | undefined {
  return process.env.DATABENTO_API_KEY;
}

async function fetchDatabento(endpoint: string, params: Record<string, string> = {}): Promise<any> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('DATABENTO_API_KEY environment variable is not configured.');
  }

  const url = new URL(`${HIST_API_BASE}${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.append(key, value);
    }
  }

  const authHeader = 'Basic ' + Buffer.from(`${apiKey}:`).toString('base64');
  const res = await fetch(url.toString(), {
    headers: {
      Authorization: authHeader,
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    throw new Error(`Databento API HTTP ${res.status}: ${errorText || res.statusText}`);
  }

  return res.json();
}

const TOOLS = [
  {
    name: 'databento_historical_bars',
    description: 'Get historical OHLCV bars from Databento for CME Futures (GLBX.MDP3), Equities (XNAS.ITCH), or Options (OPRA.PILLAR).',
    inputSchema: {
      type: 'object',
      properties: {
        dataset: { type: 'string', description: 'Dataset code (e.g. GLBX.MDP3, OPRA.PILLAR, XNAS.ITCH)', default: 'GLBX.MDP3' },
        symbols: { type: 'string', description: 'Comma-separated symbols (e.g. ES.FUT, NQ.FUT, SPY)' },
        schema: { type: 'string', description: 'Schema (ohlcv-1s, ohlcv-1m, ohlcv-1h, ohlcv-1d)', default: 'ohlcv-1m' },
        start: { type: 'string', description: 'Start ISO timestamp or UNIX nanoseconds' },
        end: { type: 'string', description: 'End ISO timestamp or UNIX nanoseconds' },
        limit: { type: 'number', description: 'Maximum number of bars to return (default: 100)' },
      },
      required: ['symbols', 'start'],
    },
  },
  {
    name: 'databento_option_definitions',
    description: 'Get options contract definitions (strikes, expirations, call/put) from Databento OPRA.PILLAR.',
    inputSchema: {
      type: 'object',
      properties: {
        symbols: { type: 'string', description: 'Underlying symbol or raw option symbol (e.g. SPY)' },
        start: { type: 'string', description: 'Start date/timestamp' },
        limit: { type: 'number', description: 'Max contracts to return (default: 100)' },
      },
      required: ['symbols', 'start'],
    },
  },
  {
    name: 'databento_statistics',
    description: 'Get settlement prices, open interest, and daily statistics from Databento.',
    inputSchema: {
      type: 'object',
      properties: {
        dataset: { type: 'string', description: 'Dataset code (e.g. GLBX.MDP3)', default: 'GLBX.MDP3' },
        symbols: { type: 'string', description: 'Symbols (e.g. ES.FUT)' },
        start: { type: 'string', description: 'Start timestamp' },
      },
      required: ['symbols', 'start'],
    },
  },
  {
    name: 'deepchart_snapshot',
    description: 'Get system status and active data feeds of the DeepChart engine.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
];

async function handleToolCall(name: string, args: any): Promise<any> {
  switch (name) {
    case 'databento_historical_bars': {
      const dataset = args.dataset || 'GLBX.MDP3';
      const schema = args.schema || 'ohlcv-1m';
      const params: Record<string, string> = {
        dataset,
        symbols: args.symbols,
        schema,
        start: args.start,
        encoding: 'json',
      };
      if (args.end) params.end = args.end;
      if (args.limit) params.limit = String(args.limit);
      return fetchDatabento('/timeseries.get_range', params);
    }

    case 'databento_option_definitions': {
      const params: Record<string, string> = {
        dataset: 'OPRA.PILLAR',
        symbols: args.symbols,
        schema: 'definition',
        start: args.start,
        encoding: 'json',
      };
      if (args.limit) params.limit = String(args.limit);
      return fetchDatabento('/timeseries.get_range', params);
    }

    case 'databento_statistics': {
      const params: Record<string, string> = {
        dataset: args.dataset || 'GLBX.MDP3',
        symbols: args.symbols,
        schema: 'statistics',
        start: args.start,
        encoding: 'json',
      };
      return fetchDatabento('/timeseries.get_range', params);
    }

    case 'deepchart_snapshot': {
      return {
        status: 'online',
        provider: 'databento',
        cryptoProvider: 'binance',
        capabilities: [
          'Order Flow Footprint',
          'TPO Market Profile',
          'Volume Profile (VAH/VAL/POC)',
          'DOM Ladder (Depth of Market)',
          'Databento Realtime OPRA Options Chain',
          'Databento Realtime CME Futures (GLBX.MDP3)',
          'TimescaleDB Hypertable Analytics',
          'Redis High-Speed Caching',
        ],
      };
    }

    default:
      throw new Error(`Tool not found: ${name}`);
  }
}

function sendResponse(response: JsonRpcResponse) {
  process.stdout.write(JSON.stringify(response) + '\n');
}

function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  rl.on('line', async (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let req: JsonRpcRequest;
    try {
      req = JSON.parse(trimmed);
    } catch {
      sendResponse({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' },
      });
      return;
    }

    const { id, method, params } = req;

    if (method === 'initialize') {
      sendResponse({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: SERVER_NAME,
            version: SERVER_VERSION,
          },
        },
      });
      return;
    }

    if (method === 'notifications/initialized') {
      return;
    }

    if (method === 'tools/list') {
      sendResponse({
        jsonrpc: '2.0',
        id,
        result: {
          tools: TOOLS,
        },
      });
      return;
    }

    if (method === 'tools/call') {
      const toolName = params?.name;
      const toolArgs = params?.arguments || {};

      try {
        const toolResult = await handleToolCall(toolName, toolArgs);
        sendResponse({
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult, null, 2),
              },
            ],
          },
        });
      } catch (err: any) {
        sendResponse({
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: `Error executing tool ${toolName}: ${err.message}`,
              },
            ],
            isError: true,
          },
        });
      }
      return;
    }

    sendResponse({
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    });
  });
}

main();
