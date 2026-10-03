/**
 * High-Throughput Batch Ingestion Queue
 *
 * Micro-batches incoming streaming items (trades, quotes, bars) to prevent database
 * disk thrashing during high-frequency market bursts.
 * Flushes automatically when `batchSize` is reached OR `maxWaitMs` has elapsed.
 */

export interface BatchIngestionOptions<T> {
  batchSize?: number;
  maxWaitMs?: number;
  onFlush: (batch: T[]) => void | Promise<void>;
  onError?: (err: Error) => void;
}

export class BatchIngestionQueue<T> {
  private readonly batchSize: number;
  private readonly maxWaitMs: number;
  private readonly onFlush: (batch: T[]) => void | Promise<void>;
  private readonly onError?: (err: Error) => void;

  private buffer: T[] = [];
  private timer: any = null;
  private isFlushing: boolean = false;

  constructor(options: BatchIngestionOptions<T>) {
    this.batchSize = options.batchSize || 500;
    this.maxWaitMs = options.maxWaitMs || 250;
    this.onFlush = options.onFlush;
    this.onError = options.onError;
  }

  public get pendingCount(): number {
    return this.buffer.length;
  }

  /**
   * Enqueues an item into the buffer. Flushes immediately if batchSize is reached.
   */
  public push(item: T): void {
    this.buffer.push(item);

    if (this.buffer.length >= this.batchSize) {
      this.triggerFlush();
      return;
    }

    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.triggerFlush();
      }, this.maxWaitMs);
      if (this.timer.unref) {
        this.timer.unref();
      }
    }
  }

  /**
   * Enqueues multiple items into the buffer.
   */
  public pushBatch(items: T[]): void {
    for (const item of items) {
      this.push(item);
    }
  }

  /**
   * Triggers an asynchronous flush of currently buffered items.
   */
  private triggerFlush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.buffer.length === 0 || this.isFlushing) {
      return;
    }

    const batch = this.buffer;
    this.buffer = [];
    this.isFlushing = true;

    try {
      const res = this.onFlush(batch);
      if (res && typeof (res as any).catch === 'function') {
        (res as Promise<void>).catch((err) => {
          if (this.onError) this.onError(err);
        }).finally(() => {
          this.isFlushing = false;
        });
      } else {
        this.isFlushing = false;
      }
    } catch (err: any) {
      this.isFlushing = false;
      if (this.onError) this.onError(err);
    }
  }

  /**
   * Forces an immediate flush of all pending items (e.g. before shutdown).
   */
  public async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.buffer.length === 0) {
      return;
    }

    const batch = this.buffer;
    this.buffer = [];
    await this.onFlush(batch);
  }
}
