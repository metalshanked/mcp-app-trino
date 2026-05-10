import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App as McpApp, PostMessageTransport } from '@modelcontextprotocol/ext-apps';
import {
  AreaSeries,
  Axis,
  BarSeries,
  BubbleSeries,
  Chart,
  Heatmap,
  LineSeries,
  niceTimeFormatter,
  Partition,
  PartitionLayout,
  Position,
  Predicate,
  ScaleType,
  Settings,
  StackMode
} from '@elastic/charts';
import '@elastic/charts/dist/theme_only_light.css';
import './styles.css';

type Payload = {
  kind: 'mcp-app-trino';
  sql: string;
  catalog?: string;
  schema?: string;
  spec: {
    chartType:
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
      | 'metric'
      | 'goal'
      | 'table';
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
    partitionFields?: string[];
  };
  columns: Array<{ name: string; type: string }>;
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  truncated: boolean;
  generatedAt: string;
};

type ChartType = Payload['spec']['chartType'];
type PreviewDraft = {
  sql: string;
  chartType: ChartType;
  title: string;
  xField: string;
  yField: string;
  seriesField: string;
  valueField: string;
  rowField: string;
  columnField: string;
  colorField: string;
  sizeField: string;
  goalField: string;
  partitionFields: string;
  maxRows: string;
};

const CHART_TYPES: Array<{ value: ChartType; label: string }> = [
  { value: 'bar', label: 'Bar' },
  { value: 'stacked_bar', label: 'Stacked bar' },
  { value: 'normalized_stacked_bar', label: '100% stacked bar' },
  { value: 'line', label: 'Line' },
  { value: 'area', label: 'Area' },
  { value: 'stacked_area', label: 'Stacked area' },
  { value: 'scatter', label: 'Scatter' },
  { value: 'bubble', label: 'Bubble' },
  { value: 'heatmap', label: 'Heatmap' },
  { value: 'pie', label: 'Pie' },
  { value: 'donut', label: 'Donut' },
  { value: 'sunburst', label: 'Sunburst' },
  { value: 'treemap', label: 'Treemap' },
  { value: 'metric', label: 'Metric' },
  { value: 'goal', label: 'Goal' },
  { value: 'table', label: 'Table' }
];

function App() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [bridge, setBridge] = useState<McpApp | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [serverToolsAvailable, setServerToolsAvailable] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let active = true;
    const app = new McpApp({ name: 'mcp-app-trino-preview', version: '0.1.0' }, {});
    app.ontoolresult = result => {
      if (active) {
        setPayload(extractPayload(result));
      }
    };
    void app
      .connect(new PostMessageTransport(window.parent, window.parent))
      .then(() => {
        if (active) {
          setBridge(app);
          setServerToolsAvailable(true);
          setIsConnected(true);
        }
      })
      .catch(err => {
        if (active) setError(err instanceof Error ? err : new Error(String(err)));
      });
    return () => {
      active = false;
    };
  }, []);

  if (error) return <StateMessage title="Unable to connect to host" detail={error.message} />;
  if (!isConnected) return <StateMessage title="Connecting to host" />;
  if (!payload) return <StateMessage title="Waiting for query result" />;

  return <Preview payload={payload} bridge={bridge} serverToolsAvailable={serverToolsAvailable} onPayload={setPayload} />;
}

