import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

/** A Meta object id (digits only), so it can be placed in a Graph API query safely. */
@Injectable()
export class MetaIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!/^\d{1,30}$/.test(value)) throw new BadRequestException(['id']);
    return value;
  }
}
