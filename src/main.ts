import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { ConfigService } from '@nestjs/config'
import { Logger, ValidationPipe, VersioningType } from '@nestjs/common'
import { createServer } from 'https'
import { ExpressAdapter } from '@nestjs/platform-express'
import { getLogLevels } from './config/logger.config'
import * as express from 'express'
import * as fs from 'fs'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { config as configServer } from './config/config.server'

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap')

  // Retrieve log levels based on environment configuration
  const logLevels = getLogLevels()

  // Create an Express instance
  const expressApp = express()

  // Set case sensitive routing
  expressApp.set('case sensitive routing', true)

  // Activate TLS
  const httpsOptions = {
    key: fs.readFileSync(configServer.https.tls.key),
    cert: fs.readFileSync(configServer.https.tls.cert),
  }

  // Create the HTTPS server using the Express instance
  const httpsServer = createServer(httpsOptions, expressApp)

  // Expose the HTTPS server globally before initializing NestJS
  Reflect.set(global, 'httpServer', httpsServer)

  // Create the NestJS application with the Express adapter
  const app = await NestFactory.create(AppModule, new ExpressAdapter(expressApp), {
    logger: logLevels,
  })

  // Retrieve configuration and enable necessary features
  const configService = app.get(ConfigService)
  app.enableVersioning({ type: VersioningType.URI })
  app.enableCors()

  // Validations DTO
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      disableErrorMessages: false,
    }),
  )

  // Documentation Builder
  const config = new DocumentBuilder()
    .setTitle('Webrtc Server')
    .setDescription('API to WebRtc Server')
    .setVersion('1.1')
    .addTag('rooms')
    .build()
  const document = SwaggerModule.createDocument(app, config)
  SwaggerModule.setup('API', app, document)

  const PORT = configServer.https.listenPort

  // Initialize the NestJS application
  await app.init()

  // Start the HTTPS server
  httpsServer.listen(PORT, () => {
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf-8'))
    logger.log(`Application (${packageJson.name} v${packageJson.version}) running on: https://localhost:${PORT}`)
    logger.log(`Webrtc-server configuration: ${JSON.stringify(configServer, null, 2)}`)
  })
}

bootstrap()