function Preview({
  payload,
  bridge,
  serverToolsAvailable,
  onPayload
}: {
  payload: Payload;
  bridge: McpApp | null;
  serverToolsAvailable: boolean;
  onPayload: (payload: Payload) => void;
}) {
  const spec = payload.spec;
  const [draft, setDraft] = useState(() => draftFromPayload(payload));
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [controlError, setControlError] = useState('');

  useEffect(() => {
    setDraft(draftFromPayload(payload));
    setControlError('');
  }, [payload]);

  async function refreshPreview(overrides: Partial<PreviewDraft> = {}) {
    const nextDraft = { ...draft, ...overrides };
    setDraft(nextDraft);

    if (!bridge || !serverToolsAvailable) {
      setControlError('This host does not expose server tool calls to MCP Apps.');
      return;
    }

    setIsRefreshing(true);
    setControlError('');
    try {
      const result = await bridge.callServerTool({
        name: 'visualize_query',
        arguments: toolArgsFromDraft(nextDraft)
      });
      if (result.isError) throw new Error(toolResultText(result) || 'The server returned an error.');
      const nextPayload = extractPayload(result);
      if (!nextPayload) throw new Error('The server returned a result without a Trino visualization payload.');
      onPayload(nextPayload);
    } catch (err) {
      setControlError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRefreshing(false);
    }
  }

  return (
    <main className="app">
      <header className="header">
        <div>
          <h1>{spec.title}</h1>
          <p>
            {payload.rowCount.toLocaleString()} rows
            {payload.truncated ? ' (truncated)' : ''} from Trino
            {payload.catalog ? ` / ${payload.catalog}${payload.schema ? `.${payload.schema}` : ''}` : ''}
          </p>
        </div>
        <span className="badge">{spec.chartType}</span>
      </header>

      <ControlPanel
        payload={payload}
        draft={draft}
        disabled={isRefreshing}
        serverToolsAvailable={serverToolsAvailable}
        error={controlError}
        onChange={updates => setDraft(current => ({ ...current, ...updates }))}
        onChartTypeChange={chartType => void refreshPreview({ chartType })}
        onRefresh={() => void refreshPreview()}
      />

      <section className="chartPanel">
        {isRefreshing ? <div className="refreshOverlay">Refreshing preview...</div> : null}
        {spec.chartType === 'metric' || spec.chartType === 'goal' ? <MetricPreview payload={payload} /> : null}
        {spec.chartType === 'table' ? <DataTable payload={payload} /> : null}
        {spec.chartType === 'heatmap' ? <HeatmapPreview payload={payload} /> : null}
        {isPartitionChart(spec.chartType) ? <PartitionPreview payload={payload} /> : null}
        {isXyChart(spec.chartType) ? <XyChartPreview payload={payload} /> : null}
      </section>

      <details className="queryDetails">
        <summary>SQL</summary>
        <pre>{payload.sql}</pre>
      </details>
    </main>
  );
}

