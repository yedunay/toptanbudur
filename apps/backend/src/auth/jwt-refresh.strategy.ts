import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

/**
 * Refresh token JWT payload. `jti` veritabanındaki RefreshToken kaydının
 * benzersiz tanımlayıcısıdır — rotasyon ve revoke kontrolü bu alan üzerinden
 * yapılır. `type: 'refresh'` access token ile karışmasın diye eklenir.
 */
export interface JwtRefreshPayload {
  sub: string;
  jti: string;
  type: 'refresh';
}

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_REFRESH_SECRET'),
    });
  }

  validate(payload: JwtRefreshPayload): JwtRefreshPayload {
    return payload;
  }
}
