// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['test/**/*.test.ts'], testTimeout: 60_000, reporters: ['default'] } });
