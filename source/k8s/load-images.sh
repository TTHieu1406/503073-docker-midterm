#!/usr/bin/env bash
# Copies locally built images into every node of a Docker Desktop (kind mode) cluster.
# The cluster has its own containerd, so it cannot see images built with `docker build`.
#
#   bash k8s/load-images.sh                 loads the default DockMart images
#   bash k8s/load-images.sh my/image:tag    loads the images you name
set -euo pipefail

images=("$@")
if [ ${#images[@]} -eq 0 ]; then
  images=(dockmart/backend:1.0.0 dockmart/backend:1.1.0 dockmart/web:1.0.0 dockmart/gateway:1.0.0)
fi

for node in $(kubectl get nodes -o jsonpath='{.items[*].metadata.name}'); do
  for image in "${images[@]}"; do
    echo "Loading ${image} into ${node}"
    docker save "${image}" | docker exec -i "${node}" ctr -n k8s.io images import --snapshotter=overlayfs - >/dev/null
  done
done

echo "Done. Images on the first node:"
first_node=$(kubectl get nodes -o jsonpath='{.items[0].metadata.name}')
docker exec "${first_node}" crictl images | grep dockmart
