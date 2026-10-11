import { test, expect } from 'vitest';
import { faker } from '@faker-js/faker';
import { BinaryHeap } from './heap';

const ascending = (a: number, b: number) => a - b;
const descending = (a: number, b: number) => b - a;

function drain<T>(heap: BinaryHeap<T>): T[] {
  const out: T[] = [];
  while (heap.size > 0) {
    out.push(heap.pop()!);
  }
  return out;
}

test('BinaryHeap is empty on construction', () => {
  const heap = new BinaryHeap(ascending);
  expect({
    size: heap.size,
    peek: heap.peek(),
    pop: heap.pop(),
    sizeAfterPop: heap.size,
  }).toMatchObject({
    size: 0,
    peek: undefined,
    pop: undefined,
    sizeAfterPop: 0,
  });
});

test('BinaryHeap with a single element', () => {
  const heap = new BinaryHeap(ascending);
  heap.insert(42);
  const afterInsert = { size: heap.size, peek: heap.peek() };
  const popped = heap.pop();
  expect({
    afterInsert,
    popped,
    afterPop: { size: heap.size, peek: heap.peek(), pop: heap.pop() },
  }).toMatchObject({
    afterInsert: { size: 1, peek: 42 },
    popped: 42,
    afterPop: { size: 0, peek: undefined, pop: undefined },
  });
});

test('BinaryHeap peek does not remove the element', () => {
  const heap = new BinaryHeap(ascending);
  for (const v of [5, 3, 8]) heap.insert(v);
  expect({
    first: heap.peek(),
    second: heap.peek(),
    size: heap.size,
  }).toMatchObject({ first: 3, second: 3, size: 3 });
});

test('BinaryHeap pops in ascending order with a min comparator', () => {
  const heap = new BinaryHeap(ascending);
  for (const v of [5, 1, 9, 3, 7, 2, 8, 4, 6, 0]) heap.insert(v);
  expect(drain(heap)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test('BinaryHeap pops in descending order with a max comparator', () => {
  const heap = new BinaryHeap(descending);
  for (const v of [5, 1, 9, 3, 7, 2, 8, 4, 6, 0]) heap.insert(v);
  expect(drain(heap)).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
});

test('BinaryHeap keeps duplicates', () => {
  const heap = new BinaryHeap(ascending);
  for (const v of [3, 1, 3, 1, 2, 2, 3]) heap.insert(v);
  expect(drain(heap)).toEqual([1, 1, 2, 2, 3, 3, 3]);
});

test('BinaryHeap handles already sorted and reverse sorted input', () => {
  const sorted = Array.from({ length: 50 }, (_, i) => i);
  const forward = new BinaryHeap(ascending);
  const backward = new BinaryHeap(ascending);
  for (const v of sorted) forward.insert(v);
  for (const v of [...sorted].reverse()) backward.insert(v);
  expect({ forward: drain(forward), backward: drain(backward) }).toMatchObject({
    forward: sorted,
    backward: sorted,
  });
});

test('BinaryHeap supports interleaved insert and pop', () => {
  const heap = new BinaryHeap(ascending);
  heap.insert(5);
  heap.insert(3);
  const a = heap.pop();
  heap.insert(1);
  heap.insert(4);
  const b = heap.pop();
  const c = heap.pop();
  heap.insert(0);
  expect({ a, b, c, rest: drain(heap) }).toMatchObject({
    a: 3,
    b: 1,
    c: 4,
    rest: [0, 5],
  });
});

test('BinaryHeap with a custom comparator on objects (priority, then sequence)', () => {
  type Entry = { priority: number; sequence: number; name: string };
  const heap = new BinaryHeap<Entry>((a, b) =>
    a.priority !== b.priority
      ? a.priority - b.priority
      : a.sequence - b.sequence
  );
  const entries: Entry[] = [
    { priority: 1, sequence: 0, name: 'a' },
    { priority: 0, sequence: 1, name: 'b' },
    { priority: 1, sequence: 2, name: 'c' },
    { priority: -1, sequence: 3, name: 'd' },
    { priority: 0, sequence: 4, name: 'e' },
  ];
  for (const e of entries) heap.insert(e);
  expect(drain(heap).map(e => e.name)).toEqual(['d', 'b', 'e', 'a', 'c']);
});

test('BinaryHeap with a string comparator', () => {
  const heap = new BinaryHeap<string>((a, b) => a.localeCompare(b));
  for (const v of ['pear', 'apple', 'fig', 'banana']) heap.insert(v);
  expect(drain(heap)).toEqual(['apple', 'banana', 'fig', 'pear']);
});

test('BinaryHeap matches a sorted array on random input (property)', () => {
  faker.seed(12345);
  for (let round = 0; round < 200; round++) {
    const length = faker.number.int({ min: 0, max: 200 });
    const values = Array.from({ length }, () =>
      faker.number.int({ min: -50, max: 50 })
    );
    const heap = new BinaryHeap(ascending);
    for (const v of values) heap.insert(v);
    expect({ size: heap.size, drained: drain(heap) }).toMatchObject({
      size: length,
      drained: [...values].sort(ascending),
    });
  }
});

test('BinaryHeap matches a reference model on random insert/pop sequences (property)', () => {
  faker.seed(67890);
  for (let round = 0; round < 100; round++) {
    const heap = new BinaryHeap(ascending);
    const model: number[] = [];
    const ops = faker.number.int({ min: 1, max: 300 });
    for (let i = 0; i < ops; i++) {
      if (faker.datatype.boolean({ probability: 0.6 })) {
        const v = faker.number.int({ min: -1000, max: 1000 });
        heap.insert(v);
        model.push(v);
        model.sort(ascending);
      } else {
        const expected = model.shift();
        const peeked = heap.peek();
        const popped = heap.pop();
        expect({ peeked, popped }).toMatchObject({
          peeked: expected,
          popped: expected,
        });
      }
      expect(heap.size).toBe(model.length);
    }
    expect(drain(heap)).toEqual(model);
  }
});
