import { Test, TestingModule } from '@nestjs/testing';
import { LoadbalancerController } from './loadbalancer.controller';
import { LoadbalancerService } from './loadbalancer.service';

describe('LoadbalancerController', () => {
  let loadbalancerController: LoadbalancerController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [LoadbalancerController],
      providers: [LoadbalancerService],
    }).compile();

    loadbalancerController = app.get<LoadbalancerController>(LoadbalancerController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(loadbalancerController.getHello()).toBe('Hello World!');
    });
  });
});
