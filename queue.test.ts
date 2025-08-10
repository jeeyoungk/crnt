import { test, expect } from 'bun:test';
import { DefaultQueue } from './queue';

test('Queue allows immediate enqueue/dequeue when capacity available', async () => {
  const queue = new DefaultQueue<number>(3);

  // Should enqueue immediately
  await queue.enqueue(1);
  await queue.enqueue(2);
  expect(queue.size()).toBe(2);

  // Should dequeue immediately
  const item1 = await queue.dequeue();
  const item2 = await queue.dequeue();
  expect(item1).toBe(1);
  expect(item2).toBe(2);
  expect(queue.size()).toBe(0);
});

test('Queue blocks enqueue when at capacity', async () => {
  const queue = new DefaultQueue<string>(2);
  let enqueued = false;

  // Fill the queue to capacity
  await queue.enqueue('first');
  await queue.enqueue('second');
  expect(queue.size()).toBe(2);

  // Third enqueue should block
  const enqueuePromise = queue.enqueue('third').then(() => {
    enqueued = true;
  });

  // Give a small delay to ensure the enqueue() would have completed if it wasn't blocked
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(enqueued).toBe(false);
  expect(queue.size()).toBe(2);

  // Dequeue one item and verify the waiting enqueue completes
  const item = await queue.dequeue();
  expect(item).toBe('first');
  await enqueuePromise;
  expect(enqueued).toBe(true);
  expect(queue.size()).toBe(2);
});

test('Queue blocks dequeue when empty', async () => {
  const queue = new DefaultQueue<number>();
  let dequeued = false;
  let dequeuedValue: number | undefined;

  // Dequeue from empty queue should block
  const dequeuePromise = queue.dequeue().then((value) => {
    dequeued = true;
    dequeuedValue = value;
  });

  // Give a small delay to ensure the dequeue() would have completed if it wasn't blocked
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(dequeued).toBe(false);

  // Enqueue an item and verify the waiting dequeue completes
  await queue.enqueue(42);
  await dequeuePromise;
  expect(dequeued).toBe(true);
  expect(dequeuedValue).toBe(42);
  expect(queue.size()).toBe(0);
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
  expect(queue.size()).toBe(1);

  expect(queue.maybeEnqueue('second')).toBe(true);
  expect(queue.size()).toBe(2);

  expect(queue.maybeEnqueue('third')).toBe(false);
  expect(queue.size()).toBe(2);
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
  expect(queue.size()).toBe(1000);

  // Should be able to dequeue all items
  for (let i = 0; i < 1000; i++) {
    const item = await queue.dequeue();
    expect(item).toBe(i);
  }
  expect(queue.size()).toBe(0);
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
  expect(queue.size()).toBe(0);

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

  expect(queue.size()).toBe(1);
  expect(await queue.dequeue()).toBe(3);
});

test('Queue size tracking is accurate', async () => {
  const queue = new DefaultQueue<string>(3);

  expect(queue.size()).toBe(0);

  await queue.enqueue('a');
  expect(queue.size()).toBe(1);

  await queue.enqueue('b');
  expect(queue.size()).toBe(2);

  await queue.dequeue();
  expect(queue.size()).toBe(1);

  await queue.enqueue('c');
  expect(queue.size()).toBe(2);

  await queue.dequeue();
  await queue.dequeue();
  expect(queue.size()).toBe(0);
});