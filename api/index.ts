// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
//
// Vercel serverless entry for the hosted demo: every /api/* request goes to the same handler the
// local Node server uses. Data lives in a private Vercel Blob store (BLOB_READ_WRITE_TOKEN).
import { handle } from '../services/api/dist/server.mjs';

export default handle;
