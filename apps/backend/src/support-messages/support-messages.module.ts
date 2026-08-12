import { Module } from '@nestjs/common';
import { SupportMessagesService } from './support-messages.service';
import { SupportAutoCloseService } from './support-auto-close.service';
import {
  AdminSupportMessagesController,
  PublicSupportMessagesController,
} from './support-messages.controller';
import { CustomerSupportTicketsController } from './customer-support-tickets.controller';
import { SupportQuickRepliesService } from './support-quick-replies.service';
import { SupportQuickRepliesController } from './support-quick-replies.controller';
import { MailModule } from '../mail/mail.module';
import { CustomerAuthModule } from '../customer-auth/customer-auth.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { AdminOrdersModule } from '../admin/orders/admin-orders.module';

@Module({
  imports: [
    MailModule,
    CustomerAuthModule,
    ConversationsModule,
    AdminOrdersModule,
  ],
  controllers: [
    PublicSupportMessagesController,
    AdminSupportMessagesController,
    CustomerSupportTicketsController,
    SupportQuickRepliesController,
  ],
  providers: [
    SupportMessagesService,
    SupportAutoCloseService,
    SupportQuickRepliesService,
  ],
  exports: [SupportMessagesService],
})
export class SupportMessagesModule {}
