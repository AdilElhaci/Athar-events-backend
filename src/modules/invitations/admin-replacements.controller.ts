import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { withMessage } from '../../shared/interceptors/response.interceptor';
import { CurrentUser } from '../auth/current-user.decorator';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequireUserType, UserTypeGuard } from '../auth/guards/user-type.guard';
import type { AuthenticatedUser } from '../auth/types/auth.types';
import { UserType } from '../users/entities/user.entity';
import { ReplacementsView, SendReplacementsDto } from './dto/replacement.dto';
import { ReplacementsService } from './replacements.service';

/** SCR-24: extras, eligible declines, reserves; sending replacements (D-16). */
@ApiTags('Admin — Replacements')
@ApiBearerAuth()
@Controller('admin/events/:id/replacements')
@UseGuards(JwtAuthGuard, UserTypeGuard)
@RequireUserType(UserType.PLATFORM_ADMIN)
export class AdminReplacementsController {
  constructor(private readonly replacements: ReplacementsService) {}

  @Get()
  view(@Param('id', ParseUUIDPipe) id: string): Promise<ReplacementsView> {
    return this.replacements.view(id);
  }

  @Post()
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @ApiOperation({
    summary: '`count` or reserve `guestIds`; invitations go out at once.',
  })
  async send(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendReplacementsDto,
  ) {
    return withMessage(
      await this.replacements.send(user.id, id, dto),
      'replacements.sent',
    );
  }
}
