# MCP App Trino

MCP Apps-compliant Trino and Starburst query visualization server. It exposes normal Trino discovery/query tools plus an interactive `visualize_query` tool that renders query results in an MCP App preview using Elastic Charts.

## Features

- Trino/Starburst SQL execution over the Trino HTTP API.
- Read-only guard for `SELECT`, `WITH`, `SHOW`, `DESCRIBE`, and `EXPLAIN`.
- Discovery tools: `list_catalogs`, `list_schemas`, `list_tables`, `get_table_schema`, `explain_query`.
- MCP Apps UI tool: `visualize_query`.
- Elastic Charts previews for bar, stacked bar, normalized stacked bar, line, area, stacked area, scatter, bubble, heatmap, pie, donut, sunburst, treemap, metric, goal, and table views.
- Stdio transport compatible with Rubberband, Claude Desktop, Cursor, and other MCP clients.

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

## Local Development

```bash
npm install
npm run build
npm run start:stdio
```

## Rubberband App Config

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
    "STARBURST_HOST",
    "STARBURST_PORT",
    "STARBURST_SCHEME",
    "STARBURST_USER",
    "STARBURST_PASSWORD",
    "STARBURST_ACCESS_TOKEN",
    "STARBURST_CATALOG",
    "STARBURST_SCHEMA",
    "NODE_TLS_REJECT_UNAUTHORIZED"
  ]
}
```

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
