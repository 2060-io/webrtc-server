import { Module } from '@nestjs/common'
import { WebsocketModule } from './websocket/websocket.module'
import { ConfigModule } from '@nestjs/config'
import appConfig from './config/app.config'
import { NotificationService } from './lib/notification.service'
import { HttpModule } from '@nestjs/axios'
import { RoomsModule } from './rooms/rooms.module';

@Module({
  imports: [
    WebsocketModule,
    HttpModule,
    ConfigModule.forRoot({
      envFilePath: '.env',
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
