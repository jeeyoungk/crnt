import { test, expect } from 'bun:test';
import { DefaultQueue } from './queue';
import { withFakeTimers } from './test-helpers';

test('Queue allows immediate enqueue/dequeue when capacity available', async () => {
  const queue = new DefaultQueue<number>(3);

  // Should enqueue immediately
  await queue.enqueue(1);
  await queue.enqueue(2);
  expect(queue.size).toBe(2);

  // Should dequeue immediately
  const item1 = await queue.dequeue();
  const item2 = await queue.dequeue();
  expect(item1).toBe(1);
  expect(item2).toBe(2);
  expect(queue.size).toBe(0);
});

test('Queue blocks enqueue when at capacity', async () => {
  await withFakeTimers(async clock => {
    const queue = new DefaultQueue<string>(2);
    let enqueued = false;

    // Fill the queue to capacity
    await queue.enqueue('first');
    await queue.enqueue('second');
    expect(queue.size).toBe(2);

    // Third enqueue should block
    const enqueuePromise = queue.enqueue('third').then(() => {
      enqueued = true;
    });

    // Give a small delay to ensure the enqueue() would have completed if it wasn't blocked
    clock.tick(10);
    expect(enqueued).toBe(false);
    expect(queue.size).toBe(2);

    // Dequeue one item and verify the waiting enqueue completes
    const item = await queue.dequeue();
    expect(item).toBe('first');
    await enqueuePromise;
    expect(enqueued).toBe(true);
    expect(queue.size).toBe(2);
  });
});

test('Queue blocks dequeue when empty', async () => {
  await withFakeTimers(async clock => {
    const queue = new DefaultQueue<number>();
    let dequeued = false;
    let dequeuedValue: number | undefined;

    // Dequeue from empty queue should block
    const dequeuePromise = queue.dequeue().then(value => {
      dequeued = true;
      dequeuedValue = value;
    });

    // Give a small delay to ensure the dequeue() would have completed if it wasn't blocked
    clock.tick(10);
    expect(dequeued).toBe(false);

    // Enqueue an item and verify the waiting dequeue completes
    await queue.enqueue(42);
    await dequeuePromise;
    expect(dequeued).toBe(true);
    expect(dequeuedValue).toBe(42);
    expect(queue.size).toBe(0);
  });
});

test('Queue maintains FIFO order for enqueue operations', async () => {
  const queue = new DefaultQueue<number>(1);
  const results: number[] = [];

  // Fill the queue
  await queue.enqueue(1);

  // Queue multiple enqueue operations
  const promises = [
    queue.enqueue(2).then(() => results.push(2)),
    queue.enqueue(3).then(() => results.push(3)),
    queue.enqueue(4).then(() => results.push(4)),
  ];

  // Dequeue items one by one to make space
  expect(await queue.dequeue()).toBe(1);
  expect(await queue.dequeue()).toBe(2);
  expect(await queue.dequeue()).toBe(3);
  expect(await queue.dequeue()).toBe(4);

  await Promise.all(promises);
  expect(results).toEqual([2, 3, 4]);
});

test('Queue maintains FIFO order for dequeue operations', async () => {
  const queue = new DefaultQueue<number>();
  const results: number[] = [];

  // Queue multiple dequeue operations on empty queue
  const promises = [
    queue.dequeue().then(value => results.push(value)),
    queue.dequeue().then(value => results.push(value)),
    queue.dequeue().then(value => results.push(value)),
  ];

  // Give a small delay to ensure all dequeues are waiting
  await new Promise(resolve => setTimeout(resolve, 10));

  // Enqueue items one by one
  await queue.enqueue(10);
  await queue.enqueue(20);
  await queue.enqueue(30);

  await Promise.all(promises);
  expect(results).toEqual([10, 20, 30]);
});

test('maybeEnqueue returns true when space available, false when full', () => {
  const queue = new DefaultQueue<string>(2);

  expect(queue.maybeEnqueue('first')).toBe(true);
  expect(queue.size).toBe(1);

  expect(queue.maybeEnqueue('second')).toBe(true);
  expect(queue.size).toBe(2);

  expect(queue.maybeEnqueue('third')).toBe(false);
  expect(queue.size).toBe(2);
});

test('maybeDequeue returns [item, true] when items available, [void, false] when empty', () => {
  const queue = new DefaultQueue<number>();

  // Empty queue
  const emptyResult = queue.maybeDequeue();
  expect(emptyResult).toEqual([undefined, false]);

  // Add items
  queue.maybeEnqueue(100);
  queue.maybeEnqueue(200);

  // Dequeue items
  const result1 = queue.maybeDequeue();
  expect(result1).toEqual([100, true]);

  const result2 = queue.maybeDequeue();
  expect(result2).toEqual([200, true]);

  // Empty again
  const emptyResult2 = queue.maybeDequeue();
  expect(emptyResult2).toEqual([undefined, false]);
});

