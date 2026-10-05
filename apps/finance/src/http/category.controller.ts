import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { RequirePermission, type AuthzUser } from '@ipms/authz';
import { CategoryCreateSchema, CategoryUpdateSchema, UuidSchema } from '@ipms/contracts';
import { CategoryService } from '../categories/category.service.js';

@Controller('finance/categories')
export class CategoryController {
  constructor(private readonly categories: CategoryService) {}

  @Get() @RequirePermission('finance_request.view')
  list(@Req() req: { user: AuthzUser }) { return this.categories.list(req.user); }

  @Post() @RequirePermission('finance_category.manage')
  create(@Body() body: unknown, @Req() req: { user: AuthzUser }) { return this.categories.create(CategoryCreateSchema.parse(body), req.user); }

  @Patch(':id') @RequirePermission('finance_category.manage')
  update(@Param('id') id: string, @Body() body: unknown, @Req() req: { user: AuthzUser }) {
    return this.categories.update(UuidSchema.parse(id), CategoryUpdateSchema.parse(body), req.user);
  }
}
