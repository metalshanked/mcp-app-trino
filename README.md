# MCP App Trino

MCP Apps-compliant Trino and Starburst query visualization server. It exposes normal Trino discovery/query tools plus an interactive `visualize_query` tool that renders query results in an MCP App preview using Elastic Charts.

## Features

- Trino/Starburst SQL execution over the Trino HTTP API.
- Read-only guard for `SELECT`, `WITH`, `SHOW`, `DESCRIBE`, and `EXPLAIN`.
- Discovery tools: `list_catalogs`, `list_schemas`, `list_tables`, `get_table_schema`, `explain_query`.
- MCP Apps UI tool: `visualize_query`.
- Elastic Charts previews for bar, stacked bar, normalized stacked bar, line, area, stacked area, scatter, bubble, heatmap, pie, donut, sunburst, treemap, metric, goal, and table views.
- Stdio transport compatible with Rubberband, Claude Desktop, Cursor, and other MCP clients.

## Tools

### `visualize_query`

Executes a read-only Trino/Starburst SQL query and returns an MCP App preview rendered with Elastic Charts.

Inputs:

- `sql`: read-only SQL statement.
- `chartType`: `bar`, `stacked_bar`, `normalized_stacked_bar`, `line`, `area`, `stacked_area`, `scatter`, `bubble`, `heatmap`, `pie`, `donut`, `sunburst`, `treemap`, `metric`, `goal`, or `table`.
- `title`: optional chart title.
- `xField`, `yField`, `seriesField`: common XY chart fields.
- `valueField`: numeric measure for heatmaps, partition charts, metric, and goal charts.
- `rowField`, `columnField`: heatmap dimensions.
- `colorField`, `sizeField`: scatter/bubble encodings.
- `goalField`: goal/target value for goal charts.
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

## Local Development

```bash
npm install
npm run build
npm run start:stdio
```

## License

MIT License. See [LICENSE](./LICENSE).

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
