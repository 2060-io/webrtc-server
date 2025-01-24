import { NestFactory } from '@nestjs/core'
import { LoadbalancerModule } from './loadbalancer.module'
import { Logger, ValidationPipe, VersioningType } from '@nestjs/common'
import { getLogLevels } from './config/logger.config'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { ConfigService } from '@nestjs/config'
import * as express from 'express'
import * as fs from 'fs'

async function bootstrap() {
  const logger = new Logger('Bootstrap')

  // Retrieve log levels based on environment configuration
  const logLevels = getLogLevels()

  const app = await NestFactory.create(LoadbalancerModule, {
    logger: logLevels,
  })

  const expressApp = app.getHttpAdapter().getInstance() as express.Application
  expressApp.set('case sensitive routing', true)

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
    .setTitle('Webrtc Server Loadbalancer')
    .setDescription('API to WebRtc Server Loadbalancer')
    .setVersion('1.1')
    .addTag('rooms')
    .build()
  const document = SwaggerModule.createDocument(app, config)
  SwaggerModule.setup('API', app, document)

  const configService = app.get(ConfigService)

  const PORT = configService.get('appConfig.port')

  // Start the server
  app.listen(PORT, () => {
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf-8'))
    logger.log(`Application (${packageJson.name} v${packageJson.version}) running on: https://localhost:${PORT}`)
  })
}
bootstrap()
