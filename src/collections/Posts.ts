import type { CollectionConfig } from 'payload'

// A minimal collection — the bug is NOT specific to any field shape.
// Any collection enabled for the MCP plugin's create/update tools triggers it,
// because the failure is in the plugin's generic JSON-schema -> Zod conversion.
export const Posts: CollectionConfig = {
  slug: 'posts',
  admin: {
    useAsTitle: 'title',
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      required: true,
    },
  ],
}
