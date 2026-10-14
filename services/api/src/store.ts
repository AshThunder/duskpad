// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
//
// JSON document store for the API. Local dev and the box servers use files in DUSKPAD_DATA_DIR;
// the hosted demo (Vercel) uses a private Vercel Blob store when BLOB_READ_WRITE_TOKEN is set.
import fs from 'node:fs';
import path from 'node:path';

export interface Store {
  load<T>(name: string, fallback: T): Promise<T>;
  save(name: string, value: unknown): Promise<void>;
}

export function fileStore(dir: string): Store {
  fs.mkdirSync(dir, { recursive: true });
  const file = (n: string) => path.join(dir, n);
  return {
    async load<T>(n: string, d: T): Promise<T> {
      try { return JSON.parse(fs.readFileSync(file(n), 'utf8')) as T; } catch { return d; }
    },
    async save(n: string, v: unknown) {
      const tmp = file(n) + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(v, null, 2));
      fs.renameSync(tmp, file(n));
    },
  };
}

export function blobStore(prefix = 'duskpad/'): Store {
  return {
    async load<T>(n: string, d: T): Promise<T> {
      const { get } = await import('@vercel/blob');
      try {
        const r = await get(prefix + n, { access: 'private', useCache: false });
        if (!r || r.statusCode !== 200 || !r.stream) return d;
        return JSON.parse(await new Response(r.stream).text()) as T;
      } catch { return d; }
    },
    async save(n: string, v: unknown) {
      const { put } = await import('@vercel/blob');
      await put(prefix + n, JSON.stringify(v), {
        access: 'private', allowOverwrite: true, addRandomSuffix: false, contentType: 'application/json', cacheControlMaxAge: 60,
      });
    },
  };
}
