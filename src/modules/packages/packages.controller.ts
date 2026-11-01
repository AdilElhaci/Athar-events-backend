import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PackageView, toPackageView } from './dto/package.dto';
import { PackagesService } from './packages.service';

@ApiTags('Packages')
@Controller('packages')
export class PackagesController {
  constructor(private readonly packages: PackagesService) {}

  @Get()
  @ApiOperation({ summary: 'Active packages in display order (public).' })
  async list(): Promise<PackageView[]> {
    return (await this.packages.listActive()).map(toPackageView);
  }
}
