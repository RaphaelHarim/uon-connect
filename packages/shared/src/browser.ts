// Entry point for the web client: constants, types and pure helpers, without the Zod schemas
// (keeps zod out of the initial bundle; schemas are validated on the server anyway).
export * from './constants.js';
export * from './types.js';
export * from './presence.js';
