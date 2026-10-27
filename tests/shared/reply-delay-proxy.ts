import net from 'node:net';

const PROXY_HOST = '127.0.0.1';

export interface ReplyDelayProxy {
  /** Local port to connect to instead of the target */
  readonly port: number;
  close(): Promise<void>;
}

/**
 * TCP proxy that forwards requests at once and holds every reply for `replyDelayMs`.
 * Simulates a Redis node that is reachable but slow to answer.
 */
export async function startReplyDelayProxy(
  targetHost: string,
  targetPort: number,
  replyDelayMs: number
): Promise<ReplyDelayProxy> {
  const sockets = new Set<net.Socket>();

  const server = net.createServer(downstream => {
    const upstream = net.connect(targetPort, targetHost);
    sockets.add(downstream);
    sockets.add(upstream);

    downstream.on('data', chunk => upstream.write(chunk));
    upstream.on('data', chunk => {
      setTimeout(() => {
        if (!downstream.destroyed) {
          downstream.write(chunk);
        }
      }, replyDelayMs);
    });

    const closeBoth = (): void => {
      downstream.destroy();
      upstream.destroy();
    };
    for (const socket of [downstream, upstream]) {
      socket.on('close', closeBoth);
      socket.on('error', closeBoth);
    }
  });

  await new Promise<void>(resolve => server.listen(0, PROXY_HOST, resolve));

  return {
    port: (server.address() as net.AddressInfo).port,
    close: () =>
      new Promise<void>(resolve => {
        for (const socket of sockets) {
          socket.destroy();
        }
        server.close(() => resolve());
      }),
  };
}
