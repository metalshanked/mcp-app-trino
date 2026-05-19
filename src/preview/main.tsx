import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App as McpApp, PostMessageTransport } from '@modelcontextprotocol/ext-apps';
import { drag } from 'd3-drag';
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum
} from 'd3-force';
import { select } from 'd3-selection';
import { zoom, zoomIdentity, type ZoomBehavior } from 'd3-zoom';
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
  spec: ChartSpec;
  columns: Array<{ name: string; type: string }>;
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  truncated: boolean;
  generatedAt: string;
  dashboard?: {
    title: string;
    panels: DashboardPanel[];
  };
};

type ChartType =
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
type ChartSpec = {
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
type DashboardPanel = {
  id: string;
  sql: string;
  spec: ChartSpec;
  columns: Array<{ name: string; type: string }>;
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  truncated: boolean;
  width?: 'full' | 'half' | 'third';
  height?: number;
};
type ChartPayload = {
  sql?: string;
  spec: ChartSpec;
  columns: Array<{ name: string; type: string }>;
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  truncated: boolean;
  height?: number;
};
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
  sourceField: string;
  targetField: string;
  edgeWeightField: string;
  nodeLabelField: string;
  groupField: string;
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
  { value: 'graph', label: 'Graph' },
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
  const dashboard = payload.dashboard;
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
          <h1>{dashboard?.title || spec.title}</h1>
          <p>
            {payload.rowCount.toLocaleString()} rows
            {payload.truncated ? ' (truncated)' : ''} from Trino
            {payload.catalog ? ` / ${payload.catalog}${payload.schema ? `.${payload.schema}` : ''}` : ''}
          </p>
        </div>
        <span className="badge">{dashboard ? `${dashboard.panels.length} panels` : spec.chartType}</span>
      </header>

      {!dashboard ? (
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
      ) : null}

      <section className="chartPanel">
        {isRefreshing ? <div className="refreshOverlay">Refreshing preview...</div> : null}
        {dashboard ? <DashboardPreview payload={payload} /> : <VisualizationBody payload={payload} />}
      </section>

      <details className="queryDetails">
        <summary>SQL</summary>
        {dashboard ? (
          dashboard.panels.map(panel => (
            <div className="panelSql" key={panel.id}>
              <strong>{panel.spec.title}</strong>
              <pre>{panel.sql}</pre>
            </div>
          ))
        ) : (
          <pre>{payload.sql}</pre>
        )}
      </details>
    </main>
  );
}

function DashboardPreview({ payload }: { payload: Payload }) {
  const panels = payload.dashboard?.panels || [];
  return (
    <div className="dashboardGrid">
      {panels.map(panel => (
        <article className={`dashboardPanel span-${panel.width || 'half'}`} key={panel.id}>
          <header className="panelHeader">
            <div>
              <h2>{panel.spec.title}</h2>
              <p>
                {panel.rowCount.toLocaleString()} rows
                {panel.truncated ? ' (truncated)' : ''}
              </p>
            </div>
            <span className="badge">{panel.spec.chartType}</span>
          </header>
          <VisualizationBody payload={panelToChartPayload(panel)} />
        </article>
      ))}
    </div>
  );
}

function VisualizationBody({ payload }: { payload: ChartPayload }) {
  const chartType = payload.spec.chartType;
  return (
    <>
      {chartType === 'metric' || chartType === 'goal' ? <MetricPreview payload={payload} /> : null}
      {chartType === 'table' ? <DataTable payload={payload} /> : null}
      {chartType === 'heatmap' ? <HeatmapPreview payload={payload} /> : null}
      {chartType === 'graph' ? <GraphPreview payload={payload} /> : null}
      {isPartitionChart(chartType) ? <PartitionPreview payload={payload} /> : null}
      {isXyChart(chartType) ? <XyChartPreview payload={payload} /> : null}
    </>
  );
}

