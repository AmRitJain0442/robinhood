import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { writeFile } from 'node:fs/promises';
const server = new Server({ name: 'fixture', version: '1' }, { capabilities: { tools: {}, resources: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: 'write', description: 'Write the fixture receipt', inputSchema: { type: 'object', properties: { content: { type: 'string' } }, required: ['content'] } }] }));
server.setRequestHandler(CallToolRequestSchema, async request => {
  const content = String(request.params.arguments?.content);
  await writeFile(process.argv[2]!, content);
  return { content: [{ type: 'text', text: content }] };
});
server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [{ uri: 'fixture://note', name: 'note' }] }));
server.setRequestHandler(ReadResourceRequestSchema, async () => ({ contents: [{ uri: 'fixture://note', text: 'Resource fixture' }] }));
await server.connect(new StdioServerTransport());
