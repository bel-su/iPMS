/**
 * Shared by the server-rendered sidebar (which reads it, so a collapsed rail
 * never flashes open on load) and the client toggle (which writes it). Kept
 * out of the `'use client'` module: a server component importing a constant
 * from one gets a client reference, not the string.
 */
export const SIDEBAR_COOKIE = 'ipms-sidebar';
export const SIDEBAR_COLLAPSED = 'collapsed';
