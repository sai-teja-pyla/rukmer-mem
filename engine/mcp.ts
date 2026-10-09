import type { Request, Response } from 'express';
import { MEMORY_TOOLS, runMemoryTool } from './tools.js';

const PROTOCOL = '2024-11-05';

const MCP_TOOLS = MEMORY_TOOLS.map((t) => ({
  name: t.function.name,
  description: t.function.description,
  inputSchema: t.function.parameters,
}));

function rpcResult(id: unknown, result: unknown) {
  return { jsonrpc: '2.0', id, result };
}

function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

async function handleOne(msg: any, uid?: string) {
  const id = msg?.id;
  const method = String(msg?.method || '');
  if (!method) return rpcError(id ?? null, -32600, 'Invalid request');
  if (id === undefined || id === null) return null;

  if (method === 'initialize') {
    return rpcResult(id, {
      protocolVersion: PROTOCOL,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'rukmer-memory', version: '1.0.0' },
      instructions:
        'Rukmer stores the user\'s long-term memory. Call searchMemories before answering personal questions. Call addMemory when the user states a durable fact. Do not invent profile details.',
    });
  }
  if (method === 'ping' || method === 'notifications/initialized') {
    return rpcResult(id, {});
  }
  if (method === 'tools/list') {
    return rpcResult(id, { tools: MCP_TOOLS });
  }
  if (method === 'tools/call') {
    const name = String(msg?.params?.name || '');
    const args = msg?.params?.arguments || {};
    try {
      const out = await runMemoryTool(name, args, uid);
      return rpcResult(id, {
        content: [{ type: 'text', text: JSON.stringify(out, null, 2) }],
      });
    } catch (e: any) {
      return rpcResult(id, {
        content: [{ type: 'text', text: e.message || 'Tool failed' }],
        isError: true,
      });
    }
  }
  return rpcError(id, -32601, `Method not found: ${method}`);
}

export async function handleMcp(req: Request, res: Response) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, mcp-session-id, mcp-protocol-version');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method === 'GET') {
    res.json({
      name: 'rukmer-memory',
      protocol: 'mcp',
      protocolVersion: PROTOCOL,
      tools: MCP_TOOLS.map((t) => t.name),
      hint: 'POST JSON-RPC here from Claude, ChatGPT, Gemini, or Grok connectors. This does not import those products\' chat histories.',
    });
    return;
  }

  const uid = req.memoryUser?.uid;
  const body = req.body;
  if (Array.isArray(body)) {
    const out = [];
    for (const msg of body) {
      const r = await handleOne(msg, uid);
      if (r) out.push(r);
    }
    res.json(out);
    return;
  }

  const result = await handleOne(body, uid);
  if (!result) {
    res.status(202).end();
    return;
  }
  res.json(result);
}

export const CHATGPT_OPENAPI = {
  openapi: '3.1.0',
  info: {
    title: 'Rukmer Memory',
    version: '1.0.0',
    description: 'Search and save long-term memory. ChatGPT cannot export its own chat history; use these actions while chatting.',
  },
  servers: [{ url: 'https://app.rukmer.com' }],
  paths: {
    '/v4/tools/execute': {
      post: {
        operationId: 'runMemoryTool',
        summary: 'searchMemories or addMemory',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string', enum: ['searchMemories', 'addMemory'] },
                  arguments: { type: 'object' },
                },
                required: ['name', 'arguments'],
              },
            },
          },
        },
        responses: { '200': { description: 'Tool result' } },
      },
    },
  },
};
