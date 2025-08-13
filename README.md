# CRNT (Current)

CRNT is a TypeScript library for async and concurrent programming primitives.

- [Documentation](https://crnt.jeeyoungk.com/)

## Installation

```bash
npm install crnt
pnpm instsall crnt
bun add crnt
```

# Overview / Philosophy

- TypeScript - first
- Unopinionated, lightweight, and un-intrusive
- Support for modern constructs (ex: [AbortController](https://developer.mozilla.org/en-US/docs/Web/API/AbortController))
- Performance - optimized for speed and reducing memory leaks.
- Synchronous and asynchronous methods.

The library is a modern replacement for the following popular NPM libraries

- [async-mutex](https://www.npmjs.com/package/async-mutex)
- [async-sema](https://www.npmjs.com/package/async-sema)
- [p-limit](https://www.npmjs.com/package/p-limit)
- [p-queue](https://www.npmjs.com/package/p-queue)

# High level structure

Most operations return `Promise`s.

However, there are various synchronous `maybe*()` methods which operates synchronously. These operations return `true` if they were successful, `false` otherwise.

Operations can be cancelled, either by a timeout value or an `AbortSignal`.
