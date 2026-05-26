# `@payloadcms/plugin-mcp`: tool registration fails under TypeScript 6 (`x.partial is not a function`)

## Description of the issue

With `typescript@6.x` installed, no collection/global MCP tool that derives its input schema from
the Payload schema can register. The first `POST /api/mcp` request after auth throws a 500 during
tool registration, aborting the handler — the request gets no HTTP response.

```
APIError: Error registering tools for collection posts: TypeError: convertedFields.partial is not a function
  status: 500
```

The collection in the message is just whichever is first in iteration order; every enabled
create/update tool is affected. It does **not** reproduce on `typescript@5.x`.

### Root cause

`convertCollectionSchemaToZod` builds the schema by transpiling a Zod source string and `eval`ing
it via `new Function('z', 'return ' + transpileResult.outputText)(z)`. TypeScript 6 prepends a
`"use strict";` directive prologue to the transpiled output that TS 5 did not, so the function
body becomes:

```js
function (z) {
  return "use strict";                // ← returns the STRING "use strict"
  z.object({ /* ... */ }).strict();   // ← unreachable
}
```

`convertCollectionSchemaToZod()` therefore returns the string `"use strict"` instead of a
`ZodObject`, and the create/update tools then call `.partial()` / `.shape` on it — throwing
`partial is not a function`.

Transpiling `z.object({ "title": z.string() }).strict()` with the plugin's compiler options
confirms it:

```
ts 6.0.3 → outputText "\"use strict\";\nz.object(...).strict();\n"  → new Function(...)(z) === "use strict" (string)
ts 5.7.3 → outputText "z.object(...).strict();\n"                   → new Function(...)(z) === ZodObject
```

Note: `typescript` is a phantom dependency of the plugin — it's `import`ed but not declared in
`dependencies`/`peerDependencies`, so pnpm silently resolves the consumer app's compiler.

## Link to the code

- [`packages/plugin-mcp/src/utils/schemaConversion/convertCollectionSchemaToZod.ts`](https://github.com/payloadcms/payload/blob/main/packages/plugin-mcp/src/utils/schemaConversion/convertCollectionSchemaToZod.ts)
- [`packages/plugin-mcp/src/mcp/tools/resource/update.ts`](https://github.com/payloadcms/payload/blob/main/packages/plugin-mcp/src/mcp/tools/resource/update.ts)
- [`packages/plugin-mcp/src/mcp/tools/resource/create.ts`](https://github.com/payloadcms/payload/blob/main/packages/plugin-mcp/src/mcp/tools/resource/create.ts)
- [`packages/plugin-mcp/src/mcp/tools/global/update.ts`](https://github.com/payloadcms/payload/blob/main/packages/plugin-mcp/src/mcp/tools/global/update.ts)

## Reproduction Steps

1. Clone the reproduction repository and run the development server (`pnpm dev`). On first boot an
   `onInit` seed creates a user and an MCP API key (`repro-mcp-api-key-1234567890`) with the
   `posts` capabilities enabled.
2. Send a single MCP `initialize` request to `POST /api/mcp` with that key:

   ```bash
   curl -s -i -X POST http://localhost:3000/api/mcp \
     -H 'Authorization: Bearer repro-mcp-api-key-1234567890' \
     -H 'Content-Type: application/json' \
     -H 'Accept: application/json, text/event-stream' \
     -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"repro","version":"1.0.0"}}}'
   ```

3. **Expected**: the `posts` tools register and `initialize` succeeds.
4. **Actual**: registration throws, the handler aborts (no HTTP response), and the server logs:

   ```
   [payload-mcp] ❌ Tool: Update posts Failed to register.
   Error [APIError]: Error registering tools for collection posts: TypeError: convertedFields.partial is not a function
     status: 500
   ```

5. Switch `typescript` to a `5.x` release, reinstall, and the same request succeeds.

## Environment Info

```
Binaries:
  Node: 24.3.0
  npm: 11.4.2
  pnpm: 10.33.0
Relevant Packages:
  payload: 3.84.1
  next: 16.2.6
  @payloadcms/db-mongodb: 3.84.1
  @payloadcms/plugin-mcp: 3.84.1
  @payloadcms/richtext-lexical: 3.84.1
  react: 19.2.1
  typescript: 6.0.3   (devDependency; resolved into the plugin as a phantom dependency)
Operating System:
  Platform: darwin
  Arch: arm64
  Version: Darwin Kernel Version 24.6.0
```
