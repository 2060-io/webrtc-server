import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import appConfig from './config/app.config'
import { NotificationService } from './lib/notification.service'
import { HttpModule } from '@nestjs/axios'
import { RoomsModule } from './rooms/rooms.module'

@Module({
  imports: [
    HttpModule,
    ConfigModule.forRoot({
      load: [appConfig],
      isGlobal: true,
    }),
    RoomsModule,
  ],
  controllers: [],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class AppModule {}
