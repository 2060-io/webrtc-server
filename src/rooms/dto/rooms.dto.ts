import { ApiProperty } from '@nestjs/swagger'
import { IsOptional, IsUrl, IsInt, Min, IsString, IsObject, IsNotEmpty, IsIn, IsBoolean, IsEnum } from 'class-validator'
import * as mediasoup from 'mediasoup'

export class CreateRoomDto {
  @ApiProperty({
    description: 'Event notification URI',
    example: 'http://example.com/notification',
    required: false,
  })
  @IsOptional()
  @IsUrl({}, { message: 'eventNotificationUri must be a valid URL' })
  eventNotificationUri?: string

  @ApiProperty({
    description: 'Maximum number of peers allowed in the room',
    example: 3,
    required: false,
  })
  @IsOptional()
  @IsInt({ message: 'maxPeerCount must be an integer' })
  @Min(2, { message: 'maxPeerCount must be at least 2' })
  maxPeerCount?: number
}

export class CreateBroadcasterDto {
  @IsString()
  id: string

  @IsString()
  displayName: string

  @IsObject()
  @IsOptional()
  device?: { name: string; version?: string }

  @IsObject()
  @IsOptional()
  rtpCapabilities?: any
}

export class DeleteBroadcasterDto {
  @IsString()
  @IsNotEmpty()
  roomId: string

  @IsString()
  @IsNotEmpty()
  broadcasterId: string
}

export class CreateBroadcasterTransportDto {
  @IsEnum(['plain', 'webrtc'], { message: 'type must be either "plain" or "webrtc"' })
  type: 'plain' | 'webrtc'

  @IsBoolean()
  @IsOptional()
  rtcpMux?: boolean

  @IsBoolean()
  @IsOptional()
  comedia?: boolean

  @IsObject()
  @IsOptional()
  sctpCapabilities?: any
}

/**
 * DTO for connecting a broadcaster transport.
 */
export class ConnectBroadcasterTransportDto {
  @IsNotEmpty()
  @IsObject()
  dtlsParameters: mediasoup.types.DtlsParameters
}

/**
 * DTO for creating a broadcaster producer.
 */
export class CreateBroadcasterProducerDto {
  @IsString()
  @IsNotEmpty()
  kind: 'audio' | 'video'

  @IsObject()
  @IsNotEmpty()
  rtpParameters: mediasoup.types.RtpParameters
}

export class CreateBroadcasterConsumerDto {
  @IsString()
  producerId: string
}

/**
 * DTO for creating a Broadcaster DataConsumer.
 */
export class CreateBroadcasterDataConsumerDto {
  @IsString()
  @IsNotEmpty()
  dataProducerId: string
}

/**
 * DTO for creating a Broadcaster DataProducer.
 */
export class CreateBroadcasterDataProducerDto {
  @IsString()
  @IsOptional()
  label?: string

  @IsString()
  @IsOptional()
  protocol?: string

  @IsOptional()
  sctpStreamParameters?: mediasoup.types.SctpStreamParameters

  @IsOptional()
  appData?: Record<string, any>
}
