import { Module } from '@nestjs/common';
import { AdminMessagesService } from './admin-messages.service';
import { AdminMessagesController } from './admin-messages.controller';

@Module({
  providers: [AdminMessagesService],
  controllers: [AdminMessagesController],
})
export class AdminMessagesModule {}
