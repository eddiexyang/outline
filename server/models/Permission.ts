import type { InferAttributes, InferCreationAttributes } from "sequelize";
import {
  AllowNull,
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  IsIn,
  Table,
} from "sequelize-typescript";
import Team from "./Team";
import User from "./User";
import ParanoidModel from "./base/ParanoidModel";
import Fix from "./decorators/Fix";

export enum PermissionSubjectType {
  User = "user",
  Group = "group",
  Role = "role",
}

export enum PermissionResourceType {
  Workspace = "workspace",
  Collection = "collection",
  Document = "document",
}

export enum PermissionLevel {
  Read = "read",
  Edit = "edit",
  Manage = "manage",
}

export enum PermissionInheritMode {
  Self = "self",
  Children = "children",
}

@Table({ tableName: "permissions", modelName: "permission" })
@Fix
class Permission extends ParanoidModel<
  InferAttributes<Permission>,
  Partial<InferCreationAttributes<Permission>>
> {
  @IsIn([Object.values(PermissionSubjectType)])
  @Column(DataType.STRING)
  subjectType: PermissionSubjectType;

  @AllowNull
  @Column(DataType.UUID)
  subjectId: string | null;

  @AllowNull
  @Column(DataType.STRING)
  subjectRole: string | null;

  @IsIn([Object.values(PermissionResourceType)])
  @Column(DataType.STRING)
  resourceType: PermissionResourceType;

  @AllowNull
  @Column(DataType.UUID)
  resourceId: string | null;

  @IsIn([Object.values(PermissionLevel)])
  @Column(DataType.STRING)
  permission: PermissionLevel;

  @IsIn([Object.values(PermissionInheritMode)])
  @Column(DataType.STRING)
  inheritMode: PermissionInheritMode;

  @BelongsTo(() => User, "grantedById")
  grantedBy: User;

  @ForeignKey(() => User)
  @Column(DataType.UUID)
  grantedById: string;

  @BelongsTo(() => Team, "teamId")
  team: Team;

  @ForeignKey(() => Team)
  @Column(DataType.UUID)
  teamId: string;
}

export default Permission;
