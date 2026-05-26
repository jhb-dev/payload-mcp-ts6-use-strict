# `@payloadcms/plugin-mcp`: every collection/global tool fails to register under TypeScript 6 (`x.partial is not a function`)

## Description of the issue

With `typescript@6.x` installed, **no** collection or global MCP tool that derives its input
schema from the Payload schema can register. The first request to `POST /api/mcp` after the
auth handshake throws a 500 during tool registration, which aborts the whole handler — so the
MCP connection never completes.

The thrown error:

```
APIError: Error registering tools for collection posts: TypeError: convertedFields.partial is not a function
  status: 500
```

The collection named in the error is just **whichever collection/global is first in iteration
order** — it is not specific to that collection. Every enabled create/update tool is affected;
the handler aborts on the first one.

The bug does **not** reproduce on `typescript@5.x`. Pinning TS back to 5.x is a workaround.

### Root cause

`@payloadcms/plugin-mcp` builds the Zod input schema for the create/update tools at runtime by:

1. converting the collection's JSON schema to a **string** of Zod source via `json-schema-to-zod`,
2. transpiling that string with `ts.transpileModule(...)`,
3. evaluating the result with `new Function('z', 'return ' + outputText)(z)`.

See `convertCollectionSchemaToZod`:

```js
const transpileResult = ts.transpileModule(zodSchemaAsString, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    removeComments: true,
    strict: false,
    target: ts.ScriptTarget.ES2018,
  },
})
// ...
return new Function('z', `return ${transpileResult.outputText}`)(z)
```

**TypeScript 6** prepends a `"use strict";` directive prologue to the transpiled CommonJS
output, which TypeScript 5 did not for this input. So `transpileResult.outputText` becomes:

```js
"use strict";
z.object({ /* ... */ }).strict();
```

Wrapping that in `return ${outputText}` produces this function body:

```js
function (z) {
  return "use strict";                // ← returns the STRING "use strict"
  z.object({ /* ... */ }).strict();   // ← unreachable dead code
}
```

`return "use strict";` is a return statement returning the directive **as a string literal**.
So `convertCollectionSchemaToZod()` returns the primitive string `"use strict"` for every
collection, instead of a `ZodObject`.

The crash then happens in the update tool, which assumes a `ZodObject`:

```js
const convertedFields = convertCollectionSchemaToZod(schema) // actually the string "use strict"
const updateResourceSchema = z.object({
  ...convertedFields.partial().shape, // ← "use strict".partial is not a function ⇒ throws
})
```

The same `.partial()` / `.shape` pattern exists in the global update tool, and the create tool
builds `z.object({ ...convertedFields.shape })`, which breaks the same way.

> Note: `convertCollectionSchemaToZod` has an internal `try/catch` that falls back to
> `z.record(z.any())` on conversion failure — but this path does **not** throw, so the catch is
> never hit. And even the fallback `z.record(...)` would still break `.partial()`
> (a `ZodRecord` has no `.partial()`), so the fallback is independently fragile.

### `typescript` is a phantom dependency

The plugin does `import * as ts from 'typescript'` but lists **no** `typescript` in its
`dependencies`, `devDependencies`, or `peerDependencies`. Under pnpm it silently resolves the
consumer app's TypeScript — which is exactly how a TS-6 app drags an untested compiler into the
plugin.

## Link to the code

- [`packages/plugin-mcp/src/utils/schemaConversion/convertCollectionSchemaToZod.ts`](https://github.com/payloadcms/payload/blob/main/packages/plugin-mcp/src/utils/schemaConversion/convertCollectionSchemaToZod.ts)
- [`packages/plugin-mcp/src/mcp/tools/resource/update.ts`](https://github.com/payloadcms/payload/blob/main/packages/plugin-mcp/src/mcp/tools/resource/update.ts)
- [`packages/plugin-mcp/src/mcp/tools/resource/create.ts`](https://github.com/payloadcms/payload/blob/main/packages/plugin-mcp/src/mcp/tools/resource/create.ts)
- [`packages/plugin-mcp/src/mcp/tools/global/update.ts`](https://github.com/payloadcms/payload/blob/main/packages/plugin-mcp/src/mcp/tools/global/update.ts)

## Reproduction Steps

1. Clone the reproduction repository and run the development server (`pnpm dev`). On first boot
   an `onInit` seed creates a user and an MCP API key (`repro-mcp-api-key-1234567890`) with the
   `posts` create/update/find/delete capabilities enabled.
2. Send a single MCP `initialize` request to `POST /api/mcp` with that key:

   ```bash
   curl -s -i -X POST http://localhost:3000/api/mcp \
     -H 'Authorization: Bearer repro-mcp-api-key-1234567890' \
     -H 'Content-Type: application/json' \
     -H 'Accept: application/json, text/event-stream' \
     -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"repro","version":"1.0.0"}}}'
   ```

3. **Expected**: the MCP server registers the `posts` tools and the `initialize` request succeeds.
4. **Actual**: tool registration throws, the handler aborts (the request gets **no** HTTP
   response), and the server logs:

   ```
   [payload-mcp] ❌ Tool: Update posts Failed to register.
   Error [APIError]: Error registering tools for collection posts: TypeError: convertedFields.partial is not a function
     status: 500
   ⨯ unhandledRejection: Error [APIError]: Error registering tools for collection posts: TypeError: convertedFields.partial is not a function
   ```

5. Switch `typescript` to a `5.x` release, reinstall, and confirm the same request now succeeds —
   demonstrating the TS-major-version dependency.

### Root-cause evidence

Running `ts.transpileModule(...)` (with the plugin's exact compiler options) on the Zod source
`z.object({ "title": z.string() }).strict()`, then `new Function('z', 'return ' + output)(z)`:

```
# typescript 6.0.3
outputText:  "\"use strict\";\nz.object({ \"title\": z.string() }).strict();\n"
result:      typeof = string,   value = "use strict",   .partial is a function = false

# typescript 5.7.3
outputText:  "z.object({ \"title\": z.string() }).strict();\n"
result:      typeof = function, (ZodObject)              .partial is a function = true
```

## Suggested Fix

Strip the directive prologue before evaluating (one-line, minimal):

```js
const body = transpileResult.outputText.replace(/^\s*["']use strict["'];?\s*/, '')
return new Function('z', `return ${body}`)(z)
```

More robust alternatives:

- Don't rely on `return ${output}` at all — assign the transpiled expression to a variable and
  return that, so a leading directive can't hijack the `return`.
- Declare `typescript` as an explicit `dependency` / `peerDependency` so the plugin doesn't
  silently inherit an untested compiler major from the consumer app.

## Environment Info

```
Binaries:
  Node: 24.3.0
  npm: 11.4.2
  Yarn: 1.22.22
  pnpm: 10.33.0
Relevant Packages:
  payload: 3.84.1
  next: 16.2.6
  @payloadcms/db-mongodb: 3.84.1
  @payloadcms/graphql: 3.84.1
  @payloadcms/next/utilities: 3.84.1
  @payloadcms/plugin-mcp: 3.84.1
  @payloadcms/richtext-lexical: 3.84.1
  @payloadcms/translations: 3.84.1
  @payloadcms/ui/shared: 3.84.1
  react: 19.2.1
  react-dom: 19.2.1
  typescript: 6.0.3   (devDependency; resolved into the plugin as a phantom dependency)
Operating System:
  Platform: darwin
  Arch: arm64
  Version: Darwin Kernel Version 24.6.0
  Available memory (MB): 24576
  Available CPU cores: 14
```
