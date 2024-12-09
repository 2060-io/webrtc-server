export interface TransportAppData {
  consuming?: boolean
}

// This is necessary because `mediasoup` does not export a `BweTraceInfo` type.
export interface BweTraceInfo {
  desiredBitrate: number
  effectiveDesiredBitrate: number
  availableBitrate: number
}
