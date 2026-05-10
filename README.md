# MCP App Trino

MCP Apps-compliant Trino and Starburst query visualization server. It exposes normal Trino discovery/query tools plus an interactive `visualize_query` tool that renders query results in an MCP App preview using Elastic Charts.

## Features

- Trino/Starburst SQL execution over the Trino HTTP API.
- Read-only guard for `SELECT`, `WITH`, `SHOW`, `DESCRIBE`, and `EXPLAIN`.
- Discovery tools: `list_catalogs`, `list_schemas`, `list_tables`, `get_table_schema`, `explain_query`.
- MCP Apps UI tool: `visualize_query`.
- MCP Apps preview controls can call back through the host bridge to refresh the query, switch chart types, remap fields, adjust row limits, and replace the chart without a new chat turn.
- Elastic Charts previews for bar, stacked bar, normalized stacked bar, line, area, stacked area, scatter, bubble, heatmap, pie, donut, sunburst, treemap, metric, goal, and table views, plus force-directed graph/network views.
- Stdio transport compatible with Rubberband, Claude Desktop, Cursor, and other MCP clients.

## Tools

### `visualize_query`

Executes a read-only Trino/Starburst SQL query and returns an MCP App preview rendered with Elastic Charts.
In MCP Apps clients that expose server tool calls to the iframe, the preview also renders controls for editing the SQL, changing chart type, remapping fields, and fetching an updated `visualize_query` result through the bridge.

Inputs:

- `sql`: read-only SQL statement.
- `chartType`: `bar`, `stacked_bar`, `normalized_stacked_bar`, `line`, `area`, `stacked_area`, `scatter`, `bubble`, `heatmap`, `pie`, `donut`, `sunburst`, `treemap`, `graph`, `metric`, `goal`, or `table`.
- `title`: optional chart title.
- `xField`, `yField`, `seriesField`: common XY chart fields.
- `valueField`: numeric measure for heatmaps, partition charts, metric, and goal charts.
- `rowField`, `columnField`: heatmap dimensions.
- `colorField`, `sizeField`: scatter/bubble encodings.
- `goalField`: goal/target value for goal charts.
- `sourceField`, `targetField`, `edgeWeightField`, `nodeLabelField`, `groupField`: graph/network encodings.
- `partitionFields`: dimensions for pie, donut, sunburst, and treemap charts.
- `maxRows`: row limit for preview data, default `1000`, maximum `5000`.

### `execute_query`

Executes a read-only Trino/Starburst SQL query and returns JSON rows without an MCP App preview.

Inputs:

- `sql`: read-only SQL statement.
- `maxRows`: row limit, default `1000`, maximum `5000`.

### `list_catalogs`

Lists available Trino catalogs.

### `list_schemas`

Lists schemas, optionally for a supplied catalog.

Inputs:

- `catalog`: optional catalog name.

### `list_tables`

Lists tables, optionally scoped to a catalog and schema.

Inputs:

- `catalog`: optional catalog name.
- `schema`: optional schema name.

### `get_table_schema`

Runs `DESCRIBE` for a table and returns the table schema. The table input is limited to simple unquoted identifiers, optionally qualified as `catalog.schema.table`.

Inputs:

- `table`: table identifier such as `tpch.tiny.orders`.

### `explain_query`

Runs `EXPLAIN` for a read-only SQL query.

Inputs:

- `sql`: read-only SQL statement to explain.

## Safety Model

This server is designed for read-only analytics, but no application-layer SQL guard should be treated as a complete database security boundary.

Current guardrails:

- Only `SELECT`, `WITH`, `SHOW`, `DESCRIBE`, `DESC`, and `EXPLAIN` statements are accepted.
- Semicolons are rejected to avoid multi-statement requests.
- Mutating/control keywords such as `INSERT`, `UPDATE`, `DELETE`, `CREATE`, `DROP`, `ALTER`, `TRUNCATE`, `MERGE`, `CALL`, `GRANT`, `REVOKE`, `SET`, `ANALYZE`, `COMMIT`, and `ROLLBACK` are blocked outside strings/comments.
- Discovery helper tools quote catalog/schema identifiers where they compose SQL.
- `get_table_schema` rejects arbitrary SQL fragments and only accepts simple qualified table identifiers.