function ControlPanel({
  payload,
  draft,
  disabled,
  serverToolsAvailable,
  error,
  onChange,
  onChartTypeChange,
  onRefresh
}: {
  payload: Payload;
  draft: PreviewDraft;
  disabled: boolean;
  serverToolsAvailable: boolean;
  error: string;
  onChange: (updates: Partial<PreviewDraft>) => void;
  onChartTypeChange: (chartType: ChartType) => void;
  onRefresh: () => void;
}) {
  const allFields = payload.columns.map(column => column.name);
  const numericFields = payload.columns.filter(column => isNumericType(column.type)).map(column => column.name);
  const selectDisabled = disabled || !serverToolsAvailable;
  return (
    <section className="controlPanel" aria-label="Visualization controls">
      <div className="controlGrid">
        <label>
          <span>Chart</span>
          <select value={draft.chartType} disabled={selectDisabled} onChange={event => onChartTypeChange(event.target.value as ChartType)}>
            {CHART_TYPES.map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Title</span>
          <input value={draft.title} disabled={disabled} onChange={event => onChange({ title: event.target.value })} />
        </label>
        <FieldSelect label="X field" value={draft.xField} fields={allFields} disabled={disabled} onChange={value => onChange({ xField: value })} />
        <FieldSelect label="Y field" value={draft.yField} fields={numericFields.length ? numericFields : allFields} disabled={disabled} onChange={value => onChange({ yField: value })} />
        <FieldSelect label="Series" value={draft.seriesField} fields={allFields} disabled={disabled} onChange={value => onChange({ seriesField: value })} />
        <FieldSelect label="Value" value={draft.valueField} fields={numericFields.length ? numericFields : allFields} disabled={disabled} onChange={value => onChange({ valueField: value })} />
        <FieldSelect label="Row" value={draft.rowField} fields={allFields} disabled={disabled} onChange={value => onChange({ rowField: value })} />
        <FieldSelect label="Column" value={draft.columnField} fields={allFields} disabled={disabled} onChange={value => onChange({ columnField: value })} />
        <FieldSelect label="Color" value={draft.colorField} fields={allFields} disabled={disabled} onChange={value => onChange({ colorField: value })} />
        <FieldSelect label="Size" value={draft.sizeField} fields={numericFields.length ? numericFields : allFields} disabled={disabled} onChange={value => onChange({ sizeField: value })} />
        <FieldSelect label="Goal" value={draft.goalField} fields={numericFields.length ? numericFields : allFields} disabled={disabled} onChange={value => onChange({ goalField: value })} />
        <label>
          <span>Max rows</span>
          <input type="number" min="1" max="5000" value={draft.maxRows} disabled={disabled} onChange={event => onChange({ maxRows: event.target.value })} />
        </label>
        <label className="wide">
          <span>Partition fields</span>
          <input value={draft.partitionFields} disabled={disabled} placeholder="category, subcategory" onChange={event => onChange({ partitionFields: event.target.value })} />
        </label>
      </div>

      <details className="sqlEditor">
        <summary>Edit query</summary>
        <textarea value={draft.sql} disabled={disabled} spellCheck={false} onChange={event => onChange({ sql: event.target.value })} />
      </details>

      <div className="controlActions">
        {!serverToolsAvailable ? <span>Host bridge is read-only; controls cannot fetch new results.</span> : null}
        {error ? <span className="controlError">{error}</span> : null}
        <button disabled={disabled || !serverToolsAvailable} onClick={onRefresh}>{disabled ? 'Refreshing...' : 'Apply'}</button>
      </div>
    </section>
  );
}

function FieldSelect({
  label,
  value,
  fields,
  disabled,
  onChange
}: {
  label: string;
  value: string;
  fields: string[];
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      <span>{label}</span>
      <select value={value} disabled={disabled} onChange={event => onChange(event.target.value)}>
        <option value="">Auto</option>
        {fields.map(field => (
          <option key={field} value={field}>{field}</option>
        ))}
      </select>
    </label>
  );
}

function XyChartPreview({ payload }: { payload: Payload }) {
  const { rows, spec } = payload;
  const xField = spec.xField || payload.columns[0]?.name;
  const yField = spec.yField || payload.columns[1]?.name || payload.columns[0]?.name;
  const sizeField = spec.sizeField;
  const data = useMemo(
    () =>
      rows.map(row => ({
        x: normalizeX(row[xField]),
        y: Number(row[yField] ?? 0),
        series: spec.seriesField || spec.colorField ? String(row[spec.seriesField || spec.colorField || ''] ?? 'Series') : spec.title,
        size: sizeField ? Number(row[sizeField] ?? 4) : 4
      })),
    [rows, spec.colorField, spec.seriesField, spec.title, sizeField, xField, yField]
  );
  const xScaleType = isMostlyTemporal(rows.map(row => row[xField])) ? ScaleType.Time : ScaleType.Ordinal;
  const tickDomain = xScaleType === ScaleType.Time ? numericDomain(data.map(datum => datum.x)) : undefined;
  const stackMode = spec.chartType === 'normalized_stacked_bar' ? StackMode.Percentage : undefined;
  const stackAccessors = isStackedChart(spec.chartType) ? ['series'] : undefined;
  const commonProps = {
    id: spec.title,
    name: spec.title,
    data,
    xAccessor: 'x',
    yAccessors: ['y'],
    splitSeriesAccessors: spec.seriesField || spec.colorField ? ['series'] : undefined,
    stackAccessors,
    stackMode,
    xScaleType,
    yScaleType: ScaleType.Linear
  };

  return (
    <div className="chartWrap">
      <Chart size={{ height: 420 }}>
        <Settings showLegend={Boolean(spec.seriesField || spec.colorField)} legendPosition={Position.Right} />
        <Axis id="bottom" position={Position.Bottom} title={xField} tickFormat={tickDomain ? niceTimeFormatter(tickDomain) : undefined} />
        <Axis id="left" position={Position.Left} title={yField} />
        {spec.chartType === 'bar' || spec.chartType === 'stacked_bar' || spec.chartType === 'normalized_stacked_bar' ? <BarSeries {...commonProps} /> : null}
        {spec.chartType === 'line' ? <LineSeries {...commonProps} /> : null}
        {spec.chartType === 'area' || spec.chartType === 'stacked_area' ? <AreaSeries {...commonProps} /> : null}
        {spec.chartType === 'scatter' || spec.chartType === 'bubble' ? <BubbleSeries {...commonProps} markSizeAccessor="size" /> : null}
      </Chart>
    </div>
  );
}

function HeatmapPreview({ payload }: { payload: Payload }) {
  const { rows, spec } = payload;
  const rowField = spec.rowField || spec.yField || payload.columns[1]?.name || payload.columns[0]?.name;
  const columnField = spec.columnField || spec.xField || payload.columns[0]?.name;
  const valueField = spec.valueField || spec.yField || payload.columns.find(column => isNumericType(column.type))?.name || payload.columns[2]?.name || payload.columns[0]?.name;
  const values = rows.map(row => Number(row[valueField] ?? 0)).filter(Number.isFinite);
  const max = Math.max(...values, 1);

  return (
    <div className="chartWrap">
      <Chart size={{ height: 460 }}>
        <Settings showLegend legendPosition={Position.Right} />
        <Heatmap
          id={spec.title}
          name={spec.title}
          data={rows}
          xAccessor={row => String(row[columnField] ?? '')}
          yAccessor={row => String(row[rowField] ?? '')}
          valueAccessor={row => Number(row[valueField] ?? 0)}
          valueFormatter={value => formatValue(value)}
          xAxisTitle={columnField}
          yAxisTitle={rowField}
          xScale={{ type: ScaleType.Ordinal }}
          xSortPredicate={Predicate.DataIndex}
          ySortPredicate={Predicate.DataIndex}
          colorScale={{
            type: 'bands',
            bands: [
              { start: 0, end: max * 0.25, color: '#d8edf3' },
              { start: max * 0.25, end: max * 0.5, color: '#8fc9d6' },
              { start: max * 0.5, end: max * 0.75, color: '#3993a6' },
              { start: max * 0.75, end: max, color: '#0f5f73' }
            ]
          }}
        />
      </Chart>
    </div>
  );
}

function PartitionPreview({ payload }: { payload: Payload }) {
  const { rows, spec } = payload;
  const valueField = spec.valueField || spec.yField || payload.columns.find(column => isNumericType(column.type))?.name || payload.columns.at(-1)?.name || payload.columns[0]?.name;
  const fields = (spec.partitionFields?.length ? spec.partitionFields : [spec.xField, spec.seriesField]).filter(Boolean) as string[];
  const partitionFields = fields.length ? fields : [payload.columns[0]?.name].filter(Boolean);
  const layout = spec.chartType === 'treemap' ? PartitionLayout.treemap : PartitionLayout.sunburst;

  return (
    <div className="chartWrap">
      <Chart size={{ height: 460 }}>
        <Settings showLegend legendPosition={Position.Right} />
        <Partition
          id={spec.title}
          data={rows}
          layout={layout}
          valueAccessor={row => Number(row[valueField] ?? 0)}
          valueFormatter={value => formatValue(value)}
          layers={partitionFields.map(field => ({
            groupByRollup: (row: Record<string, unknown>) => String(row[field] ?? 'Unknown'),
            nodeLabel: (value: unknown) => String(value)
          }))}
        />
      </Chart>
    </div>
  );
}

function MetricPreview({ payload }: { payload: Payload }) {
  const yField = payload.spec.valueField || payload.spec.yField || payload.columns.find(column => isNumericType(column.type))?.name || payload.columns[0]?.name;
  const goalField = payload.spec.goalField;
  const value = payload.rows[0]?.[yField];
  const goal = goalField ? payload.rows[0]?.[goalField] : undefined;
  const ratio = Number(goal) ? Math.max(0, Math.min(1, Number(value) / Number(goal))) : undefined;
  return (
    <div className="metric">
      <span>{yField}</span>
      <strong>{formatValue(value)}</strong>
      {goalField ? (
        <div className="goalMeter" aria-label={`Goal ${goalField}`}>
          <div style={{ width: `${Math.round((ratio || 0) * 100)}%` }} />
          <small>{formatValue(value)} / {formatValue(goal)}</small>
        </div>
      ) : null}
    </div>
  );
}

function DataTable({ payload }: { payload: Payload }) {
  const columns = payload.columns.slice(0, 12);
  return (
    <div className="tableWrap">
      <table>
        <thead>
          <tr>
            {columns.map(column => (
              <th key={column.name}>{column.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {payload.rows.slice(0, 200).map((row, index) => (
            <tr key={index}>
              {columns.map(column => (
                <td key={column.name}>{formatValue(row[column.name])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StateMessage({ title, detail }: { title: string; detail?: string }) {
  return (
    <main className="state">
      <h1>{title}</h1>
      {detail ? <p>{detail}</p> : null}
    </main>
  );
}

function extractPayload(result: unknown): Payload | null {
  const candidate = result as { structuredContent?: unknown };
  if (isPayload(candidate?.structuredContent)) return candidate.structuredContent;
  if (isPayload(result)) return result;
  return null;
}

function draftFromPayload(payload: Payload): PreviewDraft {
  return {
    sql: payload.sql,
    chartType: payload.spec.chartType,
    title: payload.spec.title,
    xField: payload.spec.xField || '',
    yField: payload.spec.yField || '',
    seriesField: payload.spec.seriesField || '',
    valueField: payload.spec.valueField || '',
    rowField: payload.spec.rowField || '',
    columnField: payload.spec.columnField || '',
    colorField: payload.spec.colorField || '',
    sizeField: payload.spec.sizeField || '',
    goalField: payload.spec.goalField || '',
    partitionFields: (payload.spec.partitionFields || []).join(', '),
    maxRows: String(Math.max(payload.rowCount || 1, 1))
  };
}

function toolArgsFromDraft(draft: PreviewDraft) {
  return pruneEmpty({
    sql: draft.sql,
    chartType: draft.chartType,
    title: draft.title,
    xField: draft.xField,
    yField: draft.yField,
    seriesField: draft.seriesField,
    valueField: draft.valueField,
    rowField: draft.rowField,
    columnField: draft.columnField,
    colorField: draft.colorField,
    sizeField: draft.sizeField,
    goalField: draft.goalField,
    partitionFields: draft.partitionFields
      .split(',')
      .map(field => field.trim())
      .filter(Boolean),
    maxRows: clampInteger(Number(draft.maxRows), 1, 5000, 1000)
  });
}

function pruneEmpty(values: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => {
      if (value === '' || value === undefined || value === null) return false;
      if (Array.isArray(value) && !value.length) return false;
      return true;
    })
  );
}

function clampInteger(value: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function toolResultText(result: unknown) {
  const content = (result as { content?: Array<{ type?: string; text?: string }> }).content || [];
  return content
    .filter(item => item.type === 'text' && item.text)
    .map(item => item.text)
    .join('\n');
}

function isPayload(value: unknown): value is Payload {
  return Boolean(value && typeof value === 'object' && (value as { kind?: unknown }).kind === 'mcp-app-trino');
}

function isXyChart(chartType: Payload['spec']['chartType']) {
  return ['bar', 'stacked_bar', 'normalized_stacked_bar', 'line', 'area', 'stacked_area', 'scatter', 'bubble'].includes(chartType);
}

function isPartitionChart(chartType: Payload['spec']['chartType']) {
  return ['pie', 'donut', 'sunburst', 'treemap'].includes(chartType);
}

function isStackedChart(chartType: Payload['spec']['chartType']) {
  return ['stacked_bar', 'normalized_stacked_bar', 'stacked_area'].includes(chartType);
}

function normalizeX(value: unknown) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) && /\d{4}-\d{2}-\d{2}/.test(value) ? parsed : value;
  }
  return value as string | number;
}

function isMostlyTemporal(values: unknown[]) {
  const sample = values.slice(0, 20).filter(value => value !== null && value !== undefined);
  return sample.length > 0 && sample.filter(value => typeof value === 'string' && Number.isFinite(Date.parse(value))).length / sample.length > 0.7;
}

function numericDomain(values: Array<string | number>): [number, number] | undefined {
  const numeric = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (!numeric.length) return undefined;
  return [numeric[0], numeric[numeric.length - 1]];
}

function isNumericType(type: string) {
  return /^(tinyint|smallint|integer|bigint|real|double|decimal)/i.test(type);
}

function formatValue(value: unknown) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

createRoot(document.getElementById('root')!).render(<App />);
