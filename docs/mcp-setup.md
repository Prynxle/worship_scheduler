# MCP Setup (opencode + Supabase)

This file documents how the MCP servers used by opencode are authenticated and
why `.env.local` is **not** part of that flow.

## 21st.dev MCP ("21st auth")

The 21st.dev MCP server is configured in `opencode.json` as a remote MCP server
with an API key header:

```json
"21st": {
  "type": "remote",
  "url": "https://21st.dev/api/mcp",
  "enabled": true,
  "headers": {
    "x-api-key": "{env:TWENTY_FIRST_API_KEY}"
  }
}
```

opencode reads the key from your **operator environment**, **not** from
`.env.local`. Before launching opencode, run this in PowerShell:

```powershell
$env:TWENTY_FIRST_API_KEY = '<value>'
opencode
```

Important notes:

- The `{env:TWENTY_FIRST_API_KEY}` placeholder is resolved only when opencode
  starts, so you must **restart opencode** after changing the value.
- `.env.local` is **never read by opencode**; it is only loaded by Next.js at
  build/dev time. Putting the key there will not authenticate the MCP server.
- Do not commit the key. `.env.local` is gitignored.

## Supabase MCP

The Supabase MCP server authenticates with OAuth. Run the CLI login inside
opencode:

```
opencode mcp auth Supabase
```

This opens the Supabase OAuth flow once; the resulting token is cached by
opencode and reused on startup. Restart opencode after authenticating.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| 21st.dev MCP shows auth failure at startup | Set `$env:TWENTY_FIRST_API_KEY` **before** launching opencode, then restart opencode. |
| Supabase MCP not connected | Run `opencode mcp auth Supabase` and restart opencode. |
| `.env.local` key not picked up by MCP | Expected: opencode does not read `.env.local`. Export the variable in your PowerShell session. |