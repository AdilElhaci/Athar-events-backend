import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { AdminPackagesController } from './admin-packages.controller';
import { Package } from './entities/package.entity';
import { PackagesController } from './packages.controller';
import { PackagesService } from './packages.service';

@Module({
  imports: [TypeOrmModule.forFeature([Package]), AuthModule],
  controllers: [PackagesController, AdminPackagesController],
  providers: [PackagesService],
})
export class PackagesModule {}
