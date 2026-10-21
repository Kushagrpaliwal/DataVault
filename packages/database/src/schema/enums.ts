import { pgEnum } from "drizzle-orm/pg-core";
import { CREATED_VIA, RECORD_TYPES, SOURCE_TYPES } from "@data-vault/schemas";

export const recordTypeEnum = pgEnum("record_type", RECORD_TYPES);
export const createdViaEnum = pgEnum("created_via", CREATED_VIA);
export const sourceTypeEnum = pgEnum("source_type", SOURCE_TYPES);
export const memberStatusEnum = pgEnum("member_status", ["active", "invited", "suspended"]);
