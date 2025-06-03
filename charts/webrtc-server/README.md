# WebRTC Server Helm Chart

## Overview

This Helm chart deploys the WebRTC server application along with the necessary Kubernetes resources. It includes:

- **Service**: Exposes the application.
- **Ingress**: Routes external traffic to the service.
- **StatefulSet**: Manages the deployment of the WebRTC server.

## Chart Structure

- `Chart.yaml`: Contains metadata about the chart.
- `values.yaml`: Holds configuration values for the chart.
- `templates/deployment.yaml`: A single template file that defines all resources.

## Installation

### 1. Lint the Chart

Ensure the chart is correctly formatted:

```bash
helm lint ./charts/webrtc-server
```

### 2. Render Templates

Preview the generated Kubernetes manifests:

```bash
helm template 2060-webrtc-demos ./charts/webrtc-server --namespace demos
```

### 3. Dry-Run Installation

Simulate the installation without making changes to your cluster:

```bash
helm install --dry-run --debug 2060-webrtc-demos ./charts/webrtc-server --namespace demos
```

### 4. Install the Chart

Ensure the target namespace already exists.

```bash
helm upgrade --install 2060-webrtc-demos ./charts/webrtc-server --namespace demos --wait 
```

---

## Configuration

All configurable parameters are located in the `values.yaml` file. You can adjust:

- **Namespace**: The target namespace and whether it should be created.
- **Instance ID**: Use `instanceId` to differentiate multiple charts.
- **Service**: The name and configuration of the Service.
- **Ingress**: Hostname and TLS settings.
- **StatefulSet**: Application settings such as replicas, container image, and storage.
- **Environment Variables**: Specific environment settings for your application container.

## Uninstalling the Chart

To remove the deployed release:

```bash
helm uninstall 2060-webrtc-demos --namespace demos
```

## Notes

- Ensure that any pre-existing resources in the namespace do not conflict with those defined in this chart.
- When deploying multiple instances, make sure the `instanceId` values are unique to avoid resource name conflicts.

## Support

For additional information, please refer to the [Helm documentation](https://helm.sh/docs/).
