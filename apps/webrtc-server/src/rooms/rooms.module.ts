import { Module } from '@nestjs/common'
import { RoomsService } from './rooms.service'
import { RoomsController } from './rooms.controller'
import { NotificationService } from '../lib/notification.service'

@Module({
  controllers: [RoomsController],
  providers: [RoomsService, NotificationService],
})
export class RoomsModule {}
