export interface TransportAppData {
  consuming?: boolean
}

// This is necessary because `mediasoup` does not export a `BweTraceInfo` type.
export interface BweTraceInfo {
  desiredBitrate: number
  effectiveDesiredBitrate: number
  availableBitrate: number
}

export interface Device {
  name: string // Required: Name of the device (e.g., "Chrome", "Firefox")
  version?: string // Optional: Version of the device or application
  flag?: string // Optional: Any specific flag (e.g., "broadcaster")
}

export interface redisMessage {
  action: string
  roomId: string
} 