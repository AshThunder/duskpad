// SPDX-License-Identifier: Apache-2.0
// Absolute paths to compiled contract assets (keys/, zkir/), for Node consumers.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
export const SALE_ZK = path.join(here, 'managed', 'sale');
export const TUSD_ZK = path.join(here, 'managed', 'tusd');
