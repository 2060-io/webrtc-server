import { createServer, Server } from 'https'
import { ConsoleLogger, INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import * as express from 'express'
import { ExpressAdapter } from '@nestjs/platform-express'
import { AppModule } from '../src/app.module'
import * as request from 'supertest'
import * as selfsigned from 'selfsigned'

jest.setTimeout(20000)

describe('Protoo WebSocket E2E Test', () => {
  let app: INestApplication
  let httpsServer: Server

  beforeAll(async () => {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
    const expressApp = express()
    expressApp.use(express.static('public'))

    const attrs = [{ name: 'commonName', value: '127.0.0.0' }]
    const options = { days: 1 }
    const pems = selfsigned.generate(attrs, options)

    const httpsOptions = {
      key: pems.private,
      cert: pems.cert,
    }

    httpsServer = createServer(httpsOptions, expressApp)

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    Reflect.set(global, 'httpServer', httpsServer)

    app = moduleFixture.createNestApplication(new ExpressAdapter(expressApp))

    app.useLogger(new ConsoleLogger('App', { timestamp: true }))

    app.useGlobalPipes(new ValidationPipe())
    await app.init()
    await new Promise<void>((resolve) => {
      httpsServer.listen(4443, () => {
        console.log('***httpServer test initialized***')
        resolve()
      })
    })
  })

  afterAll(async () => {
    await app.close()
    await new Promise((resolve) => setTimeout(resolve, 2000))

    await new Promise<void>((resolve, reject) => {
      httpsServer.close((err?: Error) => {
        if (err) return reject(err)
        resolve()
      })
    })
    await new Promise((resolve) => setTimeout(resolve, 2000))

    Reflect.deleteProperty(global, 'httpServer')
  })

  it('should create a new room using the REST API', async () => {
    const createRoomDto = {
      eventNotificationUri: 'http://localhost/test',
      maxPeerCount: 10,
    }

    const response = await request(app.getHttpServer()).post('/rooms/testRoom').send(createRoomDto).expect(201)

    console.log(response.body)

    expect(response.body).toHaveProperty('roomId', 'testRoom')
    expect(response.body).toHaveProperty('wsUrl')
    expect(response.body.wsUrl).toMatch(/^wss:\/\//)
    expect(response.body).toHaveProperty('protocol', '2060-mediasoup-v1')
  })
})
