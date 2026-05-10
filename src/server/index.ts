#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import { createTrinoClientFromEnv } from './trino-client.js';
import type { ChartSpec, ChartType, VisualizationPayload } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../..');
const PREVIEW_URI = 'ui://mcp-app-trino/chart-preview.html';
const chartTypes = [
  'bar',
  'stacked_bar',
  'normalized_stacked_bar',
  'line',
  'area',
  'stacked_area',
  'scatter',
  'bubble',
  'heatmap',
  'pie',
  'donut',
  'sunburst',
  'treemap',
  'graph',
  'metric',
  'goal',
  'table'
] as const;

const server = new McpServer({
  name: 'mcp-app-trino',
  version: '0.1.0'
});

registerAppResource(
  server,
  'Trino Visualization Preview',
  PREVIEW_URI,
  {
    description: 'Interactive Elastic Charts preview for Trino and Starburst query results.'
  },
  async () => ({
    contents: [
      {
        uri: PREVIEW_URI,
        mimeType: RESOURCE_MIME_TYPE,
        text: await loadPreviewHtml()
      }
    ]
  })
);

registerAppTool(
  server,
  'visualize_query',
  {
    title: 'Visualize Trino Query',
    description:
      'Execute a read-only Trino or Starburst SQL query and render the result as an interactive Elastic Charts preview. Prefer aggregate queries with explicit aliases.',
    inputSchema: {
      sql: z.string().min(1).describe('Trino SQL query to run. Use SELECT/SHOW/DESCRIBE/EXPLAIN style read-only statements.'),
      chartType: z.enum(chartTypes).default('table').describe('Preferred visualization type.'),
      title: z.string().optional().describe('Human-readable chart title.'),
      xField: z.string().optional().describe('Column to use for the x axis or category dimension.'),
      yField: z.string().optional().describe('Numeric column to use for the y axis.'),
      seriesField: z.string().optional().describe('Optional column used to split the chart into series.'),
      valueField: z.string().optional().describe('Numeric measure for heatmaps, pie/donut/sunburst/treemap, metric, and goal charts.'),
      rowField: z.string().optional().describe('Heatmap row dimension.'),
      columnField: z.string().optional().describe('Heatmap column dimension.'),
      colorField: z.string().optional().describe('Optional field for color grouping on scatter/bubble charts.'),
      sizeField: z.string().optional().describe('Optional numeric field for bubble size.'),
      goalField: z.string().optional().describe('Optional numeric target field for goal charts.'),
      sourceField: z.string().optional().describe('Source node field for graph visualizations.'),
      targetField: z.string().optional().describe('Target node field for graph visualizations.'),
      edgeWeightField: z.string().optional().describe('Optional numeric edge weight field for graph visualizations.'),
      nodeLabelField: z.string().optional().describe('Optional node label field for graph visualizations.'),
      groupField: z.string().optional().describe('Optional field used to color graph nodes by group.'),
      partitionFields: z.array(z.string()).optional().describe('Partition dimensions for pie, donut, sunburst, and treemap charts.'),
      maxRows: z.number().int().positive().max(5000).default(1000).describe('Maximum rows to fetch for preview rendering.')
    },
    _meta: {
      ui: {
        resourceUri: PREVIEW_URI
      }
    }
  },
  async ({
    sql,
    chartType,
    title,
    xField,
    yField,
    seriesField,
    valueField,
    rowField,
    columnField,
    colorField,
    sizeField,
    goalField,
    sourceField,
    targetField,
    edgeWeightField,
    nodeLabelField,
    groupField,
    partitionFields,
    maxRows
  }) => {
    assertReadOnlySql(sql);
    const client = createTrinoClientFromEnv();
    const result = await client.execute(sql, maxRows);
    const spec = inferChartSpec(
      chartType,
      {
        title,
        xField,
        yField,
        seriesField,
        valueField,
        rowField,
        columnField,
        colorField,
        sizeField,
        goalField,
        sourceField,
        targetField,
        edgeWeightField,
        nodeLabelField,
        groupField,
        partitionFields
      },
      result.columns
    );
    const payload: VisualizationPayload = {
      kind: 'mcp-app-trino',
      sql,
      catalog: process.env.TRINO_CATALOG || process.env.STARBURST_CATALOG,
      schema: process.env.TRINO_SCHEMA || process.env.STARBURST_SCHEMA,
      spec,
      columns: result.columns,
      rows: result.rows,
      rowCount: result.rowCount,
      truncated: result.truncated,
      generatedAt: new Date().toISOString()
    };

    return {
      content: [
        {
          type: 'text',
          text: summarizePayload(payload)
        }
      ],
      structuredContent: payload
    };
  }
);

