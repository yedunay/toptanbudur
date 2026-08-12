import { Module } from '@nestjs/common';
import { ConversationsService } from './conversations.service';
import { ConversationsController } from './conversations.controller';
import { AdminConversationsController } from './admin-conversations.controller';
import { CustomerAuthModule } from '../customer-auth/customer-auth.module';
import { MailModule } from '../mail/mail.module';

/**
 * Conversations — threaded chat (SUPPORT + DEALER_RETURN_ORDER).
 *
 * PrismaModule, StorageModule ve NotificationsModule @Global olduğundan ayrıca
 * import edilmez. CustomerAuthModule, CustomerJwtGuard'ın JwtService
 * bağımlılığını sağlamak için (support-messages.module ile aynı) import edilir.
 *
 * ConversationsService dışa aktarılır ki support/order modülleri sohbet
 * oluşturup mesaj gönderebilsin.
 */
@Module({
  imports: [CustomerAuthModule, MailModule],
  controllers: [ConversationsController, AdminConversationsController],
  providers: [ConversationsService],
  exports: [ConversationsService],
})
export class ConversationsModule {}
