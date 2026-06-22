#!/usr/bin/env bash
# Build images using the lcxbuilder (required in LXC containers without AppArmor)
set -e

docker buildx build --builder lcxbuilder --load -t ancestry-app-backend:dev ./backend --target dev
docker buildx build --builder lcxbuilder --load -t ancestry-app-frontend:dev ./frontend --target dev
docker buildx build --builder lcxbuilder --load -t ancestry-app-backend:latest ./backend --target prod
docker buildx build --builder lcxbuilder --load -t ancestry-app-frontend:latest ./frontend --target prod
echo "All images built."
