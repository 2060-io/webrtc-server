export interface Device {
  name: string // Required: Name of the device (e.g., "Chrome", "Firefox")
  version?: string // Optional: Version of the device or application
  flag?: string // Optional: Any specific flag (e.g., "broadcaster")
}
