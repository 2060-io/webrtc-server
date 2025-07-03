# Webrtc Load Balancer

## Overview

This Helm chart deploys the `webrtc-load-balancer` application along with the necessary Kubernetes resources. It supports an optional `appCheckProxy` container and includes:

- **Service**: Exposes the application via HTTP and optionally app-check port.
- **Ingress**: Routes external traffic to the service with TLS.
- **ConfigMap**: Used to provide `ENDPOINT_URLS` for `appCheckProxy` when enabled.
- **StatefulSet**: Manages the deployment of the application with support for multiple containers.

## Chart Structure

- `Chart.yaml`: Metadata for the Helm chart.
- `values.yaml`: Configurable parameters.
- `templates/`: Helm templates including StatefulSet, Service, Ingress, and ConfigMap.

## Installation

### 1. Lint the Chart

```bash
helm lint ./charts/loadbalancer
```

### 2. Render Templates

```bash
helm template mi-release ./charts/loadbalancer --namespace <your-namespace>
```

### 3. Dry-Run Installation

```bash
helm install --dry-run --debug mi-release ./charts/loadbalancer --namespace <your-namespace>
```

### 4. Install the Chart

```bash
helm install mi-release ./charts/loadbalancer --namespace <your-namespace>
```

## Configuration

All values are configured through the `values.yaml` file:

### Global

- `global.domain`: The base domain used in ingress and ConfigMap.

### StatefulSet

- `statefulset.name`, `replicas`, `pullPolicy`, `resources`: Settings for the main container.
- `statefulset.env`: List of environment variables rendered with `tpl` support.

### appCheckProxy

- `enabled`: Enables or disables the container.
- `name`, `pullPolicy`, `env`, `resources`: Independent settings.
- `configMap.name` and `key`: Used to inject `ENDPOINT_URLS`.

### Ingress

- `enabled`: Enables the ingress.
- `host`, `tlsSecret`: Rendered via `tpl`.

### Service

- `name`: The service name.
- `ports.http`, `ports.appCheck`: Ports for main app and proxy.

## Uninstalling the Chart

```bash
helm uninstall mi-release --namespace <your-namespace>
```

## Notes

- If the namespace exists, you do **not** need to create it via Helm.
- The `appCheckProxy` container is **optional** and fully configurable.
- Use `tpl` when referencing templated values in environment variables or domains.
- You can configure the `ENDPOINT_URLS` content for `appCheckProxy` directly via:

```yaml
appCheckProxy:
  configMap:
    endpointUrls: |
      [
        {
          "pattern": "/.*",
          "baseUrl": "http://webrtc-loadbalancer.{{ .Release.Namespace }}"
        }
      ]
```
