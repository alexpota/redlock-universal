import { createHash } from 'node:crypto';

/** SHA1 digest Redis uses to identify a script (EVALSHA, SCRIPT EXISTS) */
export function scriptSha(script: string): string {
  return createHash('sha1').update(script).digest('hex');
}

/** Missing-script errors as the clients report them */
export const NO_SCRIPT_ERRORS = {
  /** Server reply surfaced by ioredis and node-redis */
  REPLY: 'NOSCRIPT No matching script. Please use EVAL.',
  /** GLIDE RequestError message */
  GLIDE: 'An error was signalled by the server: - NoScriptError: No matching script.',
} as const;
