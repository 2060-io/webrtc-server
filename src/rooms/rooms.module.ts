import { Module } from '@nestjs/common'
import { RoomsService } from './rooms.service'
import { RoomsController } from './rooms.controller'
import { RoomFactory } from 'src/lib/RoomFactory'

@Module({
  controllers: [RoomsController],
  providers: [RoomsService, RoomFactory],
})
export class RoomsModule {}
