export enum MessageState {
  pending = 'pending',
  sending = 'sending',
}

export const WS_PORT = Number(process.env.WS_PORT || 3100)

//MessageRepository Module

export const WS_URL_CONNECT = process.env.WS_URL_CONNECT || 'ws://localhost:3100/'
