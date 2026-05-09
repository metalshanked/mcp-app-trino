import type { QueryResult, TrinoColumn, TrinoRow } from './types.js';

type TrinoClientOptions = {
  host: string;
  port?: string;
  scheme: 'http' | 'https';
  user: string;
  password?: string;
  accessToken?: string;
  authType: 'none' | 'basic' | 'bearer';
  catalog?: string;
  schema?: string;
  source: string;
};

type TrinoStatementResponse = {
  id?: string;
  infoUri?: string;
  nextUri?: string;
  columns?: Array<{ name: string; type: string }>;
  data?: unknown[][];
  stats?: Record<string, unknown>;
  warnings?: unknown[];
  error?: {
    message?: string;
    errorName?: string;
    errorCode?: number;
    errorLocation?: { lineNumber?: number; columnNumber?: number };
  };
};

const DEFAULT_MAX_ROWS = 1000;

export class TrinoClient {
  private readonly baseUrl: string;

  constructor(private readonly options: TrinoClientOptions) {
    const host = options.host.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const port = options.port ? `:${options.port}` : '';
    this.baseUrl = `${options.scheme}://${host}${port}`;
  }

  async execute(sql: string, maxRows = DEFAULT_MAX_ROWS): Promise<QueryResult> {
    const response = await fetch(`${this.baseUrl}/v1/statement`, {
      method: 'POST',
      headers: this.headers(),
      body: sql
    });
    const first = await this.readResponse(response);
    return this.collect(first, maxRows);
  }

  async listCatalogs() {
    return this.singleColumn('SHOW CATALOGS');
  }

  async listSchemas(catalog?: string) {
    const suffix = catalog ? ` FROM ${quoteIdent(catalog)}` : '';
    return this.singleColumn(`SHOW SCHEMAS${suffix}`);
  }

  async listTables(catalog?: string, schema?: string) {
    const target = [catalog, schema].filter(Boolean).map(value => quoteIdent(String(value))).join('.');
    const suffix = target ? ` FROM ${target}` : '';
    return this.singleColumn(`SHOW TABLES${suffix}`);
  }

  async describeTable(table: string) {
    return this.execute(`DESCRIBE ${table}`, 500);
  }

  async explain(sql: string) {
    return this.execute(`EXPLAIN ${sql}`, 1000);
  }

  private async singleColumn(sql: string) {
    const result = await this.execute(sql, 1000);
    const firstColumn = result.columns[0]?.name;
    return firstColumn ? result.rows.map(row => String(row[firstColumn])) : [];
  }

  private async collect(first: TrinoStatementResponse, maxRows: number): Promise<QueryResult> {
    const columns = normalizeColumns(first.columns);
    const rows: TrinoRow[] = [];
    let current = first;
    let stats = first.stats;
    let warnings = first.warnings;

    while (true) {
      if (current.error) throw new Error(formatTrinoError(current.error));
      if (current.columns?.length && !columns.length) columns.push(...normalizeColumns(current.columns));
      if (current.data?.length) {
        rows.push(...rowsFromData(columns, current.data, Math.max(0, maxRows - rows.length)));
      }
      stats = current.stats || stats;
      warnings = current.warnings || warnings;

      if (!current.nextUri || rows.length >= maxRows) break;
      const nextResponse = await fetch(current.nextUri, { headers: this.headers(false) });
      current = await this.readResponse(nextResponse);
    }

    return {
      columns,
      rows,
      rowCount: rows.length,
      truncated: Boolean(current.nextUri),
      stats,
      warnings
    };
  }

  private async readResponse(response: Response): Promise<TrinoStatementResponse> {
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Trino request failed (${response.status}): ${text}`);
    }
    const body = JSON.parse(text) as TrinoStatementResponse;
    if (body.error) throw new Error(formatTrinoError(body.error));
    return body;
  }

  private headers(includeSession = true) {
    const headers: Record<string, string> = {
      'content-type': 'text/plain; charset=utf-8',
      'x-trino-user': this.options.user,
      'x-trino-source': this.options.source
    };
    if (includeSession && this.options.catalog) headers['x-trino-catalog'] = this.options.catalog;
    if (includeSession && this.options.schema) headers['x-trino-schema'] = this.options.schema;
    if (this.options.authType === 'basic' && this.options.password) {
      headers.authorization = `Basic ${Buffer.from(`${this.options.user}:${this.options.password}`).toString('base64')}`;
    }
    if (this.options.authType === 'bearer' && this.options.accessToken) {
      headers.authorization = `Bearer ${this.options.accessToken}`;
    }
    return headers;
  }
}

export function createTrinoClientFromEnv() {
  const host = process.env.TRINO_HOST || process.env.STARBURST_HOST || '';
  if (!host) throw new Error('Set TRINO_HOST or STARBURST_HOST before using Trino visualization tools.');
  const scheme = normalizeScheme(process.env.TRINO_SCHEME || process.env.TRINO_SSL || process.env.STARBURST_SCHEME);
  const user = process.env.TRINO_USER || process.env.STARBURST_USER || 'trino';
  const password = process.env.TRINO_PASSWORD || process.env.STARBURST_PASSWORD;
  const accessToken = process.env.TRINO_ACCESS_TOKEN || process.env.STARBURST_ACCESS_TOKEN;
  const authType = normalizeAuthType(process.env.TRINO_AUTH_TYPE, password, accessToken);
  return new TrinoClient({
    host,
    port: process.env.TRINO_PORT || process.env.STARBURST_PORT,
    scheme,
    user,
    password,
    accessToken,
    authType,
    catalog: process.env.TRINO_CATALOG || process.env.STARBURST_CATALOG,
    schema: process.env.TRINO_SCHEMA || process.env.STARBURST_SCHEMA,
    source: process.env.TRINO_SOURCE || 'mcp-app-trino'
  });
}

function normalizeScheme(value?: string): 'http' | 'https' {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'true' || normalized === 'https') return 'https';
  return normalized === 'http' ? 'http' : 'http';
}

function normalizeAuthType(value: string | undefined, password?: string, accessToken?: string): 'none' | 'basic' | 'bearer' {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'bearer') return 'bearer';
  if (normalized === 'basic') return 'basic';
  if (accessToken) return 'bearer';
  if (password) return 'basic';
  return 'none';
}

function normalizeColumns(columns?: Array<{ name: string; type: string }>): TrinoColumn[] {
  return (columns || []).map(column => ({ name: column.name, type: column.type }));
}

function rowsFromData(columns: TrinoColumn[], data: unknown[][], remaining: number) {
  return data.slice(0, remaining).map(values => Object.fromEntries(columns.map((column, index) => [column.name, values[index]])));
}

function formatTrinoError(error: NonNullable<TrinoStatementResponse['error']>) {
  const location = error.errorLocation?.lineNumber
    ? ` at line ${error.errorLocation.lineNumber}, column ${error.errorLocation.columnNumber || 1}`
    : '';
  return `${error.errorName || 'Trino error'}${error.errorCode ? ` (${error.errorCode})` : ''}${location}: ${error.message || 'Unknown error'}`;
}

function quoteIdent(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}
