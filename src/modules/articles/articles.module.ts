import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { AdminArticlesController } from './admin-articles.controller';
import { ArticlesController } from './articles.controller';
import { ArticlesService } from './articles.service';
import { ArticleImage } from './entities/article-image.entity';
import { Article } from './entities/article.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Article, ArticleImage]), AuthModule],
  controllers: [ArticlesController, AdminArticlesController],
  providers: [ArticlesService],
})
export class ArticlesModule {}
