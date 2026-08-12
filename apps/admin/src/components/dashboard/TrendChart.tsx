import { useMemo, useState, type ReactElement } from "react";
import type { DashboardTrendPoint } from "../../lib/dashboard";
import { formatTRY } from "../../lib/products";

interface TrendChartProps {
  data: DashboardTrendPoint[];
  metric: "orders" | "revenue";
  height?: number;
}

interface HoverState {
  index: number;
  x: number;
  y: number;
}

const PADDING_X = 12;
const PADDING_Y = 18;

export default function TrendChart({
  data,
  metric,
  height = 220,
}: TrendChartProps): ReactElement {
  const [hover, setHover] = useState<HoverState | null>(null);
  const width = 720;
  const innerW = width - PADDING_X * 2;
  const innerH = height - PADDING_Y * 2;

  const values = useMemo(() => data.map((d) => d[metric]), [data, metric]);
  const max = Math.max(...values, 1);
  const stepX = data.length > 1 ? innerW / (data.length - 1) : innerW;

  const points = useMemo(
    () =>
      values.map((v, i) => ({
        x: PADDING_X + i * stepX,
        y: PADDING_Y + innerH - (v / max) * innerH,
        value: v,
        date: data[i].date,
      })),
    [values, max, stepX, data, innerH],
  );

  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");

  // 7 günlük HAREKETLİ ORTALAMA — günlük dalgalanmayı yumuşatan trend çizgisi.
  const MA_WINDOW = 7;
  const maPath = useMemo(() => {
    if (values.length === 0) return "";
    return values
      .map((_, i) => {
        const slice = values.slice(Math.max(0, i - MA_WINDOW + 1), i + 1);
        const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
        const x = PADDING_X + i * stepX;
        const y = PADDING_Y + innerH - (avg / max) * innerH;
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }, [values, max, stepX, innerH]);

  const areaPath = `${linePath} L${points[points.length - 1]?.x ?? 0},${PADDING_Y + innerH} L${PADDING_X},${PADDING_Y + innerH} Z`;

  const gridLines = [0.25, 0.5, 0.75].map((ratio) => ({
    y: PADDING_Y + innerH * ratio,
    label: Math.round(max * (1 - ratio)),
  }));

  function handleMove(e: React.MouseEvent<SVGRectElement>): void {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const xInChart = ratio * width;
    let nearest = 0;
    let bestDist = Infinity;
    for (let i = 0; i < points.length; i++) {
      const d = Math.abs(points[i].x - xInChart);
      if (d < bestDist) {
        bestDist = d;
        nearest = i;
      }
    }
    const p = points[nearest];
    setHover({ index: nearest, x: p.x, y: p.y });
  }

  const hoveredPoint = hover ? points[hover.index] : null;
  const hoveredDate = hoveredPoint
    ? new Date(hoveredPoint.date).toLocaleDateString("tr-TR", {
        day: "2-digit",
        month: "short",
      })
    : null;

  return (
    <div className="relative">
      <div className="mb-1 flex items-center justify-end gap-3 text-[10px] font-medium text-slate-500">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-0.5 w-4 rounded bg-[#3b82f6]" /> Günlük
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-0 w-4 border-t-2 border-dashed border-[#f59e0b]" />{" "}
          7 günlük ort.
        </span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        className="block overflow-visible"
        role="img"
        aria-label={metric === "orders" ? "30 günlük sipariş eğilimi" : "30 günlük ciro eğilimi"}
      >
        <defs>
          <linearGradient id="trend-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.22} />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="trend-line" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="#6366f1" />
            <stop offset="100%" stopColor="#3b82f6" />
          </linearGradient>
          <filter id="trend-neon" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.4" result="glow" />
            <feMerge>
              <feMergeNode in="glow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {gridLines.map((g, i) => (
          <g key={i}>
            <line
              x1={PADDING_X}
              x2={width - PADDING_X}
              y1={g.y}
              y2={g.y}
              stroke="rgba(15,23,42,0.08)"
              strokeDasharray="3 3"
            />
            <text
              x={PADDING_X - 4}
              y={g.y}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize={10}
              fill="rgba(15,23,42,0.45)"
            >
              {metric === "revenue" ? `${(g.label / 1000).toFixed(0)}k` : g.label}
            </text>
          </g>
        ))}

        <path d={areaPath} fill="url(#trend-fill)" />
        <path
          d={linePath}
          fill="none"
          stroke="url(#trend-line)"
          strokeWidth={2.25}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {/* 7 günlük hareketli ortalama */}
        <path
          d={maPath}
          fill="none"
          stroke="#f59e0b"
          strokeWidth={1.75}
          strokeDasharray="5 4"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {hoveredPoint && (
          <>
            <line
              x1={hoveredPoint.x}
              x2={hoveredPoint.x}
              y1={PADDING_Y}
              y2={PADDING_Y + innerH}
              stroke="#3b82f6"
              strokeOpacity={0.4}
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <circle
              cx={hoveredPoint.x}
              cy={hoveredPoint.y}
              r={5}
              fill="#ffffff"
              stroke="#3b82f6"
              strokeWidth={2}
              filter="url(#trend-neon)"
            />
          </>
        )}

        <rect
          x={0}
          y={0}
          width={width}
          height={height}
          fill="transparent"
          onMouseMove={handleMove}
          onMouseLeave={() => setHover(null)}
        />
      </svg>

      {hoveredPoint && hoveredDate && (
        <div
          className="pointer-events-none absolute rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 shadow-lg"
          style={{
            left: `${(hoveredPoint.x / width) * 100}%`,
            top: 0,
            transform: "translate(-50%, -110%)",
          }}
        >
          <div className="font-medium text-slate-500">{hoveredDate}</div>
          <div className="mt-0.5 font-semibold tabular-nums">
            {metric === "revenue"
              ? formatTRY(hoveredPoint.value)
              : `${hoveredPoint.value} sipariş`}
          </div>
        </div>
      )}
    </div>
  );
}