function panelToChartPayload(panel: DashboardPanel): ChartPayload {
  return {
    sql: panel.sql,
    spec: panel.spec,
    columns: panel.columns,
    rows: panel.rows,
    rowCount: panel.rowCount,
    truncated: panel.truncated,
    height: panel.height
  };
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
        <FieldSelect label="Source" value={draft.sourceField} fields={allFields} disabled={disabled} onChange={value => onChange({ sourceField: value })} />
        <FieldSelect label="Target" value={draft.targetField} fields={allFields} disabled={disabled} onChange={value => onChange({ targetField: value })} />
        <FieldSelect label="Edge weight" value={draft.edgeWeightField} fields={numericFields.length ? numericFields : allFields} disabled={disabled} onChange={value => onChange({ edgeWeightField: value })} />
        <FieldSelect label="Node label" value={draft.nodeLabelField} fields={allFields} disabled={disabled} onChange={value => onChange({ nodeLabelField: value })} />
        <FieldSelect label="Group" value={draft.groupField} fields={allFields} disabled={disabled} onChange={value => onChange({ groupField: value })} />
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

function XyChartPreview({ payload }: { payload: ChartPayload }) {
  const { rows, spec } = payload;
  const height = payload.height || 420;
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
      <Chart size={{ height }}>
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

function HeatmapPreview({ payload }: { payload: ChartPayload }) {
  const { rows, spec } = payload;
  const height = payload.height || 460;
  const rowField = spec.rowField || spec.yField || payload.columns[1]?.name || payload.columns[0]?.name;
  const columnField = spec.columnField || spec.xField || payload.columns[0]?.name;
  const valueField = spec.valueField || spec.yField || payload.columns.find(column => isNumericType(column.type))?.name || payload.columns[2]?.name || payload.columns[0]?.name;
  const values = rows.map(row => Number(row[valueField] ?? 0)).filter(Number.isFinite);
  const max = Math.max(...values, 1);

  return (
    <div className="chartWrap">
      <Chart size={{ height }}>
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

function PartitionPreview({ payload }: { payload: ChartPayload }) {
  const { rows, spec } = payload;
  const height = payload.height || 460;
  const valueField = spec.valueField || spec.yField || payload.columns.find(column => isNumericType(column.type))?.name || payload.columns.at(-1)?.name || payload.columns[0]?.name;
  const fields = (spec.partitionFields?.length ? spec.partitionFields : [spec.xField, spec.seriesField]).filter(Boolean) as string[];
  const partitionFields = fields.length ? fields : [payload.columns[0]?.name].filter(Boolean);
  const layout = spec.chartType === 'treemap' ? PartitionLayout.treemap : PartitionLayout.sunburst;

  return (
    <div className="chartWrap">
      <Chart size={{ height }}>
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

type GraphNode = SimulationNodeDatum & {
  id: string;
  label: string;
  group: string;
  degree: number;
};

type GraphLink = SimulationLinkDatum<GraphNode> & {
  source: string | GraphNode;
  target: string | GraphNode;
  weight: number;
};

type GraphLayout = ReturnType<typeof buildGraphLayout>;

function GraphPreview({ payload }: { payload: ChartPayload }) {
  const graph = useMemo(() => buildGraphLayout(payload), [payload]);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState('');
  const [search, setSearch] = useState('');
  const [showLabels, setShowLabels] = useState(true);
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(() => new Set());
  const selectedNode = graph.nodes.find(node => node.id === selectedNodeId);
  const visibleGroups = [...graph.colorByGroup.entries()].slice(0, 8);

  useEffect(() => {
    setSelectedNodeId('');
    setPinnedIds(new Set());
  }, [payload]);

  useEffect(() => {
    if (!svgRef.current || !graph.nodes.length || !graph.links.length) return;
    const cleanup = renderInteractiveGraph(svgRef.current, graph, {
      selectedNodeId,
      search,
      showLabels,
      pinnedIds,
      onSelectedNode: setSelectedNodeId,
      onPinnedIds: setPinnedIds,
      onZoomReady: behavior => {
        zoomRef.current = behavior;
      }
    });
    return cleanup;
  }, [graph, pinnedIds, search, selectedNodeId, showLabels]);

  function resetView() {
    if (!svgRef.current || !zoomRef.current) return;
    select(svgRef.current).call(zoomRef.current.transform, zoomIdentity);
  }

  function clearPins() {
    setPinnedIds(new Set());
  }

  if (!graph.nodes.length || !graph.links.length) {
    return <StateMessage title="No graph edges" detail="Use a query with source and target columns to render a graph." />;
  }

  return (
    <div className="graphWrap">
      <div className="graphToolbar">
        <label className="graphSearch">
          <span>Find node</span>
          <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search labels" />
        </label>
        <button type="button" onClick={resetView}>Reset view</button>
        <button type="button" onClick={() => setShowLabels(value => !value)}>{showLabels ? 'Hide labels' : 'Show labels'}</button>
        <button type="button" onClick={clearPins} disabled={!pinnedIds.size}>Clear pins</button>
      </div>
      <div className="graphCanvas">
        <svg ref={svgRef} viewBox="0 0 960 520" role="img" aria-label={payload.spec.title} />
      </div>
      <div className="graphLegend">
        <span>{graph.nodes.length.toLocaleString()} nodes</span>
        <span>{graph.links.length.toLocaleString()} edges</span>
        <span>{pinnedIds.size.toLocaleString()} pinned</span>
        {payload.spec.edgeWeightField ? <span>weighted by {payload.spec.edgeWeightField}</span> : null}
      </div>
      {visibleGroups.length ? (
        <div className="graphGroups" aria-label="Graph groups">
          {visibleGroups.map(([group, color]) => (
            <button type="button" key={group} onClick={() => setSearch(group === 'default' ? '' : group)} title={`Filter by ${group}`}>
              <i style={{ background: color }} />
              <span>{group}</span>
            </button>
          ))}
        </div>
      ) : null}
      {selectedNode ? (
        <aside className="graphInspector">
          <strong>{selectedNode.label}</strong>
          <span>{selectedNode.group !== 'default' ? selectedNode.group : 'node'}</span>
          <span>{selectedNode.degree.toLocaleString()} connection{selectedNode.degree === 1 ? '' : 's'}</span>
          <button type="button" onClick={() => setSelectedNodeId('')}>Clear selection</button>
        </aside>
      ) : null}
    </div>
  );
}

function MetricPreview({ payload }: { payload: ChartPayload }) {
  const yField = payload.spec.valueField || payload.spec.yField || payload.columns.find(column => isNumericType(column.type))?.name || payload.columns[0]?.name;
  const goalField = payload.spec.goalField;
  const value = payload.rows[0]?.[yField];
  const goal = goalField ? payload.rows[0]?.[goalField] : undefined;
  const ratio = Number(goal) ? Math.max(0, Math.min(1, Number(value) / Number(goal))) : undefined;
  return (
    <div className="metric" style={{ minHeight: payload.height || undefined }}>
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

function DataTable({ payload }: { payload: ChartPayload }) {
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
    sourceField: payload.spec.sourceField || '',
    targetField: payload.spec.targetField || '',
    edgeWeightField: payload.spec.edgeWeightField || '',
    nodeLabelField: payload.spec.nodeLabelField || '',
    groupField: payload.spec.groupField || '',
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
    sourceField: draft.sourceField,
    targetField: draft.targetField,
    edgeWeightField: draft.edgeWeightField,
    nodeLabelField: draft.nodeLabelField,
    groupField: draft.groupField,
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

function isXyChart(chartType: ChartType) {
  return ['bar', 'stacked_bar', 'normalized_stacked_bar', 'line', 'area', 'stacked_area', 'scatter', 'bubble'].includes(chartType);
}

function isPartitionChart(chartType: ChartType) {
  return ['pie', 'donut', 'sunburst', 'treemap'].includes(chartType);
}

function isStackedChart(chartType: ChartType) {
  return ['stacked_bar', 'normalized_stacked_bar', 'stacked_area'].includes(chartType);
}

function buildGraphLayout(payload: ChartPayload) {
  const { rows, spec, columns } = payload;
  const dimensionFields = columns.filter(column => !isNumericType(column.type)).map(column => column.name);
  const numericField = columns.find(column => isNumericType(column.type))?.name;
  const sourceField = spec.sourceField || spec.xField || dimensionFields[0] || columns[0]?.name;
  const targetField = spec.targetField || spec.seriesField || dimensionFields.find(field => field !== sourceField) || columns[1]?.name || sourceField;
  const weightField = spec.edgeWeightField || spec.valueField || spec.yField || numericField;
  const groupField = spec.groupField || spec.colorField;
  const labelField = spec.nodeLabelField;
  const nodeMap = new Map<string, GraphNode>();
  const links: GraphLink[] = [];

  for (const row of rows.slice(0, 600)) {
    const sourceId = String(row[sourceField] ?? '').trim();
    const targetId = String(row[targetField] ?? '').trim();
    if (!sourceId || !targetId) continue;
    const source = getGraphNode(nodeMap, sourceId, labelField ? row[labelField] : undefined, groupField ? row[groupField] : undefined);
    const target = getGraphNode(nodeMap, targetId, undefined, groupField ? row[groupField] : undefined);
    const weight = weightField ? Number(row[weightField] ?? 1) : 1;
    source.degree += 1;
    target.degree += 1;
    links.push({ source: source.id, target: target.id, weight: Number.isFinite(weight) && weight > 0 ? weight : 1 });
  }

  const nodes = [...nodeMap.values()].slice(0, 320);
  const nodeIds = new Set(nodes.map(node => node.id));
  const visibleLinks = links.filter(link => nodeIds.has(String(link.source)) && nodeIds.has(String(link.target))).slice(0, 900);
  const simulation = forceSimulation<GraphNode>(nodes)
    .force('link', forceLink<GraphNode, GraphLink>(visibleLinks).id(node => node.id).distance(link => Math.max(42, 130 - Math.min(80, link.weight * 4))))
    .force('charge', forceManyBody().strength(-210))
    .force('collide', forceCollide<GraphNode>().radius(node => Math.max(16, Math.min(34, 13 + Math.sqrt(node.degree) * 5))))
    .force('center', forceCenter(480, 250))
    .stop();

  for (let index = 0; index < 180; index += 1) simulation.tick();

  for (const node of nodes) {
    node.x = Math.max(28, Math.min(932, node.x || 480));
    node.y = Math.max(28, Math.min(492, node.y || 250));
  }

  const groups = [...new Set(nodes.map(node => node.group))];
  const colorByGroup = new Map(groups.map((group, index) => [group, graphPalette[index % graphPalette.length]]));
  return { nodes, links: visibleLinks, colorByGroup };
}

function renderInteractiveGraph(
  svgElement: SVGSVGElement,
  graph: GraphLayout,
  options: {
    selectedNodeId: string;
    search: string;
    showLabels: boolean;
    pinnedIds: Set<string>;
    onSelectedNode: (id: string) => void;
    onPinnedIds: (ids: Set<string>) => void;
    onZoomReady: (behavior: ZoomBehavior<SVGSVGElement, unknown>) => void;
  }
) {
  const svg = select(svgElement);
  svg.selectAll('*').remove();

  const defs = svg.append('defs');
  defs
    .append('marker')
    .attr('id', 'arrow')
    .attr('viewBox', '0 0 10 10')
    .attr('refX', 14)
    .attr('refY', 5)
    .attr('markerWidth', 6)
    .attr('markerHeight', 6)
    .attr('orient', 'auto-start-reverse')
    .append('path')
    .attr('d', 'M 0 0 L 10 5 L 0 10 z');

  const viewport = svg.append('g').attr('class', 'graphViewport');
  const searchTerm = options.search.trim().toLowerCase();
  const selectedNeighbors = neighborSet(graph, options.selectedNodeId);
  const matchesSearch = (node: GraphNode) => !searchTerm || node.label.toLowerCase().includes(searchTerm) || node.id.toLowerCase().includes(searchTerm) || node.group.toLowerCase().includes(searchTerm);
  const isFocusNode = (node: GraphNode) =>
    (!options.selectedNodeId && matchesSearch(node)) ||
    node.id === options.selectedNodeId ||
    selectedNeighbors.has(node.id);

  for (const node of graph.nodes) {
    if (options.pinnedIds.has(node.id)) {
      node.fx = node.x;
      node.fy = node.y;
    } else {
      node.fx = undefined;
      node.fy = undefined;
    }
  }

  const linkSelection = viewport
    .append('g')
    .attr('class', 'graphLinks')
    .selectAll<SVGLineElement, GraphLink>('line')
    .data(graph.links)
    .join('line')
    .attr('stroke-width', link => Math.max(1, Math.min(8, Math.sqrt(link.weight))))
    .classed('dimmed', link => {
      const source = asGraphNode(link.source);
      const target = asGraphNode(link.target);
      return Boolean(options.selectedNodeId && source.id !== options.selectedNodeId && target.id !== options.selectedNodeId);
    });

  linkSelection.append('title').text(link => {
    const source = asGraphNode(link.source);
    const target = asGraphNode(link.target);
    return `${source.label} -> ${target.label}: ${formatValue(link.weight)}`;
  });

  const nodeSelection = viewport
    .append('g')
    .attr('class', 'graphNodes')
    .selectAll<SVGGElement, GraphNode>('g')
    .data(graph.nodes)
    .join('g')
    .attr('tabindex', 0)
    .attr('role', 'button')
    .classed('selected', node => node.id === options.selectedNodeId)
    .classed('pinned', node => options.pinnedIds.has(node.id))
    .classed('dimmed', node => !isFocusNode(node))
    .on('click', (event, node) => {
      event.stopPropagation();
      options.onSelectedNode(node.id === options.selectedNodeId ? '' : node.id);
    })
    .on('dblclick', (event, node) => {
      event.stopPropagation();
      const next = new Set(options.pinnedIds);
      if (next.has(node.id)) {
        next.delete(node.id);
        node.fx = undefined;
        node.fy = undefined;
      } else {
        next.add(node.id);
        node.fx = node.x;
        node.fy = node.y;
      }
      options.onPinnedIds(next);
    })
    .on('keydown', (event, node) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        options.onSelectedNode(node.id === options.selectedNodeId ? '' : node.id);
      }
    });

  nodeSelection
    .append('circle')
    .attr('r', node => Math.max(8, Math.min(26, 7 + Math.sqrt(node.degree) * 4)))
    .attr('fill', node => graph.colorByGroup.get(node.group) || '#2f7f9f');

  nodeSelection
    .append('text')
    .attr('y', -14)
    .classed('hidden', !options.showLabels)
    .text(node => truncateLabel(node.label, 24));

  nodeSelection.append('title').text(node => `${node.label}${node.group !== 'default' ? ` (${node.group})` : ''}`);

  const simulation = forceSimulation<GraphNode>(graph.nodes)
    .force('link', forceLink<GraphNode, GraphLink>(graph.links).id(node => node.id).distance(link => Math.max(42, 130 - Math.min(80, link.weight * 4))))
    .force('charge', forceManyBody().strength(-230))
    .force('collide', forceCollide<GraphNode>().radius(node => Math.max(16, Math.min(34, 13 + Math.sqrt(node.degree) * 5))))
    .force('center', forceCenter(480, 250))
    .alpha(0.35);

  const dragBehavior = drag<SVGGElement, GraphNode>()
    .on('start', (event, node) => {
      event.sourceEvent.stopPropagation();
      if (!event.active) simulation.alphaTarget(0.22).restart();
      node.fx = node.x;
      node.fy = node.y;
    })
    .on('drag', (event, node) => {
      node.fx = Math.max(20, Math.min(940, event.x));
      node.fy = Math.max(20, Math.min(500, event.y));
    })
    .on('end', (event, node) => {
      if (!event.active) simulation.alphaTarget(0);
      const next = new Set(options.pinnedIds);
      next.add(node.id);
      options.onPinnedIds(next);
    });
  nodeSelection.call(dragBehavior);

  const zoomBehavior = zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.25, 5])
    .on('zoom', event => {
      viewport.attr('transform', event.transform.toString());
    });
  svg.call(zoomBehavior).on('dblclick.zoom', null).on('click', () => options.onSelectedNode(''));
  options.onZoomReady(zoomBehavior);

  simulation.on('tick', () => {
    for (const node of graph.nodes) {
      node.x = Math.max(18, Math.min(942, node.x || 480));
      node.y = Math.max(18, Math.min(502, node.y || 250));
    }
    linkSelection
      .attr('x1', link => asGraphNode(link.source).x || 0)
      .attr('y1', link => asGraphNode(link.source).y || 0)
      .attr('x2', link => asGraphNode(link.target).x || 0)
      .attr('y2', link => asGraphNode(link.target).y || 0);
    nodeSelection.attr('transform', node => `translate(${node.x || 0} ${node.y || 0})`);
  });

  return () => {
    simulation.stop();
    svg.on('.zoom', null);
  };
}

function neighborSet(graph: GraphLayout, nodeId: string) {
  const neighbors = new Set<string>();
  if (!nodeId) return neighbors;
  for (const link of graph.links) {
    const source = asGraphNode(link.source);
    const target = asGraphNode(link.target);
    if (source.id === nodeId) neighbors.add(target.id);
    if (target.id === nodeId) neighbors.add(source.id);
  }
  return neighbors;
}

function truncateLabel(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
}

function getGraphNode(nodeMap: Map<string, GraphNode>, id: string, label?: unknown, group?: unknown) {
  const existing = nodeMap.get(id);
  if (existing) {
    if (group !== undefined && existing.group === 'default') existing.group = String(group || 'default');
    return existing;
  }
  const node: GraphNode = {
    id,
    label: String(label || id),
    group: String(group || 'default'),
    degree: 0
  };
  nodeMap.set(id, node);
  return node;
}

function asGraphNode(value: string | GraphNode): GraphNode {
  return typeof value === 'string' ? { id: value, label: value, group: 'default', degree: 1 } : value;
}

const graphPalette = ['#2f7f9f', '#7a5ea8', '#2f8f68', '#c26f2d', '#b84a62', '#5f7485', '#986f0b', '#4f7ec7'];

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
