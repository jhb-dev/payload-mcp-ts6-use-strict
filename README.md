# payload-mcp-ts6-use-strict

Minimal reproduction for a Payload CMS v3 bug.

**`@payloadcms/plugin-mcp`: every collection/global tool fails to register under TypeScript 6
(`x.partial is not a function`).**

Under `typescript@6.x`, the plugin's runtime JSON-schema → Zod conversion returns the string
`"use strict"` instead of a `ZodObject`, so the first `POST /api/mcp` request crashes during tool
registration with `TypeError: convertedFields.partial is not a function` (status 500) and the
handler aborts. It works on `typescript@5.x`.

See [`ISSUE.md`](./ISSUE.md) for the full write-up, root cause, and suggested fix.

## Run it

1. Create a `.env` with:

   ```
   DATABASE_URI=mongodb://localhost/payload-mcp-ts6-use-strict
   PAYLOAD_SECRET=super-secret-key-for-reproduction
   ```

2. `pnpm install && pnpm dev`. On first boot an `onInit` seed creates a user and an MCP API key
   (`repro-mcp-api-key-1234567890`) with the `posts` capabilities enabled.

3. Send a single MCP `initialize` request:

   ```bash
   curl -s -i -X POST http://localhost:3000/api/mcp \
     -H 'Authorization: Bearer repro-mcp-api-key-1234567890' \
     -H 'Content-Type: application/json' \
     -H 'Accept: application/json, text/event-stream' \
     -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"repro","version":"1.0.0"}}}'
   ```

   The server logs `TypeError: convertedFields.partial is not a function` and the request gets no
   response. Pin `typescript` to `5.x`, reinstall, and the same request succeeds.
