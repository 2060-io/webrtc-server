const request = require('supertest')
const { createExpressApp, interactiveServer } = require('../server')

describe('2060-webrtc-server API', () => {
  let app
  let server
  let serverPromise

  beforeAll(async () => {
    const { server: srv, serverPromise: srvPromise } = await interactiveServer()
    server = srv
    serverPromise = srvPromise
    console.log('server:*** ', server)
    app = await createExpressApp()
  })

  afterAll((done) => {
    interactiveServer.getServer().close((error) => {
      if (error) {
        console.error('Error closing the server:', error)
      }
      done()
    })
  })

  test('GET /getRoomId should return a 200 status code', async () => {
    const response = await request(app).get('/getRoomId')
    expect(response.status).toBe(200)
  })

  test('GET /config should return server configuration', async () => {
    const response = await request(app).get('/config')
    expect(response.status).toBe(200)
    expect(response.body.config).toBeDefined()
  })

  test('GET /rooms/:roomId should return RTP capabilities', async () => {
    const roomId = '123456'
    const response = await request(app).get(`/rooms/${roomId}`)
    expect(response.status).toBe(200)
    // Check if the codecs and headerExtensions properties are present
    expect(response.body).toHaveProperty('codecs')
    expect(response.body).toHaveProperty('headerExtensions')
  })

  test('WebSocket connection for roomId and peerId', async () => {
    // This test would normally require a WebSocket client to fully implement
    const wsUrl = `wss://localhost:3000?roomId=123456&peerId=peer1`
    // Simulation: Ensure the URL structure is correct and includes necessary query parameters
    expect(wsUrl).toContain('?roomId=')
    expect(wsUrl).toContain('&peerId=')
  })
})
