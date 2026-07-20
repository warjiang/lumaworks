export async function mapConcurrent<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('并发数必须是正整数')
  const results = new Array<R>(items.length)
  let cursor = 0
  let failure: unknown
  let failed = false

  const run = async (): Promise<void> => {
    while (!failed) {
      if (signal?.aborted) { const error = new Error('任务已取消'); error.name = 'AbortError'; failure = error; failed = true; return }
      const index = cursor++
      if (index >= items.length) return
      try { results[index] = await worker(items[index], index) }
      catch (error) { if (!failed) { failure = error; failed = true } }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()))
  if (failed) throw failure
  return results
}