server.registerTool(
  'execute_query',
  {
    title: 'Execute Trino Query',
    description: 'Execute a read-only Trino or Starburst SQL query and return JSON rows.',
    inputSchema: {
      sql: z.string().min(1),
      maxRows: z.number().int().positive().max(5000).default(1000)
    }
  },
  async ({ sql, maxRows }) => {
    assertReadOnlySql(sql);
    const result = await createTrinoClientFromEnv().execute(sql, maxRows);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      structuredContent: result
    };
  }
);

server.registerTool('list_catalogs', { title: 'List Trino Catalogs', description: 'List available Trino catalogs.' }, async () => {
  const catalogs = await createTrinoClientFromEnv().listCatalogs();
  return { content: [{ type: 'text', text: catalogs.join('\n') }], structuredContent: { catalogs } };
});

server.registerTool(
  'list_schemas',
  {
    title: 'List Trino Schemas',
    description: 'List schemas in a Trino catalog.',
    inputSchema: { catalog: z.string().optional() }
  },
  async ({ catalog }) => {
    const schemas = await createTrinoClientFromEnv().listSchemas(catalog);
    return { content: [{ type: 'text', text: schemas.join('\n') }], structuredContent: { catalog, schemas } };
  }
);

server.registerTool(
  'list_tables',
  {
    title: 'List Trino Tables',
    description: 'List tables in a Trino catalog/schema.',
    inputSchema: { catalog: z.string().optional(), schema: z.string().optional() }
  },
  async ({ catalog, schema }) => {
    const tables = await createTrinoClientFromEnv().listTables(catalog, schema);
    return { content: [{ type: 'text', text: tables.join('\n') }], structuredContent: { catalog, schema, tables } };
  }
);

server.registerTool(
  'get_table_schema',
  {
    title: 'Get Trino Table Schema',
    description: 'Describe a Trino table. Pass a simple qualified identifier such as catalog.schema.table when possible.',
    inputSchema: { table: z.string().min(1).describe('Simple unquoted table identifier, optionally qualified as catalog.schema.table.') }
  },
  async ({ table }) => {
    assertQualifiedIdentifier(table);
    const result = await createTrinoClientFromEnv().describeTable(table);
    return { content: [{ type: 'text', text: JSON.stringify(result.rows, null, 2) }], structuredContent: result };
  }
);

server.registerTool(
  'explain_query',
  {
    title: 'Explain Trino Query',
    description: 'Run EXPLAIN for a read-only Trino SQL query.',
    inputSchema: { sql: z.string().min(1) }
  },
  async ({ sql }) => {
    assertReadOnlySql(sql);
    const result = await createTrinoClientFromEnv().explain(sql);
    return { content: [{ type: 'text', text: result.rows.map(row => Object.values(row).join(' ')).join('\n') }], structuredContent: result };
  }
);

await server.connect(new StdioServerTransport());

async function loadPreviewHtml() {
  const previewPath = path.resolve(rootDir, 'dist/preview/index.html');
  return fs.readFile(previewPath, 'utf8');
}

function assertReadOnlySql(sql: string) {
  const withoutComments = stripSqlComments(sql).trim();
  const normalized = withoutComments.toLowerCase();

  if (!withoutComments || hasSemicolonOutsideString(withoutComments)) {
    throw new Error('Only a single read-only SQL statement is allowed; semicolons and multi-statement requests are rejected.');
  }

  if (!/^(select|with|show|describe|desc|explain)\b/.test(normalized)) {
    throw new Error('Only read-only SELECT, WITH, SHOW, DESCRIBE, and EXPLAIN statements are allowed.');
  }

  const searchable = stripSqlStrings(withoutComments).toLowerCase();
  const blocked = searchable.match(/\b(insert|update|delete|create|drop|alter|truncate|merge|call|grant|revoke|set|reset|start|commit|rollback|execute|prepare|deallocate|use|analyze)\b/);
  if (blocked) {
    throw new Error(`Statement contains blocked keyword "${blocked[1]}"; only read-only queries are allowed.`);
  }
}

function assertQualifiedIdentifier(value: string) {
  const identifier = '[A-Za-z_][A-Za-z0-9_$]*';
  const pattern = new RegExp(`^${identifier}(\\.${identifier}){0,2}$`);
  if (!pattern.test(value.trim())) {
    throw new Error('Table names must be simple unquoted identifiers, optionally qualified as catalog.schema.table.');
  }
}

