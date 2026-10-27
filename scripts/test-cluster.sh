#!/bin/bash

# Redis Cluster for the cluster integration tests: three masters in one container,
# published on 127.0.0.1 only.
#
# Usage:
#   scripts/test-cluster.sh up [redis|valkey]   # prints REDIS_CLUSTER_NODES=...
#   REDIS_CLUSTER_NODES=127.0.0.1:7101,127.0.0.1:7102,127.0.0.1:7103 \
#     npx vitest --run tests/integration/cluster
#   scripts/test-cluster.sh down

set -euo pipefail

CONTAINER=redlock-test-cluster
PORTS=(7101 7102 7103)

# Removes the container and its anonymous volumes (the redis image declares /data)
stop() {
  docker rm -f -v "$CONTAINER" >/dev/null 2>&1 || true
}

start() {
  local server=$1 image
  case "$server" in
    redis) image=redis:7-alpine ;;
    valkey) image=valkey/valkey:8-alpine ;;
    *)
      echo "Unknown server '$server' (expected redis or valkey)" >&2
      exit 1
      ;;
  esac

  local publish=() nodes=()
  for port in "${PORTS[@]}"; do
    publish+=(-p "127.0.0.1:${port}:${port}")
    nodes+=("127.0.0.1:${port}")
  done

  # Replace a cluster left over from an earlier run
  stop

  # Nodes announce 127.0.0.1 and use the same port inside and outside the container,
  # so clients on the host can follow MOVED redirects.
  docker run -d --name "$CONTAINER" "${publish[@]}" "$image" sh -c "
    for port in ${PORTS[*]}; do
      ${server}-server --port \$port --cluster-enabled yes --cluster-config-file nodes-\$port.conf \
        --cluster-announce-ip 127.0.0.1 --bind 0.0.0.0 --protected-mode no \
        --save '' --appendonly no --daemonize yes --logfile /tmp/\$port.log
    done
    sleep 1
    ${server}-cli --cluster create ${nodes[*]} --cluster-replicas 0 --cluster-yes
    exec tail -f /tmp/${PORTS[0]}.log" >/dev/null

  for _ in $(seq 1 60); do
    if docker exec "$CONTAINER" "${server}-cli" -p "${PORTS[0]}" cluster info 2>/dev/null |
      grep -q 'cluster_state:ok'; then
      echo "REDIS_CLUSTER_NODES=$(IFS=,; echo "${nodes[*]}")"
      return 0
    fi
    sleep 0.5
  done

  echo "Cluster did not become ready" >&2
  docker logs "$CONTAINER" >&2
  stop
  exit 1
}

case "${1:-}" in
  up) start "${2:-redis}" ;;
  down) stop ;;
  *)
    echo "Usage: $0 up [redis|valkey] | down" >&2
    exit 1
    ;;
esac
