# Webrtc web client

## Overview

This Helm chart deploys the webrtc-client application along with the necessary Kubernetes resources. It includes:

- **Namespace** (optional): Can be created by the chart or managed externally.
- **Service**: Exposes the application.
- **Ingress**: Routes external traffic to the service.
- **ConfigMap**: To use app-check-proxy endpoints
- **StatefulSet**: Manages the deployment of the webrtc-client application.

## Chart Structure

- `Chart.yaml`: Contains metadata about the chart.
- `values.yaml`: Holds configuration values for the chart.
- `templates/deployment.yaml`: A single template file that defines all resources.

## Installation

### 1. Lint the Chart

Ensure the chart is correctly formatted:

```bash
helm lint ./charts/webrtc-client
```

### 2. Render Templates

Preview the generated Kubernetes manifests:

```bash
helm template 2060-webrtc-client-demos ./charts/webrtc-client --namespace demos
```

### 3. Dry-Run Installation

Simulate the installation without making changes to your cluster:

```bash
helm install --dry-run --debug 2060-webrtc-client-demo ./charts/webrtc-client --namespace demos
```

### 4. Install the Chart

If the target namespace already exists, ensure `createNamespace` is set to `false` in `values.yaml`. Otherwise, set it to `true` to have Helm create the namespace automatically.

```bash
helm install 2060-webrtc-client-demo ./charts/webrtc-client --namespace demos
```

## Configuration

Edit `values.yaml`:

```yaml

# Only these NGINX values are configurable:
configMap:
  name: webrtc-client-config                 # ConfigMap name
  serverName: "webrtc-server-0.dev.2060.io"  # ingress of instance webrtc-server in default.conf
  protooPort: 443                            # protooPort query parameter

service:
  name: webrtc-client-service
  ports:
    https: 443

ingress:
  name: webrtc-client-demos-ingress
  enabled: true
  host: webrtc-webclient.demos.dev.2060.io
  tlsSecretName: webrtc-webclient.demos.dev.2060.io-cert
```

## Installation example with serverName

```bash
helm install 2060-webrtc-client-demos ./charts/webrtc-client \
  --namespace demos \
  --set configMap.serverName=webrtc.demos.dev.2060.io \
  --set configMap.protooPort=443 --wait
```

**serverName**: The ingress host URL that the client uses to initialize the WebRTC session.

## Uninstalling the Chart

To remove the deployed release:

```bash
helm uninstall 2060-webrtc-client-demos --namespace demos-dev
```

## Notes

- If the namespace exists externally, set `createNamespace` to `false` in `values.yaml`.
- Ensure that any pre-existing resources in the namespace do not conflict with those defined in this chart.
