# Webrtc Load Balancer

## Overview

This Helm chart deploys the loadbalancer application along with the necessary Kubernetes resources. It includes:

- **Service**: Exposes the application.
- **Ingress**: Routes external traffic to the service.
- **ConfigMap**: To use app-check-proxy endpoints
- **StatefulSet**: Manages the deployment of the loadbalancer application.

## Chart Structure

- `Chart.yaml`: Contains metadata about the chart.
- `values.yaml`: Holds configuration values for the chart.
- `templates/deployment.yaml`: A single template file that defines all resources.

## Installation

### 1. Lint the Chart

Ensure the chart is correctly formatted:

```bash
helm lint ./charts/loadbalancer
```

### 2. Render Templates

Preview the generated Kubernetes manifests:

```bash
helm template mi-release ./charts/loadbalancer --namespace <your-namespace>
```

### 3. Dry-Run Installation

Simulate the installation without making changes to your cluster:

```bash
helm install --dry-run --debug mi-release ./charts/loadbalancer --namespace <your-namespace>
```

### 4. Install the Chart

If the target namespace already exists, ensure `createNamespace` is set to `false` in `values.yaml`. Otherwise, set it to `true` to have Helm create the namespace automatically.

```bash
helm install mi-release ./charts/loadbalancer --namespace <your-namespace>
```

**Note:**  

- `<release-name>` is a name you assign to this deployment instance. It helps Helm track and manage the release.  
- Example: If deploying in production, you might use:

  ```bash
  helm install didcomm-prod ./charts/loadbalancer-chart --namespace <your-namespace-prod>
  ```

## Configuration

All configurable parameters are located in the `values.yaml` file. You can adjust:

- **Service**: The name and configuration of the Service.
- **Ingress**: Hostname and TLS settings.
- **RBAC**: Names for ServiceAccount, Role, and RoleBinding.
- **StatefulSet**: Application settings such as replicas, container image, and storage.
- **Environment Variables**: Specific environment settings for your application container.

## Uninstalling the Chart

To remove the deployed release:

```bash
helm uninstall mi-release --namespace <your-namespace>
```

## Notes

- If the namespace exists externally, set `createNamespace` to `false` in `values.yaml`.
- Ensure that any pre-existing resources in the namespace do not conflict with those defined in this chart.