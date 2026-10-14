// SPDX-License-Identifier: Apache-2.0
// Browser shim: Midnight.js imports { WebSocket } from isomorphic-ws, whose browser build only has a default export.
const WS = globalThis.WebSocket;
export { WS as WebSocket };
export default WS;
