import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { notFound } from '../../shared/exceptions/app.exception';
import { AdminAction } from '../admin-actions/admin-action.entity';
import { CreatePackageDto, UpdatePackageDto } from './dto/package.dto';
import { Package } from './entities/package.entity';

const CATALOGUE_ORDER = {
  sortOrder: 'ASC',
  createdAt: 'ASC',
  id: 'ASC',
} as const;

@Injectable()
export class PackagesService {
  constructor(
    @InjectRepository(Package) private readonly packages: Repository<Package>,
    private readonly dataSource: DataSource,
  ) {}

  listActive(): Promise<Package[]> {
    return this.packages.find({
      where: { isActive: true },
      order: CATALOGUE_ORDER,
    });
  }

  listAll(page: number, limit: number): Promise<[Package[], number]> {
    return this.packages.findAndCount({
      order: CATALOGUE_ORDER,
      skip: (page - 1) * limit,
      take: limit,
    });
  }

  /** The currency is fixed server-side: amounts never carry a client-chosen currency. */
  create(actorUserId: string, dto: CreatePackageDto): Promise<Package> {
    return this.dataSource.transaction(async (manager) => {
      const created = await manager.save(manager.create(Package, dto));
      await manager.insert(AdminAction, {
        actorUserId,
        action: 'package.created',
        targetType: 'package',
        targetId: created.id,
        summary: { isActive: created.isActive },
      });
      return created;
    });
  }

  update(
    actorUserId: string,
    id: string,
    dto: UpdatePackageDto,
  ): Promise<Package> {
    const changes = Object.fromEntries(
      Object.entries(dto).filter(([, value]) => value !== undefined),
    );
    return this.dataSource.transaction(async (manager) => {
      const current = await manager.findOne(Package, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!current) throw notFound();
      const fields = Object.keys(changes);
      if (!fields.length) return current;

      const updated = await manager.save(
        manager.merge<Package>(Package, current, changes),
      );
      await manager.insert(AdminAction, {
        actorUserId,
        action: 'package.updated',
        targetType: 'package',
        targetId: id,
        summary: { fields },
      });
      return updated;
    });
  }
}
