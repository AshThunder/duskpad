// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
// compact-runtime's zswap helpers use Node's Buffer; provide it before any Midnight module loads.
import { Buffer } from 'buffer';
(globalThis as any).Buffer ??= Buffer;
