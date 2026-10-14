// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
export function Logo({ size = 32 }: { size?: number }) {
  return <img src="/duskpad.svg" width={size} height={size} alt="" className="rounded-[10px]" />;
}