function stripSqlComments(sql: string) {
  let output = '';
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1];

    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false;
        output += char;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false;
        index += 1;
        output += ' ';
      }
      continue;
    }

    if (!inSingle && !inDouble && char === '-' && next === '-') {
      inLineComment = true;
      index += 1;
      output += ' ';
      continue;
    }

    if (!inSingle && !inDouble && char === '/' && next === '*') {
      inBlockComment = true;
      index += 1;
      output += ' ';
      continue;
    }

    if (!inDouble && char === "'") {
      output += char;
      if (inSingle && next === "'") {
        output += next;
        index += 1;
      } else {
        inSingle = !inSingle;
      }
      continue;
    }

    if (!inSingle && char === '"') inDouble = !inDouble;
    output += char;
  }

  return output;
}

function stripSqlStrings(sql: string) {
  let output = '';
  let inSingle = false;
  let inDouble = false;

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1];

    if (!inDouble && char === "'") {
      output += ' ';
      if (inSingle && next === "'") {
        output += ' ';
        index += 1;
      } else {
        inSingle = !inSingle;
      }
      continue;
    }

    if (!inSingle && char === '"') {
      output += ' ';
      inDouble = !inDouble;
      continue;
    }

    output += inSingle || inDouble ? ' ' : char;
  }

  return output;
}

function hasSemicolonOutsideString(sql: string) {
  let inSingle = false;
  let inDouble = false;

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1];

    if (!inDouble && char === "'") {
      if (inSingle && next === "'") {
        index += 1;
      } else {
        inSingle = !inSingle;
      }
      continue;
    }

    if (!inSingle && char === '"') {
      inDouble = !inDouble;
      continue;
    }

    if (!inSingle && !inDouble && char === ';') return true;
  }

  return false;
}

function inferChartSpec(
  chartType: ChartType,
  requested: Partial<Omit<ChartSpec, 'chartType'>>,
  columns: Array<{ name: string; type: string }>
): ChartSpec {
  const numeric = columns.find(column => isNumericType(column.type));
  const secondNumeric = columns.filter(column => isNumericType(column.type))[1];
  const dimension = columns.find(column => !isNumericType(column.type));
  const secondDimension = columns.filter(column => !isNumericType(column.type))[1];
  const thirdDimension = columns.filter(column => !isNumericType(column.type))[2];
  const valueField = requested.valueField || requested.yField || numeric?.name || columns[1]?.name || columns[0]?.name;
  const xField = requested.xField || dimension?.name || columns[0]?.name;
  const yField = requested.yField || numeric?.name || columns[1]?.name || columns[0]?.name;
  const partitionFields = requested.partitionFields?.length
    ? requested.partitionFields
    : [requested.xField || dimension?.name, requested.seriesField || secondDimension?.name, thirdDimension?.name].filter(Boolean) as string[];

  return {
    chartType,
    title: requested.title || 'Trino query preview',
    xField,
    yField,
    seriesField: requested.seriesField,
    valueField,
    rowField: requested.rowField || requested.yField || secondDimension?.name || dimension?.name || columns[0]?.name,
    columnField: requested.columnField || requested.xField || dimension?.name || columns[0]?.name,
    colorField: requested.colorField || requested.seriesField,
    sizeField: requested.sizeField || secondNumeric?.name,
    goalField: requested.goalField || secondNumeric?.name,
    sourceField: requested.sourceField || requested.xField || dimension?.name || columns[0]?.name,
    targetField: requested.targetField || requested.seriesField || secondDimension?.name || columns[1]?.name || columns[0]?.name,
    edgeWeightField: requested.edgeWeightField || requested.valueField || requested.yField || numeric?.name,
    nodeLabelField: requested.nodeLabelField,
    groupField: requested.groupField || requested.colorField,
    partitionFields
  };
}

function isNumericType(type: string) {
  return /^(tinyint|smallint|integer|bigint|real|double|decimal)/i.test(type);
}

function summarizePayload(payload: VisualizationPayload) {
  const fields = payload.columns.map(column => `${column.name} (${column.type})`).join(', ');
  const truncation = payload.truncated ? ' Result was truncated at the configured row limit.' : '';
  return `Rendered ${payload.spec.chartType} preview "${payload.spec.title}" from ${payload.rowCount} Trino row(s). Fields: ${fields}.${truncation}`;
}
