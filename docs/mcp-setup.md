# MCP Setup (opencode + Supabase)

This file documents how the MCP servers used by opencode are authenticated and
why `.env.local` is **not** part of that flow.

## Where the config lives

MCP servers are declared in `opencode.json` at the repository root. That file is
listed in `.gitignore`, so it is **not** shared with the team. Every developer
creates their own copy by hand using the entries below.

Your global config at `~/.config/opencode/opencode.jsonc` is currently empty and
can be left that way. Keep the Supabase entry in the project file rather than the
global one: it is pinned to a single `project_ref`, and a global entry would load
a connection to this one church project in every repository you open.

## GitHub MCP

Configured in `opencode.json` as a remote MCP server with an API key header:

```json
"github": {
  "type": "remote",
  "url": "https://api.githubcopilot.com/mcp/",
  "enabled": true,
  "headers": {
    "Authorization": "{env:GITHUB_TOKEN}"
  }
}
```

The token is a GitHub fine-grained PAT. opencode reads it from your **operator
environment**, not from `.env.local`. Before launching opencode, run this in
PowerShell:

```powershell
$env:GITHUB_TOKEN = '<value>'
opencode
```

Important notes:

- The `{env:GITHUB_TOKEN}` placeholder is resolved only when opencode starts, so
  you must **restart opencode** after changing the value.
- `.env.local` is **never read by opencode**; it is only loaded by Next.js at
  build/dev time. Putting the key there will not authenticate the MCP server.
- `GITHUB_TOKEN` in your shell must hold the **same** PAT you intend to use. If
  you rotate the token in GitHub, update the shell variable too, or the
  placeholder will silently resolve to a stale credential and the server will
  report `401`.
- To confirm the placeholder resolved, run `opencode mcp list` and check that
  `github` reports `connected`. A `401` or `auth failed` state almost always means
  `GITHUB_TOKEN` was unset, empty, or stale at startup.

## Supabase MCP

The Supabase MCP server is project-scoped and uses OAuth 2.1. Add it to
`opencode.json`:

```json
"supabase": {
  "type": "remote",
  "url": "https://mcp.supabase.com/mcp?project_ref=<project-ref>&features=docs,account,database,debugging,development",
  "enabled": true
}
```

Find `<project-ref>` in your Supabase project URL. In this repository it is
derived from `NEXT_PUBLIC_SUPABASE_URL` in `.env` (the host segment before the
first dot, e.g. `https://<project-ref>.supabase.co`).

### URL parameters

| Parameter | Effect |
| --- | --- |
| `project_ref=<id>` | Scopes the server to one project. Blocks access to every other project in your Supabase account and disables the account-management tools (`create_project`, `pause_project`, `get_cost`, `get_project`). |
| `features=<groups>` | Comma-separated allowlist of tool groups. Anything omitted is not exposed to the agent. |

Parameters can be combined, as they are above.

The configured `features` set exposes:

- `database` — `list_tables`, `list_extensions`, `list_migrations`,
  `apply_migration`, `execute_sql`
- `debugging` — `query_logs`, `get_advisors`
- `docs` — `search_docs`
- `development` — `generate_typescript_types`, `get_publishable_keys`,
  `get_project_url`
- `account` — present in the URL for compatibility, but **inert**: the server
  disables all account-management tools when `project_ref` is set

### Deliberately not enabled

The Supabase dashboard's default config also includes `functions` and
`branching`. Both are excluded here on purpose:

- `branching` would expose `merge_branch`, `reset_branch`, `rebase_branch`, and
  `delete_branch`. Those are destructive operations against a live production
  database holding real church rosters, services, and assignments — a wider
  blast radius than `execute_sql` on a single table. Supabase also marks
  branching experimental and paid-plan only.
- `functions` would expose `deploy_edge_function`, which can publish code to the
  project.

Add either group only when you have a specific need, and review every call before
approving it.

Read-only mode (`&read_only=true`) is deliberately **not** enabled. This project
uses imperative migrations with no `supabase/config.toml` and no Supabase CLI on
PATH, so `execute_sql` is the only way to iterate on schema before generating a
clean migration file. Use read-only mode for routine queries if you would rather
have that guarantee.

### Agent skills

The Supabase agent skills are already installed at `.agents/skills/supabase/`
and are committed to the repository. There is no need to run
`npx skills add supabase/agent-skills`, and doing so risks overwriting those
tracked files.

### Authenticating

The server uses OAuth with dynamic client registration, so you do **not** need a
personal access token. The `SUPABASE_ACCESS_TOKEN` in `.env` is for the Supabase
CLI and is not used here.

Run the login once. Note the lowercase server name, which must match the key in
`opencode.json`:

```powershell
opencode mcp auth supabase
```

This opens a browser window where you sign in to Supabase and grant opencode
access. Select the organization that owns the project. The resulting token is
cached by opencode in `~/.local/share/opencode/` and reused on startup. Restart
opencode after authenticating.

Verify with:

```powershell
opencode mcp list
```

Expect `supabase connected`. Then confirm the scoping took effect by asking the
agent to list tables; it should only ever return this project's tables.

## Security notes

- Connecting an LLM to this database grants it your developer permissions. Keep
  manual tool-call approval enabled for interactive work, and read each SQL
  statement before approving it. This project enforces `church_id` tenant
  scoping in RLS, so prefer reads scoped to a single church.
- Prompt injection is the main risk: text stored in `members`, `services`, or
  `audit_logs` could attempt to instruct the agent to run unintended SQL. Treat
  agent-produced SQL as untrusted input and review it before it runs.
- The remote MCP server is unauthenticated without a token, so a `401` on a bare
  `GET https://mcp.supabase.com/mcp` is the expected healthy response and means
  the server is up.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `github` shows auth failure at startup | Set `$env:GITHUB_TOKEN` **before** launching opencode, then restart opencode. |
| `supabase` not connected | Run `opencode mcp auth supabase`, complete the browser flow, then restart opencode. |
| `opencode mcp auth supabase` reports unknown server | The name must match the key in `opencode.json` exactly, lowercase. |
| Two Supabase entries appear in `mcp list` | One was added to the global `~/.config/opencode/opencode.json` as well as the project file. Remove one. |
| Supabase tools missing after connecting | The `features` allowlist is excluding them. Add the needed group to the URL. |
| `opencode mcp list` does not show the server | `opencode.json` was not saved as valid JSON, or the entry is missing. Validate it with `Get-Content opencode.json -Raw \| ConvertFrom-Json`. |
| `opencode.json` is empty (0 bytes) | The file was truncated. Restore it from this document. |
| `.env.local` key not picked up by MCP | Expected: opencode does not read `.env.local`. Export the variable in your PowerShell session. |
