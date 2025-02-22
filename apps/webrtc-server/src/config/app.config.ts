import { registerAs } from '@nestjs/config'

/**
 * Configuration for the application, including ports, database URIs, and service URLs.
 *
 * @returns {object} - An object containing the configuration settings for the application.
 */
export default registerAs('appConfig', () => ({
  /**
   * The port number on which the application will run.
   * Defaults to 3500 if APP_PORT is not set in the environment variables.
   * @type {number}
   */
  appPort: parseInt(process.env.APP_PORT, 10) || 3001,

  /**
   * Defines the Redis mode, which can be 'single' or 'cluster'.
   * Defaults to 'single' if REDIS_TYPE is not set in the environment variables.
   * @type {string}
   */
  redisType: process.env.REDIS_TYPE || 'single',

  /**
   * The Redis database URL for connecting to the Redis server Single Mode.
   * Defaults to a specified local Redis instance if REDIS_URL is not set in the environment variables.
   * @type {string}
   */
  redisDbUrl: process.env.REDIS_URL || 'redis://localhost:6379',

  /**
   * A comma-separated list of Redis nodes in 'host:port' format, used in cluster mode.
   * Only relevant if REDIS_TYPE is set to 'cluster'.
   * @type {string | undefined}
   */
  redisNodes: process.env.REDIS_NODES,

  /**
   * The NAT mapping for Redis nodes, defined in 'externalAddress:host:port' format.
   * Useful for Redis cluster configurations with external IP mappings.
   * @type {string | undefined}
   */
  redisNatmap: process.env.REDIS_NATMAP,

  /**
   * Load balancer base URL.
   * Specifies the URL of the load balancer responsible for distributing WebRTC rooms among available servers.
   * - Must be a valid URL.
   * - Typically, this is the entry point for WebRTC server registration and room allocation.
   * - Example: "http://loadbalancer.example.com"
   */
  loadbalancerUrl: process.env.LOADBALANCER_URL,

  /**
   * URL of the current service instance.
   * - Defines the base URL of the WebRTC service or application that registers itself with the load balancer.
   * - Used for health checks and room allocation.
   * - Example: `http://webrtc-service.example.com`
   */
  serviceUrl: process.env.SERVICE_URL,
}))
