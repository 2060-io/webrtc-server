import { ApiProperty } from '@nestjs/swagger'
import { IsString, IsUrl, IsInt, IsUUID, Min, IsOptional } from 'class-validator'

/**
 * DTO for creating a room
 */
export class CreateRoomDto {
  @ApiProperty({
    description: 'Event notification URI',
    example: 'http://example.com/notification',
    required: false,
  })
  @IsOptional()
  @IsUrl({ require_tld: false }, { message: 'eventNotificationUri must be a valid URL' })
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

/**
 * DTO for registering a server
 */
export class RegisterServerDto {
  @ApiProperty({
    description: 'Unique identifier for the server',
    example: 'server-12345',
  })
  @IsString({ message: 'serverId must be a string' })
  serverId: string

  @ApiProperty({
    description: 'Base URL of the server',
    example: 'http://webrtc-service',
  })
  @IsUrl({ require_tld: false }, { message: 'url must be a valid URL' })
  url: string

  @ApiProperty({
    description: 'Maximum capacity of the server (number of peers)',
    example: 100,
  })
  @IsInt({ message: 'capacity must be an integer' })
  @Min(1, { message: 'capacity must be at least 1' })
  capacity: number
}

/**
 * DTO for notifying room closure
 */
export class RoomClosedDto {
  @ApiProperty({
    description: 'Unique identifier for the server',
    example: 'server-12345',
  })
  @IsString({ message: 'serverId must be a string' })
  serverId: string

  @ApiProperty({
    description: 'Unique identifier for the room',
    example: 'room-67890',
  })
  @IsString({ message: 'roomId must be a string' })
  roomId: string
}

/**
 * Interface for server data
 */
export interface ServerData {
  serverId: string
  url: string
  workers: number
}

/**
 * Interface for available server
 */
export interface AvailableServer extends ServerData {
  capacity: number
}

/**
 * Interface for room response
 */
export interface RoomResponse {
  protocol: string
  wsUrl: string
  roomId: string
}

/**
 * Interface for room data
 */
export interface RoomData {
  serverId: string
  roomId: string
}
