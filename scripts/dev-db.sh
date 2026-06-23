#!/usr/bin/env bash
set -e

if ! docker info > /dev/null 2>&1; then
  case "$(uname -s)" in
    Darwin)
      echo "Docker not running; starting Docker Desktop..."
      open -a Docker
      ;;
    *)
      echo "Error: Docker is not running. Please start Docker and re-run 'npm run dev'."
      exit 1
      ;;
  esac

  printf "Waiting for Docker"
  until docker info > /dev/null 2>&1; do
    printf '.'
    sleep 2
  done
  echo " ready."
fi

docker compose -f docker-compose.dev.yml down --remove-orphans 2>/dev/null || true
for port in "${CORE_DB_PORT:-54320}" "${TUTOR_DB_PORT:-54321}" "${QM_DB_PORT:-55432}"; do
  ids=$(docker ps -q --filter "publish=$port")
  if [ -n "$ids" ]; then
    echo "Removing container(s) still bound to port $port..."
    docker rm -f "$ids"
  fi
done

docker network rm eduai-dev 2>/dev/null || true

docker compose -f docker-compose.dev.yml up -d --wait eduai-db ai-tutor-db question-maker-db
