#!/bin/bash
set -e

if ! docker info > /dev/null 2>&1; then
  case "$(uname -s)" in
    Darwin)
      echo "Docker not running — starting Docker Desktop..."
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

docker compose -f docker-compose.dev.yml up -d --wait core-db tutor-db qm-db
