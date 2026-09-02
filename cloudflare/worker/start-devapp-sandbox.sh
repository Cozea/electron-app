#!/bin/sh
set -eu

dockerd-entrypoint.sh --iptables=false --ip6tables=false >/tmp/dockerd.log 2>&1 &
dockerd_pid="$!"

attempt=0
until docker info >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 300 ]; then
    tail -n 100 /tmp/dockerd.log >&2 || true
    exit 1
  fi
  sleep 0.2
done

wait "$dockerd_pid"