This is not a claim of being 100% immune to SQL injection or misuse. The strongest protection is to connect with a Trino/Starburst identity that has read-only permissions at the catalog/schema/table level. Treat the SQL validator as defense in depth, not as the primary permission model.

## Configuration

Set environment variables before starting the server:

```bash
TRINO_HOST=localhost
TRINO_PORT=8080
TRINO_SCHEME=http
TRINO_USER=trino
TRINO_PASSWORD=
TRINO_CATALOG=tpch
TRINO_SCHEMA=tiny
TRINO_AUTH_TYPE=none
```

For Starburst or secured Trino:

```bash
TRINO_SCHEME=https
TRINO_AUTH_TYPE=basic
TRINO_USER=alice
TRINO_PASSWORD=...
```

Bearer token auth is also supported with `TRINO_AUTH_TYPE=bearer` and `TRINO_ACCESS_TOKEN`.

### TLS

For internal or self-signed Trino/Starburst endpoints, prefer passing a CA certificate instead of disabling verification:

```bash
TRINO_SCHEME=https
TRINO_CA_CERT_FILE=/absolute/path/to/ca.pem
```

You can also pass PEM content directly. Literal `\n` sequences are converted to newlines:

```bash
TRINO_CA_CERT="-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"
```

If you need to bypass certificate verification for an internal endpoint, set one of:

```bash
TRINO_INSECURE_TLS=true
TRINO_TLS_INSECURE=true
NODE_TLS_REJECT_UNAUTHORIZED=0
```

For mutual TLS/client-certificate auth, provide a client cert and key:

```bash
TRINO_CLIENT_CERT_FILE=/absolute/path/to/client.crt
TRINO_CLIENT_KEY_FILE=/absolute/path/to/client.key
TRINO_CLIENT_KEY_PASSPHRASE=
```

Direct PEM content is also supported with `TRINO_CLIENT_CERT` and `TRINO_CLIENT_KEY`. Starburst-prefixed aliases are supported for the same settings: `STARBURST_CA_CERT_FILE`, `STARBURST_CLIENT_CERT_FILE`, `STARBURST_CLIENT_KEY_FILE`, `STARBURST_INSECURE_TLS`, and related non-`_FILE` variants.

## Local Development

```bash
npm install
npm run build
npm run start:stdio
```

## Client Setup

This project is a generic stdio MCP server with an MCP Apps UI resource. It can be used from any MCP client that can start local stdio servers. Clients with MCP Apps support can render the interactive chart preview; clients without MCP Apps support can still use the text and structured tool results.

Build the server once before wiring it into a client:

```bash
git clone https://github.com/metalshanked/mcp-app-trino.git
cd mcp-app-trino
npm install
npm run build
```

Use the absolute path to `dist/server/index.js` in client configs below. Replace `/absolute/path/to/mcp-app-trino` with your local clone path.

Common environment variables:

```json
{
  "TRINO_HOST": "localhost",
  "TRINO_PORT": "8080",
  "TRINO_SCHEME": "http",
  "TRINO_USER": "trino",
  "TRINO_CATALOG": "tpch",
  "TRINO_SCHEMA": "tiny",
  "TRINO_AUTH_TYPE": "none"
}
```

For secured Trino or Starburst, add `TRINO_PASSWORD` with `TRINO_AUTH_TYPE=basic`, or `TRINO_ACCESS_TOKEN` with `TRINO_AUTH_TYPE=bearer`.

### Rubberband

Add this app to Rubberband's `mcp-apps.json`:

```json
{
  "id": "mcp-app-trino",
  "name": "Trino Visualization",
  "description": "Query Trino or Starburst and render MCP App previews with Elastic Charts.",
  "source": {
    "type": "git",
    "url": "https://github.com/metalshanked/mcp-app-trino.git",
    "ref": "master"
  },
  "install": [
    ["npm", "install"],
    ["npm", "run", "build"]
  ],
  "transport": {
    "type": "stdio",
    "command": "npm",
    "args": ["run", "start:stdio"],
    "cwd": "${appDir}"
  },
  "envPassthrough": [
    "TRINO_HOST",
    "TRINO_PORT",
    "TRINO_SCHEME",
    "TRINO_SSL",
    "TRINO_USER",
    "TRINO_PASSWORD",
    "TRINO_ACCESS_TOKEN",
    "TRINO_AUTH_TYPE",
    "TRINO_CATALOG",
    "TRINO_SCHEMA",
    "TRINO_SOURCE",
    "TRINO_INSECURE_TLS",
    "TRINO_TLS_INSECURE",
    "TRINO_CA_CERT",
    "TRINO_CA_CERT_FILE",
    "TRINO_TLS_CA_CERT",
    "TRINO_TLS_CA_CERT_FILE",
    "TRINO_CLIENT_CERT",
    "TRINO_CLIENT_CERT_FILE",
    "TRINO_CLIENT_KEY",
    "TRINO_CLIENT_KEY_FILE",
    "TRINO_CLIENT_KEY_PASSPHRASE",
    "TRINO_TLS_CLIENT_CERT",
    "TRINO_TLS_CLIENT_CERT_FILE",
    "TRINO_TLS_CLIENT_KEY",
    "TRINO_TLS_CLIENT_KEY_FILE",
    "TRINO_TLS_CLIENT_KEY_PASSPHRASE",
    "STARBURST_HOST",
    "STARBURST_PORT",
    "STARBURST_SCHEME",
    "STARBURST_USER",
    "STARBURST_PASSWORD",
    "STARBURST_ACCESS_TOKEN",
    "STARBURST_CATALOG",
    "STARBURST_SCHEMA",
    "STARBURST_INSECURE_TLS",
    "STARBURST_TLS_INSECURE",
    "STARBURST_CA_CERT",
    "STARBURST_CA_CERT_FILE",
    "STARBURST_TLS_CA_CERT",
    "STARBURST_TLS_CA_CERT_FILE",
    "STARBURST_CLIENT_CERT",
    "STARBURST_CLIENT_CERT_FILE",
    "STARBURST_CLIENT_KEY",
    "STARBURST_CLIENT_KEY_FILE",
    "STARBURST_CLIENT_KEY_PASSPHRASE",
    "STARBURST_TLS_CLIENT_CERT",
    "STARBURST_TLS_CLIENT_CERT_FILE",
    "STARBURST_TLS_CLIENT_KEY",
    "STARBURST_TLS_CLIENT_KEY_FILE",
    "STARBURST_TLS_CLIENT_KEY_PASSPHRASE",
    "NODE_TLS_REJECT_UNAUTHORIZED"
  ]
}
```

### Claude Code

Claude Code supports local stdio MCP servers through `claude mcp add` or JSON config. See the Claude MCP docs for current details.

CLI example:

```bash
claude mcp add --transport stdio \
  --env TRINO_HOST=localhost \
  --env TRINO_PORT=8080 \
  --env TRINO_SCHEME=http \
  --env TRINO_USER=trino \
  --env TRINO_CATALOG=tpch \
  --env TRINO_SCHEMA=tiny \
  --env TRINO_AUTH_TYPE=none \
  mcp-app-trino -- node /absolute/path/to/mcp-app-trino/dist/server/index.js
```

Project `.mcp.json` example:

```json
{
  "mcpServers": {
    "mcp-app-trino": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/mcp-app-trino/dist/server/index.js"],
      "env": {
        "TRINO_HOST": "localhost",
        "TRINO_PORT": "8080",
        "TRINO_SCHEME": "http",
        "TRINO_USER": "trino",
        "TRINO_CATALOG": "tpch",
        "TRINO_SCHEMA": "tiny",
        "TRINO_AUTH_TYPE": "none"
      }
    }
  }
}
```

### Claude Desktop

Claude Desktop uses an MCP server configuration file with the `mcpServers` object. Add an entry like this to `claude_desktop_config.json`, then restart Claude Desktop:

```json
{
  "mcpServers": {
    "mcp-app-trino": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/mcp-app-trino/dist/server/index.js"],
      "env": {
        "TRINO_HOST": "localhost",
        "TRINO_PORT": "8080",
        "TRINO_SCHEME": "http",
        "TRINO_USER": "trino",
        "TRINO_CATALOG": "tpch",
        "TRINO_SCHEMA": "tiny",
        "TRINO_AUTH_TYPE": "none"
      }
    }
  }
}
```

### Cursor

Cursor supports project config at `.cursor/mcp.json` and global config at `~/.cursor/mcp.json`.

```json
{
  "mcpServers": {
    "mcp-app-trino": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/mcp-app-trino/dist/server/index.js"],
      "env": {
        "TRINO_HOST": "localhost",
        "TRINO_PORT": "8080",
        "TRINO_SCHEME": "http",
        "TRINO_USER": "trino",
        "TRINO_CATALOG": "tpch",
        "TRINO_SCHEMA": "tiny",
        "TRINO_AUTH_TYPE": "none"
      }
    }
  }
}
```

### VS Code

VS Code MCP configuration uses a top-level `servers` object. You can place this in `.vscode/mcp.json` or use the MCP user configuration command. MCP Apps rendering may require the `chat.mcp.apps.enabled` setting, depending on your VS Code build.

```json
{
  "servers": {
    "mcpAppTrino": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/mcp-app-trino/dist/server/index.js"],
      "env": {
        "TRINO_HOST": "localhost",
        "TRINO_PORT": "8080",
        "TRINO_SCHEME": "http",
        "TRINO_USER": "trino",
        "TRINO_CATALOG": "tpch",
        "TRINO_SCHEMA": "tiny",
        "TRINO_AUTH_TYPE": "none"
      }
    }
  }
}
```

### Other MCP Clients

Any stdio MCP client should be able to start the server with:

```json
{
  "type": "stdio",
  "command": "node",
  "args": ["/absolute/path/to/mcp-app-trino/dist/server/index.js"],
  "env": {
    "TRINO_HOST": "localhost",
    "TRINO_PORT": "8080",
    "TRINO_SCHEME": "http",
    "TRINO_USER": "trino",
    "TRINO_CATALOG": "tpch",
    "TRINO_SCHEMA": "tiny",
    "TRINO_AUTH_TYPE": "none"
  }
}
```

## Client References

- [Claude Code MCP docs](https://code.claude.com/docs/en/mcp)
- [Cursor MCP docs](https://docs.cursor.com/advanced/model-context-protocol)
- [VS Code MCP configuration reference](https://code.visualstudio.com/docs/copilot/reference/mcp-configuration)
- [VS Code MCP Apps notes](https://code.visualstudio.com/docs/copilot/customization/mcp-servers)

## Example Prompt

```text
Use Trino Visualization to chart total orders by orderstatus from tpch.tiny.orders.
```

The model should call `visualize_query` with a query like:

```sql
SELECT orderstatus, count(*) AS orders
FROM tpch.tiny.orders
GROUP BY orderstatus
ORDER BY orders DESC
```

For richer charts, pass the chart-specific fields to `visualize_query`:

- `stacked_bar` / `stacked_area`: `xField`, `yField`, `seriesField`
- `heatmap`: `rowField`, `columnField`, `valueField`
- `pie` / `donut` / `sunburst` / `treemap`: `partitionFields`, `valueField`
- `bubble`: `xField`, `yField`, `sizeField`, optional `colorField`
- `goal`: `valueField`, `goalField`
- `graph`: `sourceField`, `targetField`, optional `edgeWeightField`, `nodeLabelField`, `groupField`

Graph/network example:

```sql
SELECT source_service AS source, target_service AS target, count(*) AS weight
FROM service_calls
GROUP BY source_service, target_service
ORDER BY weight DESC
LIMIT 200
```

Use `chartType: "graph"`, `sourceField: "source"`, `targetField: "target"`, and `edgeWeightField: "weight"`.

## License

MIT License. See [LICENSE](./LICENSE).
