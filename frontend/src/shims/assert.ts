// SPDX-License-Identifier: Apache-2.0
// Browser shim for Node's `assert`, used by a transitive SCALE codec dependency.
function assert(cond: unknown, msg?: string): asserts cond { if (!cond) throw new Error(msg ?? 'Assertion failed'); }
assert.ok = assert;
assert.equal = (a: unknown, b: unknown, msg?: string) => assert(a == b, msg ?? `${String(a)} == ${String(b)}`);
assert.strictEqual = (a: unknown, b: unknown, msg?: string) => assert(a === b, msg ?? `${String(a)} === ${String(b)}`);
export default assert;
