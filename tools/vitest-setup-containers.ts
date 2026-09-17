/**
 * Makes Testcontainers find the Docker daemon without anyone exporting env vars by hand.
 *
 * Referenced via `setupFiles` from the vitest config of every project with
 * Testcontainers-based integration tests. Without it, a fresh clone or a CI runner
 * fails with a socket error that looks nothing like its cause.
 *
 * Respects an explicit DOCKER_HOST if the caller already set one.
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

interface Candidate {
  socket: string;
  /** Colima's daemon rejects Ryuk's bind-mount of the Docker socket. */
  disableRyuk: boolean;
}

const CANDIDATES: Candidate[] = [
  { socket: join(homedir(), '.colima', 'default', 'docker.sock'), disableRyuk: true },
  { socket: join(homedir(), '.docker', 'run', 'docker.sock'), disableRyuk: false },
  { socket: '/var/run/docker.sock', disableRyuk: false },
];

if (!process.env['DOCKER_HOST']) {
  const found = CANDIDATES.find((c) => existsSync(c.socket));
  if (found) {
    process.env['DOCKER_HOST'] = `unix://${found.socket}`;
    if (found.disableRyuk && !process.env['TESTCONTAINERS_RYUK_DISABLED']) {
      // Containers are still torn down by each suite's own afterAll hook.
      process.env['TESTCONTAINERS_RYUK_DISABLED'] = 'true';
    }
  }
}
