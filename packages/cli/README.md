# rukmer

Command line for [Rukmer](https://app.rukmer.com) Memory.

## Use

```bash
npx rukmer setup --api-key rk_live_… --url https://app.rukmer.com --yes
npx rukmer search "what did we decide"
npx rukmer add "Ship the console setup card"
npx rukmer profile
```

`setup` writes `RUKMER_API_KEY` and `RUKMER_URL` to `.env` (or `.env.local` if that file already exists), adds the env file to `.gitignore` when one exists, merges a `rukmer` MCP server into `.cursor/mcp.json`, and sends one search so the console's first-request check turns green. The full key is not printed after it is saved.

## Flags

| Flag | Meaning |
| --- | --- |
| `--api-key` | API key from the Rukmer console |
| `--url` | API origin. Defaults to `https://app.rukmer.com` |
| `--yes` | Do not prompt |
| `--help` | Help for the current command |

## Publish

TJ publishes this package. From `packages/cli`, after `npm run build`:

```bash
npm login
npm publish --access public
```

Use an npm one-time password if the account requires it. Do not publish from CI in this repo.
