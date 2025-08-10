export class Semaphore {
  private permits: number
  private readonly waiting: (() => void)[] = []

  /**
   * Creates a new Semaphore with the specified number of permits.
   * @param permits - Maximum number of concurrent operations allowed
   */
  constructor(permits: number) {
    this.permits = permits
  }

  /**
   * Acquires a permit. If no permits are available, waits until one becomes available.
   * @returns Promise that resolves when a permit is acquired
   */
  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--
      return
    }

    return new Promise<void>(resolve => {
      this.waiting.push(resolve)
    })
  }

  /**
   * Releases a permit, making it available for other operations.
   * If there are waiting operations, immediately gives the permit to the next waiter.
   */
  release(): void {
    if (this.waiting.length > 0) {
      const next = this.waiting.shift()
      next?.()
    } else {
      this.permits++
    }
  }
}