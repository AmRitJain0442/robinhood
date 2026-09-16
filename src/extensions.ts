import { readFile, stat, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { minimalEnvironment } from './bridges/headless-process.js';
import { prepareTool } from './tools.js';
import { Capabilities, type ExtensionTool } from './capabilities.js';

async function smallFile(filename: string): Promise<string> {
  if ((await stat(filename)).size > 32000) throw new Error('Configuration or skill exceeds 32 KiB.');
  return readFile(filename, 'utf8');
}

export async function listSkills(workspace: string): Promise<string[]> {
  const base = path.join(workspace, '.agents', 'skills');
  const entries = await readdir(base, { withFileTypes: true }).catch(() => []);
  const names: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory() && /^[\w-]+$/.test(entry.name)) {
      try { await loadSkill(workspace, entry.name); names.push(entry.name); } catch { /* An unreadable skill is not offered. */ }
    }
  }
  return names.sort();
}
export async function loadSkill(workspace: string, name: string): Promise<string> {
  if (!/^[\w-]{1,80}$/.test(name)) throw new Error('Select a skill name from /skills.');
  const tool = await prepareTool(workspace, 'read_file', JSON.stringify({ path: `.agents/skills/${name}/SKILL.md` }));
  const result = JSON.parse(await tool.execute(AbortSignal.timeout(5000))) as { content: string };
  if (Buffer.byteLength(result.content) > 16000) throw new Error('Skill exceeds the 16 KiB instruction budget.');
  return result.content;
}

export async function loadPlugin(filename: string, capabilities: Capabilities): Promise<string> {
  const module = await import(pathToFileURL(await realpath(filename)).href);
  const plugin = module.default as { name: string; tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown>; execute: ExtensionTool['execute'] }>; close?: () => Promise<void> };
  if (!plugin || !Array.isArray(plugin.tools)) throw new Error('Plugin must export a default { name, tools } object.');
  capabilities.register(plugin.name, plugin.tools.map(tool => ({ definition: { type: 'function', function: { name: `${plugin.name}__${tool.name}`, description: tool.description, parameters: tool.inputSchema } }, execute: tool.execute })), plugin.close);
  return plugin.name;
}

export async function loadMcp(filename: string, capabilities: Capabilities, signal: AbortSignal): Promise<string> {
  const config = JSON.parse(await smallFile(filename)) as { name: string; command?: string; args?: string[]; url?: string };
  if (!/^[a-z][a-z0-9_-]{0,39}$/.test(config.name) || capabilities.names().includes(config.name)) throw new Error('Invalid or duplicate MCP server name.');
  if (Boolean(config.command) === Boolean(config.url)) throw new Error('Configure exactly one command or HTTPS URL.');
  if (config.args && (!Array.isArray(config.args) || config.args.some(arg => typeof arg !== 'string'))) throw new Error('MCP args must be strings.');
  if (config.url) {
    const url = new URL(config.url);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Remote MCP requires HTTPS without URL credentials.');
  }
  const client = new Client({ name: 'robinhood', version: '0.0.1' });
  const transport = config.url ? new StreamableHTTPClientTransport(new URL(config.url)) : new StdioClientTransport({ command: config.command!, args: config.args ?? [], env: minimalEnvironment() as Record<string, string>, stderr: 'pipe', maxBufferSize: 1024 * 1024 });
  if (transport instanceof StdioClientTransport) transport.stderr?.on('data', () => {});
  const abort = () => { void client.close(); };
  signal.throwIfAborted(); signal.addEventListener('abort', abort, { once: true });
  try {
    await client.connect(transport, { timeout: 15000 });
    signal.throwIfAborted();
    const tools: ExtensionTool[] = [];
    if (client.getServerCapabilities()?.tools) {
      let cursor: string | undefined; let pages = 0;
      do {
        if (++pages > 10) throw new Error('MCP tool catalog pagination limit reached.');
        const page = await client.listTools(cursor ? { cursor } : undefined, { signal, timeout: 15000 });
        for (const tool of page.tools) tools.push({
          definition: { type: 'function', function: { name: `${config.name}__${tool.name}`, description: tool.description, parameters: tool.inputSchema } },
          execute: async (args, _context, signal) => JSON.stringify(await client.callTool({ name: tool.name, arguments: args }, undefined, { signal, timeout: 120000 })),
        });
        if (tools.length > 120) throw new Error('MCP server advertises too many tools.');
        cursor = page.nextCursor;
      } while (cursor);
    }
    if (client.getServerCapabilities()?.resources) {
      tools.push({ definition: { type: 'function', function: { name: `${config.name}__resource_templates`, description: 'List MCP resource templates. Supply cursor for another page.', parameters: { type: 'object', properties: { cursor: { type: 'string' } } } } }, execute: async (args, _context, signal) => JSON.stringify(await client.listResourceTemplates({ cursor: args.cursor as string | undefined }, { signal, timeout: 15000 })) });
      tools.push({ definition: { type: 'function', function: { name: `${config.name}__resources`, description: 'List MCP resources. Supply cursor for another page.', parameters: { type: 'object', properties: { cursor: { type: 'string' } } } } }, execute: async (args, _context, signal) => JSON.stringify(await client.listResources({ cursor: args.cursor as string | undefined }, { signal, timeout: 15000 })) });
      tools.push({ definition: { type: 'function', function: { name: `${config.name}__read_resource`, description: 'Read a resource from this MCP server.', parameters: { type: 'object', properties: { uri: { type: 'string' } }, required: ['uri'] } } }, execute: async (args, _context, signal) => JSON.stringify(await client.readResource({ uri: String(args.uri) }, { signal, timeout: 15000 })) });
    }
    capabilities.register(config.name, tools, () => client.close());
    return config.name;
  } catch (error) { await client.close(); throw error; }
  finally { signal.removeEventListener('abort', abort); }
}
