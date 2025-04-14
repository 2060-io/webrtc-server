# WebRTC Services 2060.io

This monorepo provides a robust and scalable infrastructure for `real-time WebRTC communications`, designed and implemented by **2060.io**. It includes **WebRTC services** and a **load balancer** to efficiently manage multiple server instances, ensuring optimal resource distribution and high availability.

## Included Applications

### **WebRTC Server**

A highly customized WebRTC server based on **Mediasoup-demo v3**, tailored to support **2060.io** services. It provides scalable, low-latency audio/video streaming with advanced WebRTC capabilities.

**Key Features:**

- Multi-peer WebRTC communication
- Scalable deployment with Kubernetes & Docker

**Documentation**: [Read more](./apps/webrtc-server/README.md)

---

### **Load Balancer for WebRTC Services**

A specialized load balancer designed to **distribute WebRTC sessions** across multiple Mediasoup-based servers, enhancing scalability and fault tolerance.

**Key Features:**

- **Intelligent session routing** based on server capacity
- **Automatic server registration and monitoring**
- **Dynamic load distribution** for high availability

**Documentation**: [Read more](./apps/loadbalancer/README.md)
