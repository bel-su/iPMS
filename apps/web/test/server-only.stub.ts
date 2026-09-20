/**
 * Stand-in for the `server-only` marker package under vitest.
 *
 * The real package exists to make a client bundle fail at build time; it has
 * no runtime behaviour to reproduce, and it is not resolvable outside a Next
 * build because Next supplies it through an internal alias.
 */
export {};
