# ADR 0008: MCP over Streamable HTTP on localhost

**Status:** accepted

One MCP server in docker, bound to 127.0.0.1:3100 with a bearer token, using the read-only DB role. Claude Code connects natively (`claude mcp add --transport http`); Claude Desktop on Windows reaches it through WSL2 localhost forwarding via `mcp-remote`. This keeps Postgres without a host port.