test('Queue supports AbortSignal for enqueue operations', async () => {
  const queue = new DefaultQueue<number>(1);
  const controller = new AbortController();

  // Fill the queue
  await queue.enqueue(1);

  // Start a blocking enqueue with abort signal
  const enqueuePromise = queue.enqueue(2, { signal: controller.signal });

  // Give a small delay to ensure enqueue is waiting
  await new Promise(resolve => setTimeout(resolve, 10));

  // Abort the operation
  controller.abort();

  // Should reject with abort error
  await expect(enqueuePromise).rejects.toThrow();
});

test('Queue supports AbortSignal for dequeue operations', async () => {
  const queue = new DefaultQueue<number>();
  const controller = new AbortController();

  // Start a blocking dequeue with abort signal
  const dequeuePromise = queue.dequeue({ signal: controller.signal });

  // Give a small delay to ensure dequeue is waiting
  await new Promise(resolve => setTimeout(resolve, 10));

  // Abort the operation
  controller.abort();

  // Should reject with abort error
  await expect(dequeuePromise).rejects.toThrow();
});

test('Queue with infinite capacity', async () => {
  const queue = new DefaultQueue<number>(); // Default is Infinity

  // Should be able to enqueue many items without blocking
  for (let i = 0; i < 1000; i++) {
    await queue.enqueue(i);
  }
  expect(queue.size).toBe(1000);

  // Should be able to dequeue all items
  for (let i = 0; i < 1000; i++) {
    const item = await queue.dequeue();
    expect(item).toBe(i);
  }
  expect(queue.size).toBe(0);
});

test('Queue handles concurrent producers and consumers', async () => {
  const queue = new DefaultQueue<number>(5);
  const produced: number[] = [];
  const consumed: number[] = [];

  // Start multiple producers
  const producers = Array.from({ length: 3 }, async (_, producerId) => {
    for (let i = 0; i < 10; i++) {
      const value = producerId * 100 + i;
      await queue.enqueue(value);
      produced.push(value);
    }
  });

  // Start multiple consumers
  const consumers = Array.from({ length: 2 }, async () => {
    for (let i = 0; i < 15; i++) {
      const value = await queue.dequeue();
      consumed.push(value);
    }
  });

  // Wait for all producers and consumers to complete
  await Promise.all([...producers, ...consumers]);

  expect(produced.length).toBe(30);
  expect(consumed.length).toBe(30);
  expect(queue.size).toBe(0);

  // All produced items should have been consumed
  produced.sort((a, b) => a - b);
  consumed.sort((a, b) => a - b);
  expect(consumed).toEqual(produced);
});

test('Queue cleanup on abort removes waiting operations', async () => {
  const queue = new DefaultQueue<number>(1);
  const controller1 = new AbortController();
  const controller2 = new AbortController();

  // Fill the queue
  await queue.enqueue(1);

  // Start two blocking enqueues with different abort signals
  const enqueue1 = queue.enqueue(2, { signal: controller1.signal });
  const enqueue2 = queue.enqueue(3, { signal: controller2.signal });

  // Give time for operations to queue up
  await new Promise(resolve => setTimeout(resolve, 10));

  // Abort the first operation
  controller1.abort();
  await expect(enqueue1).rejects.toThrow();

  // Make space in queue - should wake up the second operation
  await queue.dequeue(); // Remove item 1
  await enqueue2; // Should complete successfully

  expect(queue.size).toBe(1);
  expect(await queue.dequeue()).toBe(3);
});

test('Queue size tracking is accurate', async () => {
  const queue = new DefaultQueue<string>(3);

  expect(queue.size).toBe(0);

  await queue.enqueue('a');
  expect(queue.size).toBe(1);

  await queue.enqueue('b');
  expect(queue.size).toBe(2);

  await queue.dequeue();
  expect(queue.size).toBe(1);

  await queue.enqueue('c');
  expect(queue.size).toBe(2);

  await queue.dequeue();
  await queue.dequeue();
  expect(queue.size).toBe(0);
});

// Zero-capacity queue tests (DefaultQueue with capacity 0)
test('Zero-capacity queue has size 0 always', () => {
  const queue = new DefaultQueue<number>(0);
  expect(queue.size).toBe(0);
});

test('Zero-capacity queue maybeEnqueue fails when no waiting dequeuers', () => {
  const queue = new DefaultQueue<string>(0);
  expect(queue.maybeEnqueue('test')).toBe(false);
  expect(queue.size).toBe(0);
});

