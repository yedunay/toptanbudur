import {
  Body,
  Controller,
  HttpCode,
  Ip,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { LeadsService } from './leads.service';
import { CreateLeadDto } from './dto/create-lead.dto';

@Controller('leads')
export class LeadsController {
  constructor(private readonly service: LeadsService) {}

  @Throttle({ default: { limit: 5, ttl: 600_000 } })
  @Post('callback')
  @HttpCode(201)
  callback(@Body() dto: CreateLeadDto, @Ip() ip: string, @Req() req: Request) {
    return this.service.create(dto, ip, req);
  }
}
