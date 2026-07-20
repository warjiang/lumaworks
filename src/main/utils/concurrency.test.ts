import { describe, expect, it } from 'vitest'
import { mapConcurrent } from './concurrency'

describe('mapConcurrent', () => {
  it('preserves order while running up to the requested concurrency', async () => {
    let active = 0; let peak = 0
    const result = await mapConcurrent([30, 10, 20, 5], 3, async (delay, index) => {
      active++; peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, delay))
      active--
      return index * 2
    })
    expect(peak).toBe(3)
    expect(result).toEqual([0, 2, 4, 6])
  })

  it('stops scheduling new work after a failure and waits for active work to settle', async () => {
    const started: number[] = []; const settled: number[] = []
    await expect(mapConcurrent([0, 1, 2, 3], 2, async (item) => {
      started.push(item)
      if (item === 1) throw new Error('failed')
      await new Promise((resolve) => setTimeout(resolve, 10))
      settled.push(item)
      return item
    })).rejects.toThrow('failed')
    expect(started).toEqual([0, 1])
    expect(settled).toEqual([0])
  })
})
