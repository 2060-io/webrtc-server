# Pymediasoup Client Helm Chart

## Overview

This Helm chart deploys the Pymediasoup Client application along with the necessary Kubernetes resources. It includes:

- **StatefulSet**: Manages the Pymediasoup Client pod.
- **Service**: Exposes Pymediasoup Client within the cluster.
- **Ingress**: Routes external traffic to the Pymediasoup Client. It includes both public and private endpoints, restricting access to certain features within the allowed internal network.

## Installation

### 1️⃣ Lint the Chart

Ensure the chart is correctly formatted:

```bash
helm lint ./deployments/pymediasoup-client
```

### 2️⃣ Render Templates

Preview the generated Kubernetes manifests:

```bash
helm template <release-name> ./deployments/pymediasoup-client --namespace <your-namespace>
```

### 3️⃣ Dry-Run Installation

Simulate the installation without making changes to your cluster:

```bash
helm install --dry-run --debug <release-name> ./deployments/pymediasoup-client --namespace <your-namespace>
```

### 4️⃣ Install the Chart

```bash
helm upgrade --install <release-name> ./deployments/pymediasoup-client --namespace <your-namespace>
```

**Note:**  

- Replace `<release-name>` with the desired release name.  
- Example:

```bash
helm upgrade --install chatbot-dev ./deployments/pymediasoup-client --namespace 2060-core-dev
```

## Configuration

All configurable parameters are located in the `values.yaml` file.

## Uninstalling the Chart

To remove the deployed release:

```bash
helm uninstall <release-name> --namespace <your-namespace>
```

## Support

For additional information, please refer to the [Helm documentation](https://helm.sh/docs/).