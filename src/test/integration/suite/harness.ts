/**
 * A minimal test harness for the integration suite.
 *
 * `@vscode/test-electron` launches VS Code and calls one exported `run()`; it ships no test
 * framework, and mocha — the usual answer — is a dependency and a config file for what is currently
 * a dozen assertions. This is that dozen assertions' worth of framework: registration, a per-test
 * timeout, and a report. If the suite outgrows it in Phase 4, swap in mocha then.
 *
 * Deliberately not vitest: these tests must run *inside* the extension host, against the real
 * `vscode` module, which is exactly what the vitest suites cannot do.
 */

import { AssertionError } from 'node:assert';

const DEFAULT_TIMEOUT_MS = 20_000;

interface Test {
  readonly name: string;
  readonly fn: () => Promise<void> | void;
  readonly timeoutMs: number;
}

interface Suite {
  readonly name: string;
  readonly tests: Test[];
}

const suites: Suite[] = [];
let current: Suite | undefined;

export function describe(name: string, body: () => void): void {
  const suite: Suite = { name, tests: [] };
  suites.push(suite);
  current = suite;
  try {
    body();
  } finally {
    current = undefined;
  }
}

export function it(name: string, fn: () => Promise<void> | void, timeoutMs = DEFAULT_TIMEOUT_MS): void {
  if (!current) throw new Error(`it("${name}") was called outside describe()`);
  current.tests.push({ name, fn, timeoutMs });
}

/** Runs every registered test in registration order, and throws if any of them failed. */
export async function runAll(): Promise<void> {
  let passed = 0;
  const failures: { name: string; error: unknown }[] = [];

  for (const suite of suites) {
    console.log(`\n  ${suite.name}`);
    for (const test of suite.tests) {
      try {
        await withTimeout(test.fn(), test.timeoutMs, test.name);
        passed++;
        console.log(`    ✓ ${test.name}`);
      } catch (error) {
        failures.push({ name: `${suite.name} › ${test.name}`, error });
        console.log(`    ✗ ${test.name}`);
      }
    }
  }

  console.log(`\n  ${String(passed)} passed, ${String(failures.length)} failed\n`);

  for (const failure of failures) {
    console.error(`  ${failure.name}`);
    console.error(indent(describeError(failure.error)));
  }

  if (failures.length > 0) {
    throw new Error(`${String(failures.length)} integration test(s) failed`);
  }
}

function describeError(error: unknown): string {
  if (error instanceof AssertionError) {
    // The default `stack` buries the values under frames from this file.
    return `${error.message}\n    expected: ${format(error.expected)}\n    actual:   ${format(error.actual)}`;
  }
  if (error instanceof Error) return error.stack ?? error.message;
  return String(error);
}

function format(value: unknown): string {
  return typeof value === 'string' ? JSON.stringify(value) : JSON.stringify(value) || String(value);
}

function indent(text: string): string {
  return text
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n');
}

async function withTimeout(work: Promise<void> | void, ms: number, label: string): Promise<void> {
  if (!(work instanceof Promise)) return;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`timed out after ${String(ms)} ms: ${label}`));
    }, ms);
  });

  try {
    await Promise.race([work, expiry]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Polls until `predicate` holds. Filesystem watcher events are the reason this exists: VS Code
 * delivers them on its own schedule, so every assertion about one is necessarily a wait rather than
 * a check.
 */
export async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  label: string,
  timeoutMs = 8000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await delay(50);
  }
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
