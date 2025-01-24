import { Module } from '@nestjs/common'
import { LoadbalancerController } from './loadbalancer.controller'
import { LoadbalancerService } from './loadbalancer.service'
import { ConfigModule } from '@nestjs/config'
import appConfig from './config/app.config'
import { HandledRedisModule } from './modules/redis.module'
import { HttpRequestService } from './lib/HttpRequestService'

@Module({
  imports: [
    ConfigModule.forRoot({
      load: [appConfig],
      isGlobal: true,
    }),
    HandledRedisModule,
  ],
  controllers: [LoadbalancerController],
  providers: [LoadbalancerService, HttpRequestService],
})
export class LoadbalancerModule {}