test('Zero-capacity queue maybeDequeue fails when no waiting enqueuers', () => {
  const queue = new DefaultQueue<number>(0);
  const result = queue.maybeDequeue();
  expect(result).toEqual([undefined, false]);
});

test('Zero-capacity queue passes item directly from enqueuer to dequeuer', async () => {
  const queue = new DefaultQueue<string>(0);
  let dequeuedValue: string | undefined;
  let dequeueCompleted = false;

  // Start dequeue operation (will wait)
  const dequeuePromise = queue.dequeue().then(value => {
    dequeuedValue = value;
    dequeueCompleted = true;
  });

  // Give a small delay to ensure dequeue is waiting
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(dequeueCompleted).toBe(false);

  // Enqueue should complete immediately and wake up the dequeuer
  await queue.enqueue('hello');
  await dequeuePromise;

  expect(dequeueCompleted).toBe(true);
  expect(dequeuedValue).toBe('hello');
  expect(queue.size).toBe(0);
});

test('Zero-capacity queue passes item directly from dequeuer to enqueuer via maybeEnqueue', async () => {
  const queue = new DefaultQueue<number>(0);
  let dequeuedValue: number | undefined;
  let dequeueCompleted = false;

  // Start dequeue operation (will wait)
  const dequeuePromise = queue.dequeue().then(value => {
    dequeuedValue = value;
    dequeueCompleted = true;
  });

  // Give a small delay to ensure dequeue is waiting
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(dequeueCompleted).toBe(false);

  // maybeEnqueue should succeed because there's a waiting dequeuer
  expect(queue.maybeEnqueue(42)).toBe(true);
  await dequeuePromise;

  expect(dequeueCompleted).toBe(true);
  expect(dequeuedValue).toBe(42);
});

test('Zero-capacity queue passes item directly from enqueuer to dequeuer via maybeDequeue', async () => {
  const queue = new DefaultQueue<string>(0);
  let enqueueCompleted = false;

  // Start enqueue operation (will wait)
  const enqueuePromise = queue.enqueue('world').then(() => {
    enqueueCompleted = true;
  });

  // Give a small delay to ensure enqueue is waiting
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(enqueueCompleted).toBe(false);

  // maybeDequeue should succeed because there's a waiting enqueuer
  const result = queue.maybeDequeue();
  expect(result).toEqual(['world', true]);
  await enqueuePromise;

  expect(enqueueCompleted).toBe(true);
});

test('Zero-capacity queue handles multiple waiting dequeuers in FIFO order', async () => {
  const queue = new DefaultQueue<number>(0);
  const results: number[] = [];

  // Start multiple dequeue operations
  const promises = [
    queue.dequeue().then(value => results.push(value)),
    queue.dequeue().then(value => results.push(value)),
    queue.dequeue().then(value => results.push(value)),
  ];

  // Give time for all dequeues to be waiting
  await new Promise(resolve => setTimeout(resolve, 10));

  // Enqueue items one by one - should wake up dequeuers in FIFO order
  await queue.enqueue(1);
  await queue.enqueue(2);
  await queue.enqueue(3);

  await Promise.all(promises);
  expect(results).toEqual([1, 2, 3]);
});

test('Zero-capacity queue handles multiple waiting enqueuers in FIFO order', async () => {
  const queue = new DefaultQueue<string>(0);
  const results: string[] = [];

  // Start multiple enqueue operations
  const promises = [
    queue.enqueue('a').then(() => results.push('a')),
    queue.enqueue('b').then(() => results.push('b')),
    queue.enqueue('c').then(() => results.push('c')),
  ];

  // Give time for all enqueues to be waiting
  await new Promise(resolve => setTimeout(resolve, 10));

  // Dequeue items one by one - should wake up enqueuers in FIFO order
  expect(await queue.dequeue()).toBe('a');
  expect(await queue.dequeue()).toBe('b');
  expect(await queue.dequeue()).toBe('c');

  await Promise.all(promises);
  expect(results).toEqual(['a', 'b', 'c']);
});

test('Zero-capacity queue supports AbortSignal for enqueue', async () => {
  const queue = new DefaultQueue<number>(0);
  const controller = new AbortController();

  // Start a blocking enqueue
  const enqueuePromise = queue.enqueue(123, { signal: controller.signal });

  // Give time for enqueue to be waiting
  await new Promise(resolve => setTimeout(resolve, 10));

  // Abort the operation
  controller.abort();

  // Should reject with abort error
  await expect(enqueuePromise).rejects.toThrow();
});

