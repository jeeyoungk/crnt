import { test, expect } from 'bun:test';
import { abortSignalPromise, raceWithAbort, sleep } from './abort';

test('signalToPromise rejects when signal is aborted', async () => {
  const controller = new AbortController();
  const signalPromise = abortSignalPromise(controller.signal);

  // Abort after a short delay
  setTimeout(() => controller.abort(), 10);

  await expect(signalPromise).rejects.toThrow('The operation was aborted');
});

test('signalToPromise rejects immediately if signal already aborted', async () => {
  const controller = new AbortController();
  controller.abort();

  const signalPromise = abortSignalPromise(controller.signal);

  await expect(signalPromise).rejects.toBeDefined();
});

test('signalToPromise never resolves for non-aborted signal', async () => {
  const controller = new AbortController();
  const signalPromise = abortSignalPromise(controller.signal);

  // Race with a timeout to ensure it doesn't resolve
  const timeoutPromise = new Promise(resolve => setTimeout(resolve, 20));

  const result = await Promise.race([
    signalPromise.then(() => 'resolved'),
    signalPromise.catch(() => 'rejected'),
    timeoutPromise.then(() => 'timeout'),
  ]);

  expect(result).toBe('timeout');
});

test('signalToPromise with abort reason', async () => {
  const controller = new AbortController();
  const customReason = new Error('Custom abort reason');

  const signalPromise = abortSignalPromise(controller.signal);

  setTimeout(() => controller.abort(customReason), 10);

  await expect(signalPromise).rejects.toThrow('Custom abort reason');
});

test('raceWithAbort resolves with promise result', async () => {
  const promise = Promise.resolve('success');
  const controller = new AbortController();

  const result = await raceWithAbort(promise, controller.signal);
  expect(result).toBe('success');
});

test('raceWithAbort rejects when signal is aborted', async () => {
  const promise = new Promise(resolve => setTimeout(resolve, 100));
  const controller = new AbortController();

  const racePromise = raceWithAbort(promise, controller.signal);

  // Abort after a short delay
  setTimeout(() => controller.abort(), 10);

  await expect(racePromise).rejects.toThrow('The operation was aborted');
});

test('raceWithAbort rejects immediately if signal already aborted', async () => {
  const promise = Promise.resolve('success');
  const controller = new AbortController();
  controller.abort();

  await expect(raceWithAbort(promise, controller.signal)).rejects.toThrow(
    'The operation was aborted'
  );
});

test('sleep resolves after specified duration', async () => {
  const start = Date.now();
  await sleep(20);
  const duration = Date.now() - start;

  expect(duration).toBeGreaterThanOrEqual(15); // Allow some variance
});

test('sleep rejects when aborted', async () => {
  const controller = new AbortController();

  const sleepPromise = sleep(100, controller.signal);

  setTimeout(() => controller.abort(), 10);

  await expect(sleepPromise).rejects.toThrow('The operation was aborted');
});

test('sleep rejects immediately if signal already aborted', async () => {
  const controller = new AbortController();
  controller.abort();

  await expect(sleep(100, controller.signal)).rejects.toThrow(
    'The operation was aborted'
  );
});
