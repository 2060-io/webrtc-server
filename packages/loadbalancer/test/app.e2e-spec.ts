import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import { LoadbalancerModule } from './../src/loadbalancer.module'

describe('AppController (e2e)', () => {
  let app: INestApplication

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [LoadbalancerModule],
    }).compile()

    app = moduleFixture.createNestApplication()
    await app.init()
  })
})
