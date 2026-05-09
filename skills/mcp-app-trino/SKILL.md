name: mcp-app-trino
description: Query Trino or Starburst and create MCP App visualizations with Elastic Charts.

# Trino Visualization

Use this app when the user asks to query Trino, Starburst, SQL catalogs, schemas, tables, or build a chart from warehouse data.

Prefer `visualize_query` for user-facing charts and tables. It executes a read-only SQL query and returns an MCP App preview rendered with Elastic Charts.

Use aggregate SQL for chart requests:

- For bar, stacked bar, line, area, stacked area, scatter, and bubble charts, select explicit `xField` and `yField` values.
- For stacked bar or stacked area charts, include a low-cardinality series column and pass it as `seriesField`.
- For heatmaps, provide `rowField`, `columnField`, and `valueField`.
- For pie, donut, sunburst, and treemap charts, provide `partitionFields` and `valueField`.
- For bubble charts, use `sizeField` when a second numeric measure is available.
- For goal charts, use `valueField` and `goalField`.
- Always alias computed measures with readable names.
- Add a sensible `ORDER BY` and limit high-cardinality outputs.

Use discovery tools before writing SQL when table names or schemas are uncertain:

- `list_catalogs`
- `list_schemas`
- `list_tables`
- `get_table_schema`
- `explain_query`

Only use read-only SQL. Do not call mutating statements such as INSERT, UPDATE, DELETE, CREATE, DROP, ALTER, MERGE, or CALL.
