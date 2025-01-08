import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import appConfig from './config/app.config'
import { NotificationService } from './lib/notification.service'
import { HttpModule } from '@nestjs/axios'
import { RoomsModule } from './rooms/rooms.module'
import { HandledRedisModule } from './modules/redis.module'
import { RoomFactory } from './lib/RoomFactory'

@Module({
  imports: [
    HttpModule,
    ConfigModule.forRoot({
      envFilePath: '.env',
      load: [appConfig],
      isGlobal: true,
    }),
    RoomsModule,
    HandledRedisModule,
  ],
  controllers: [],
  providers: [NotificationService, HandledRedisModule, RoomFactory],
  exports: [NotificationService],
})
export class AppModule {}
