import { Module } from '@nestjs/common'
import { WebsocketService } from './websocket.service'
import { WebsocketGateway } from './websocket.gateway'
import { NotificationService } from '../lib/notification.service'
import { HttpModule } from '@nestjs/axios'

@Module({
  imports: [HttpModule],
  providers: [WebsocketGateway, WebsocketService, NotificationService],
})
export class WebsocketModule {}
