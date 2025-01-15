import { Module, Logger } from '@nestjs/common'
import { RedisModule, RedisModuleOptions } from '@nestjs-modules/ioredis'
import { ConfigModule, ConfigService } from '@nestjs/config'

@Module({
  imports: [
    RedisModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService): RedisModuleOptions => {
        const logger = new Logger('RedisModule')
        const redisType = configService.get<string>('appConfig.redisType', 'single')
        logger.log(`[RedisModule] Configuring Redis with type: ${redisType}`)
        if (redisType === 'cluster') {
          const nodes = configService
            .get<string>('appConfig.redisNodes', '')
            .split(',')
            .map((node) => {
              const [host, port] = node.split(':')
              return { host, port: parseInt(port, 10) }
            })
          logger.debug(`[RedisModule] Cluster Nodes: ${nodes}`)
          const natMap = configService
            .get<string>('appConfig.redisNatmap', '')
            .split(',')
            .reduce(
              (map, entry) => {
                const [externalAddress, externalPort, internalHost, internalPort] = entry.split(':')
                map[`${externalAddress}:${externalPort}`] = { host: internalHost, port: parseInt(internalPort, 10) }
                return map
              },
              {} as Record<string, { host: string; port: number }>,
            )
          logger.debug(`[RedisModule] Cluster Nat: ${nodes}`)
          return {
            type: 'cluster',
            nodes,
            options: {
              natMap,
              redisOptions: {
                connectTimeout: 10000, // Maximum wait time for connection in milliseconds
                maxRetriesPerRequest: 5, // Maximum number of retries per request
                enableReadyCheck: true, // Ensure the cluster is ready before processing commands
                reconnectOnError(err: Error): boolean {
                  const targetError = 'READONLY'
                  if (err.message.includes(targetError)) {
                    console.error('Reconnect due to READONLY error:', err)
                    return true
                  }
                  return false
                },
              },
            },
          }
        } else {
          return {
            type: 'single',
            url: configService.get<string>('REDIS_URL', 'redis://localhost:6379'),
            options: {
              connectTimeout: 10000, // Maximum wait time for connection in milliseconds
              maxRetriesPerRequest: 5, // Maximum number of retries per request
              enableReadyCheck: true, // Ensure the instance is ready before processing commands
              reconnectOnError(err: Error): boolean {
                const targetError = 'READONLY'
                if (err.message.includes(targetError)) {
                  console.error('Reconnect due to READONLY error:', err)
                  return true
                }
                return false
              },
            },
          }
        }
      },
    }),
  ],
  exports: [RedisModule],
})
export class HandledRedisModule {}
