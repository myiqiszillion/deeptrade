/**
 * Minimal Prometheus-compatible metrics registry.
 *
 * No dependency: a counter/gauge map plus a text renderer is enough for scrape-based monitoring,
 * and keeping it in-tree means the production image stays free of telemetry SDKs.
 */
type MetricKind = 'counter' | 'gauge';

interface Sample {
  labels: Record<string, string>;
  value: number;
}

interface Metric {
  name: string;
  kind: MetricKind;
  help: string;
  samples: Map<string, Sample>;
}

function labelKey(labels: Record<string, string>): string {
  const entries = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
  return entries.map(([k, v]) => `${k}="${String(v).replace(/"/g, '\\"')}"`).join(',');
}

class MetricsRegistry {
  private metrics = new Map<string, Metric>();

  private ensure(name: string, kind: MetricKind, help: string): Metric {
    let metric = this.metrics.get(name);
    if (!metric) {
      metric = { name, kind, help, samples: new Map() };
      this.metrics.set(name, metric);
    }
    return metric;
  }

  public inc(name: string, help = '', labels: Record<string, string> = {}, amount = 1): void {
    const metric = this.ensure(name, 'counter', help || name);
    const key = labelKey(labels);
    const sample = metric.samples.get(key) ?? { labels, value: 0 };
    sample.value += amount;
    metric.samples.set(key, sample);
  }

  public set(name: string, value: number, help = '', labels: Record<string, string> = {}): void {
    const metric = this.ensure(name, 'gauge', help || name);
    metric.samples.set(labelKey(labels), { labels, value });
  }

  public snapshot(): Record<string, number | Array<{ labels: Record<string, string>; value: number }>> {
    const out: Record<string, number | Array<{ labels: Record<string, string>; value: number }>> = {};
    for (const metric of this.metrics.values()) {
      const samples = Array.from(metric.samples.values());
      if (samples.length === 1 && Object.keys(samples[0].labels).length === 0) {
        out[metric.name] = samples[0].value;
      } else {
        out[metric.name] = samples.map((s) => ({ labels: s.labels, value: s.value }));
      }
    }
    return out;
  }

  public renderPrometheus(): string {
    const lines: string[] = [];
    for (const metric of this.metrics.values()) {
      lines.push(`# HELP ${metric.name} ${metric.help}`);
      lines.push(`# TYPE ${metric.name} ${metric.kind}`);
      for (const sample of metric.samples.values()) {
        const labels = labelKey(sample.labels);
        const rendered = Number.isInteger(sample.value) ? String(sample.value) : sample.value.toFixed(6);
        lines.push(labels ? `${metric.name}{${labels}} ${rendered}` : `${metric.name} ${rendered}`);
      }
    }
    return lines.join('\n') + '\n';
  }

  public reset(): void {
    this.metrics.clear();
  }
}

export const metrics = new MetricsRegistry();
