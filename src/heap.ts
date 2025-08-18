/**
 * @category Data Structure
 * @summary Binary heap implementation supporting both min-heap and max-heap operations
 */
export interface Heap<Value> {
  /** Insert an element into the heap */
  insert(value: Value): void;
  /** Remove and return the highest priority element */
  pop(): Value | undefined;
  /** Peek at the highest priority element without removing it */
  peek(): Value | undefined;
  /** Get the current size of the heap */
  get size(): number;
}

/**
 * Comparison function type for heap ordering
 * Returns negative if a < b, positive if a > b, zero if a === b
 */
export type Comparator<T> = (a: T, b: T) => number;

/**
 * Binary heap implementation with configurable comparison function
 * @category Data Structure
 */
export class BinaryHeap<Value> implements Heap<Value> {
  #data: Value[] = [];
  #comparator: Comparator<Value>;

  constructor(comparator: Comparator<Value>) {
    this.#comparator = comparator;
  }

  insert(value: Value): void {
    this.#data.push(value);
    this.#heapifyUp(this.#data.length - 1);
  }

  pop(): Value | undefined {
    if (this.#data.length === 0) {
      return undefined;
    }

    if (this.#data.length === 1) {
      return this.#data.pop()!;
    }

    const root = this.#data[0]!;
    this.#data[0] = this.#data.pop()!;
    this.#heapifyDown(0);
    return root;
  }

  peek(): Value | undefined {
    return this.#data.length > 0 ? this.#data[0]! : undefined;
  }

  get size(): number {
    return this.#data.length;
  }

  #heapifyUp(index: number): void {
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);

      if (this.#comparator(this.#data[index]!, this.#data[parentIndex]!) >= 0) {
        break;
      }

      this.#swap(index, parentIndex);
      index = parentIndex;
    }
  }

  #heapifyDown(index: number): void {
    while (true) {
      let minIndex = index;
      const leftChild = 2 * index + 1;
      const rightChild = 2 * index + 2;

      if (
        leftChild < this.#data.length &&
        this.#comparator(this.#data[leftChild]!, this.#data[minIndex]!) < 0
      ) {
        minIndex = leftChild;
      }

      if (
        rightChild < this.#data.length &&
        this.#comparator(this.#data[rightChild]!, this.#data[minIndex]!) < 0
      ) {
        minIndex = rightChild;
      }

      if (minIndex === index) {
        break;
      }

      this.#swap(index, minIndex);
      index = minIndex;
    }
  }

  #swap(i: number, j: number): void {
    [this.#data[i], this.#data[j]] = [this.#data[j]!, this.#data[i]!];
  }
}