test('Zero-capacity queue supports AbortSignal for dequeue', async () => {
  const queue = new DefaultQueue<string>(0);
  const controller = new AbortController();

  // Start a blocking dequeue
  const dequeuePromise = queue.dequeue({ signal: controller.signal });

  // Give time for dequeue to be waiting
  await new Promise(resolve => setTimeout(resolve, 10));

  // Abort the operation
  controller.abort();

  // Should reject with abort error
  await expect(dequeuePromise).rejects.toThrow();
});

test('Zero-capacity queue concurrent producers and consumers rendezvous correctly', async () => {
  const queue = new DefaultQueue<number>(0);
  const produced: number[] = [];
  const consumed: number[] = [];

  // Start multiple producers
  const producers = Array.from({ length: 3 }, async (_, producerId) => {
    for (let i = 0; i < 5; i++) {
      const value = producerId * 10 + i;
      await queue.enqueue(value);
      produced.push(value);
    }
  });

  // Start multiple consumers
  const consumers = Array.from({ length: 3 }, async () => {
    for (let i = 0; i < 5; i++) {
      const value = await queue.dequeue();
      consumed.push(value);
    }
  });

  // Wait for all producers and consumers to complete
  await Promise.all([...producers, ...consumers]);

  expect(produced.length).toBe(15);
  expect(consumed.length).toBe(15);
  expect(queue.size).toBe(0);

  // All produced items should have been consumed
  produced.sort((a, b) => a - b);
  consumed.sort((a, b) => a - b);
  expect(consumed).toEqual(produced);
});

// Circular queue specific tests
test('toArray() returns items in correct FIFO order for circular queue', () => {
  const queue = new DefaultQueue<number>(5);

  // Add some items
  queue.maybeEnqueue(1);
  queue.maybeEnqueue(2);
  queue.maybeEnqueue(3);

  expect(queue.toArray()).toEqual([1, 2, 3]);

  // Dequeue first item
  const [first] = queue.maybeDequeue();
  expect(first).toBe(1);
  expect(queue.toArray()).toEqual([2, 3]);

  // Add more items to test wrap-around
  queue.maybeEnqueue(4);
  queue.maybeEnqueue(5);
  queue.maybeEnqueue(6); // This should wrap around in the circular buffer

  expect(queue.toArray()).toEqual([2, 3, 4, 5, 6]);
});

test('toArray() handles empty queue correctly', () => {
  const queue = new DefaultQueue<string>(3);
  expect(queue.toArray()).toEqual([]);

  queue.maybeEnqueue('a');
  expect(queue.toArray()).toEqual(['a']);

  queue.maybeDequeue();
  expect(queue.toArray()).toEqual([]);
});

test('toArray() returns empty array for zero-capacity queue', async () => {
  const queue = new DefaultQueue<number>(0);
  expect(queue.toArray()).toEqual([]);

  // Even with waiting operations, toArray should be empty
  const dequeuePromise = queue.dequeue();
  expect(queue.toArray()).toEqual([]);

  // Clean up the waiting promise
  queue.maybeEnqueue(1);
  await dequeuePromise;
});

test('Circular queue handles buffer expansion correctly for infinite capacity', async () => {
  const queue = new DefaultQueue<number>(); // Infinite capacity, starts with buffer size 16

  // Fill beyond initial buffer size to test expansion
  const itemCount = 50;
  for (let i = 0; i < itemCount; i++) {
    await queue.enqueue(i);
  }

  expect(queue.size).toBe(itemCount);

  // Verify FIFO order is maintained after expansion
  const result = queue.toArray();
  expect(result.length).toBe(itemCount);
  for (let i = 0; i < itemCount; i++) {
    expect(result[i]).toBe(i);
  }

  // Dequeue some items and verify order
  for (let i = 0; i < 10; i++) {
    expect(await queue.dequeue()).toBe(i);
  }

  // Add more items and verify they're added at the end
  await queue.enqueue(100);
  await queue.enqueue(101);

  const finalArray = queue.toArray();
  expect(finalArray.slice(0, 5)).toEqual([10, 11, 12, 13, 14]); // First remaining items
  expect(finalArray.slice(-2)).toEqual([100, 101]); // Last added items
});

test('Circular queue maintains performance with wrap-around operations', () => {
  const queue = new DefaultQueue<number>(10);

  // Fill the queue
  for (let i = 0; i < 10; i++) {
    queue.maybeEnqueue(i);
  }

  // Dequeue half the items
  for (let i = 0; i < 5; i++) {
    queue.maybeDequeue();
  }

  // Add new items (this should wrap around in circular buffer)
  for (let i = 10; i < 15; i++) {
    queue.maybeEnqueue(i);
  }

  expect(queue.size).toBe(10);
  expect(queue.toArray()).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);

  // Verify FIFO order is maintained
  const results = [];
  while (queue.size > 0) {
    const [item] = queue.maybeDequeue();
    results.push(item);
  }

  expect(results).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
});
