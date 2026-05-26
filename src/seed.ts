import type { Payload } from 'payload'

// A fixed API key so the reproduction is runnable with a single curl command.
// `payload-mcp-api-keys` uses Payload's `useAPIKey` auth strategy: providing
// `apiKey` here makes Payload store the matching `apiKeyIndex` (HMAC-sha256 of
// the key with `payload.secret`), which is exactly what `POST /api/mcp` looks up.
export const MCP_API_KEY = 'repro-mcp-api-key-1234567890'

/**
 * Seeds a user and an MCP API key with the `posts` create/update/find/delete
 * capabilities enabled. Enabling `create` or `update` is what makes the MCP
 * server try to build a Zod input schema from the collection schema on the very
 * first request — which is where the TypeScript 6 bug surfaces.
 */
export const seed = async (payload: Payload): Promise<void> => {
  const existing = await payload.find({
    collection: 'payload-mcp-api-keys',
    limit: 1,
    pagination: false,
  })

  if (existing.docs.length > 0) {
    payload.logger.info('[seed] MCP API key already present, skipping seed.')
    return
  }

  const users = await payload.find({ collection: 'users', limit: 1, pagination: false })

  const user =
    users.docs[0] ??
    (await payload.create({
      collection: 'users',
      data: {
        email: 'demo@example.com',
        password: 'demo',
      },
    }))

  await payload.create({
    collection: 'payload-mcp-api-keys',
    data: {
      user: user.id,
      label: 'Reproduction key',
      enableAPIKey: true,
      apiKey: MCP_API_KEY,
      // Capability flags for the `posts` collection. `create`/`update` force the
      // plugin to derive a Zod schema from the Payload schema on registration.
      posts: {
        create: true,
        update: true,
        find: true,
        delete: true,
      },
    } as never,
  })

  payload.logger.info('[seed] Created MCP API key for the reproduction.')
}
