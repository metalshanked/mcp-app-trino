export type TrinoColumn = {
  name: string;
  type: string;
};

export type TrinoRow = Record<string, unknown>;

export type QueryResult = {
  columns: TrinoColumn[];
  rows: TrinoRow[];
  rowCount: number;
  truncated: boolean;
  stats?: Record<string, unknown>;
  warnings?: unknown[];
};

export type ChartType =
  | 'bar'
  | 'stacked_bar'
  | 'normalized_stacked_bar'
  | 'line'
  | 'area'
  | 'stacked_area'
  | 'scatter'
  | 'bubble'
  | 'heatmap'
  | 'pie'
  | 'donut'
  | 'sunburst'
  | 'treemap'
  | 'graph'
  | 'metric'
  | 'goal'
  | 'table';

export type ChartSpec = {
  chartType: ChartType;
  title: string;
  xField?: string;
  yField?: string;
  seriesField?: string;
  valueField?: string;
  rowField?: string;
  columnField?: string;
  colorField?: string;
  sizeField?: string;
  goalField?: string;
  sourceField?: string;
  targetField?: string;
  edgeWeightField?: string;
  nodeLabelField?: string;
  groupField?: string;
  partitionFields?: string[];
};

export type VisualizationPayload = {
  kind: 'mcp-app-trino';
  sql: string;
  catalog?: string;
  schema?: string;
  spec: ChartSpec;
  columns: TrinoColumn[];
  rows: TrinoRow[];
  rowCount: number;
  truncated: boolean;
  generatedAt: string;
};
